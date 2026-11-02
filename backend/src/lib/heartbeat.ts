/**
 * In-process self-monitoring heartbeat.
 *
 * Periodically probes critical subsystems, persists the latest status to the
 * `health_checks` table (one row per probe, upserted), and fires a Discord
 * alert via alertHealthFlip whenever a probe transitions state (ok↔down/
 * degraded). All operations are best-effort — a probe failure must NEVER
 * interfere with real request handling or stop the interval.
 *
 * Usage: call `startHeartbeat()` once at process startup (index.ts).
 * Guard ensures double-calls are silently ignored.
 *
 * Consumers: `getHealthSnapshot()` is called by GET /api/admin/observability/health.
 */

import { db, schema, sqlite } from '../db';
import { getBotStatus } from './ps-bot';
import { GIT_SHA } from './version';
import { alertHealthFlip } from './alert';

// Config

/** How often to run the full probe sweep (ms). */
const INTERVAL_MS = 60_000;

// Module state

/** Guards against double-starting (e.g. hot-reload). */
let _started = false;

/** Handle returned by setInterval so we can clear it on shutdown. */
let _intervalHandle: NodeJS.Timeout | null = null;
let _firstSweepHandle: NodeJS.Timeout | null = null;

/**
 * Tracks the last known status per probe name.
 * Used to detect state transitions and decide when to fire alerts.
 * Undefined = probe has never been seen this process lifetime.
 */
const _prevStatus = new Map<string, 'ok' | 'degraded' | 'down'>();
/** Candidate new status awaiting a second consecutive confirmation. */
const _pending = new Map<string, { status: 'ok' | 'degraded' | 'down'; n: number }>();

/** Delay before the first sweep so a deploy's boot-time blips don't alert. */
const FIRST_SWEEP_DELAY_MS = 45_000;

// Types

type ProbeStatus = 'ok' | 'degraded' | 'down';

interface ProbeResult {
  name: string;
  status: ProbeStatus;
  detail: string | null;
  latencyMs: number;
}

// Individual probes

/** Probe: SQLite database reachability. */
function probeDb(): ProbeResult {
  const t0 = performance.now();
  try {
    sqlite.query('SELECT 1').get();
    return {
      name: 'db',
      status: 'ok',
      detail: null,
      latencyMs: Math.round(performance.now() - t0),
    };
  } catch (err) {
    return {
      name: 'db',
      status: 'down',
      detail: err instanceof Error ? err.message : String(err),
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}

/** Probe: Pokemon Showdown bot WebSocket connection.
 *  Only registered when PS_SERVER_WS_URL is set — otherwise the bot is not
 *  configured and a persistent "down" would be noise.
 *
 *  health mapping:
 *    green  → ok       (connected and recently active)
 *    yellow → degraded (connected but idle — zombie socket detection)
 *    red    → down     (disconnected) */
function probePsBot(): ProbeResult {
  const t0 = performance.now();
  try {
    const { connected, health, lastError } = getBotStatus();
    let status: ProbeStatus;
    let detail: string | null;
    if (!connected || health === 'red') {
      status = 'down';
      detail = lastError ?? 'not connected';
    } else if (health === 'yellow') {
      status = 'degraded';
      detail = 'connected but idle (possible zombie socket)';
    } else {
      status = 'ok';
      detail = null;
    }
    return {
      name: 'ps_bot',
      status,
      detail,
      latencyMs: Math.round(performance.now() - t0),
    };
  } catch (err) {
    return {
      name: 'ps_bot',
      status: 'down',
      detail: err instanceof Error ? err.message : String(err),
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}

// Upsert helper

/**
 * Persist a probe result to health_checks via a raw upsert.
 * last_ok_at is only updated when the new status is 'ok', so it records the
 * most recent healthy moment across state flips.
 */
function upsertProbe(result: ProbeResult): void {
  sqlite
    .query(
      `INSERT INTO health_checks (name, status, detail, latency_ms, checked_at, last_ok_at)
       VALUES (?, ?, ?, ?, datetime('now'), CASE WHEN ? = 'ok' THEN datetime('now') ELSE NULL END)
       ON CONFLICT(name) DO UPDATE SET
         status     = excluded.status,
         detail     = excluded.detail,
         latency_ms = excluded.latency_ms,
         checked_at = datetime('now'),
         last_ok_at = CASE
           WHEN excluded.status = 'ok' THEN datetime('now')
           ELSE health_checks.last_ok_at
         END`,
    )
    .run(result.name, result.status, result.detail, result.latencyMs, result.status);
}

// Alert helper

/**
 * Compare the new status against the tracked previous value and fire
 * alertHealthFlip if a real transition occurred.
 *
 * Alert rules:
 *   - First sweep into 'ok'       → silent
 *   - Any change from the confirmed status (first observation counts as 'ok')
 *     → alert only after 2 consecutive identical results
 */
function maybeAlert(result: ProbeResult): void {
  const prev = _prevStatus.get(result.name);
  const curr = result.status;

  // Debounce: a status change is only acted on after 2 consecutive identical
  // results, so a single blip (e.g. the bot reconnecting mid-deploy) is silent.
  if (curr === (prev ?? 'ok')) {
    _pending.delete(result.name);
    _prevStatus.set(result.name, curr);
    return;
  }
  const p = _pending.get(result.name);
  const n = p && p.status === curr ? p.n + 1 : 1;
  if (n < 2) {
    _pending.set(result.name, { status: curr, n });
    return;
  }
  _pending.delete(result.name);
  _prevStatus.set(result.name, curr);
  alertHealthFlip({ name: result.name, status: curr, detail: result.detail });
}

// Sweep

/** Run all configured probes and persist + alert results. Best-effort. */
function runSweep(): void {
  try {
    const probes: ProbeResult[] = [probeDb()];

    // Only probe the PS bot when the server URL is configured.
    if (process.env.PS_SERVER_WS_URL) {
      probes.push(probePsBot());
    }

    for (const result of probes) {
      try {
        upsertProbe(result);
      } catch {
        /* DB write failure — don't let it block the next probe or alerting */
      }
      try {
        maybeAlert(result);
      } catch {
        /* alert failure must never stop the sweep */
      }
    }
  } catch {
    /* top-level guard — the interval must keep running regardless */
  }
}

// Public API

/**
 * Start the background heartbeat sweep. Idempotent — safe to call multiple
 * times (only the first call takes effect).
 *
 * The first sweep runs after FIRST_SWEEP_DELAY_MS, then every INTERVAL_MS.
 */
export function startHeartbeat(): void {
  if (_started) return;
  _started = true;

  // ponytail: first check is delayed (boot noise); health table is empty until then.
  _firstSweepHandle = setTimeout(() => {
    runSweep();
    _intervalHandle = setInterval(runSweep, INTERVAL_MS);
  }, FIRST_SWEEP_DELAY_MS);
}

/**
 * Stop the background heartbeat interval (called on graceful shutdown).
 * Safe to call if startHeartbeat() was never called or already stopped.
 */
export function stopHeartbeat(): void {
  if (_firstSweepHandle !== null) {
    clearTimeout(_firstSweepHandle);
    _firstSweepHandle = null;
  }
  if (_intervalHandle !== null) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
  _started = false;
}

// Snapshot

/** Shape returned by getHealthSnapshot() and consumed by the dashboard route. */
export interface HealthSnapshot {
  checks: {
    name: string;
    status: 'ok' | 'degraded' | 'down';
    detail: string | null;
    latencyMs: number | null;
    checkedAt: string | null;
    lastOkAt: string | null;
  }[];
  uptimeSeconds: number;
  version: string;
}

/**
 * Read all health_checks rows and return a snapshot for the observability
 * dashboard. Best-effort — returns an empty checks array on any read error
 * rather than throwing.
 */
export function getHealthSnapshot(): HealthSnapshot {
  try {
    const rows = db.select().from(schema.healthChecks).all();
    return {
      checks: rows.map((r) => ({
        name: r.name,
        status: r.status as 'ok' | 'degraded' | 'down',
        detail: r.detail ?? null,
        latencyMs: r.latencyMs ?? null,
        checkedAt: r.checkedAt ?? null,
        lastOkAt: r.lastOkAt ?? null,
      })),
      uptimeSeconds: Math.round(process.uptime()),
      version: GIT_SHA,
    };
  } catch {
    return {
      checks: [],
      uptimeSeconds: Math.round(process.uptime()),
      version: GIT_SHA,
    };
  }
}
