/**
 * API request logging — the write side of the admin "API Logs" tab.
 *
 * The root app (src/index.ts) wires two lifecycle hooks:
 *   - onError          → captures the error class/message/stack for a request
 *   - onAfterResponse  → writes the final row (method, path, status, duration)
 *
 * Both funnel through `logRequest`, which is deduped per Request object so an
 * errored request that also fires onAfterResponse only produces one row. All
 * writes are best-effort: a logging failure must NEVER take down a real
 * request, so everything is wrapped in try/catch and the insert is sync-but-
 * cheap (single row into a WAL SQLite).
 *
 * Retention: opportunistic pruning on insert keeps the table near MAX_ROWS so
 * it can't grow without bound. No background job required.
 */
import { db, schema, sqlite } from '../db';

/** Keep roughly this many of the newest rows; prune the rest. */
const MAX_ROWS = 5000;
/** Run the prune sweep once every N inserts (amortizes the DELETE cost). */
const PRUNE_EVERY = 250;
/** Cap stored stack traces so a deep trace can't bloat a row. */
const MAX_STACK = 4000;

let insertsSincePrune = 0;

/** Per-request error detail, stashed by onError and read by onAfterResponse. */
interface CapturedError {
  name: string;
  message: string;
  stack?: string;
}
const errorByRequest = new WeakMap<Request, CapturedError>();
const startByRequest = new WeakMap<Request, number>();
const logged = new WeakSet<Request>();

/** Stamp the handler-start time (called from onRequest). */
export function markRequestStart(request: Request) {
  startByRequest.set(request, performance.now());
}

/**
 * Decide whether a path is worth recording. We log the whole API surface
 * (incl. the PS SSO action.php proxy, which is the gnarliest auth path), but
 * skip pure infra noise: health probes and CORS preflights generate constant
 * traffic with zero diagnostic value.
 */
export function shouldLogPath(method: string, path: string): boolean {
  if (method === 'OPTIONS') return false;
  if (path === '/health' || path === '/api/health') return false;
  if (path === '/') return false;
  // Only the API surface (plus the action.php SSO proxy, which lives there).
  return path.startsWith('/api/');
}

/** Stash error info for the in-flight request (called from onError). */
export function captureRequestError(request: Request, err: unknown) {
  try {
    if (err instanceof Error) {
      errorByRequest.set(request, {
        name: err.name || 'Error',
        message: err.message || String(err),
        stack: err.stack?.slice(0, MAX_STACK),
      });
    } else {
      errorByRequest.set(request, { name: 'Error', message: String(err) });
    }
  } catch {
    /* never throw from logging */
  }
}

interface LogArgs {
  request: Request;
  status: number;
  user?: { id: string; username: string } | null;
}

/** Write one request_logs row (deduped per Request). Best-effort. */
export function logRequest({ request, status, user }: LogArgs) {
  try {
    if (logged.has(request)) return;

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    if (!shouldLogPath(method, path)) return;
    logged.add(request);

    const captured = errorByRequest.get(request);
    // Only persist a stack for genuine server faults — 4xx are expected and
    // their stacks are noise. A captured error on a <500 status still records
    // name+message (useful context) but drops the trace.
    const stack = captured && status >= 500 ? captured.stack ?? null : null;

    const startedAt = startByRequest.get(request);
    const durationMs = startedAt != null ? Math.max(0, Math.round(performance.now() - startedAt)) : 0;

    db.insert(schema.requestLogs).values({
      method,
      path,
      status,
      durationMs,
      userId: user ? parseInt(user.id) : null,
      username: user?.username ?? null,
      ip: clientIp(request),
      errorName: captured?.name ?? null,
      errorMessage: captured?.message ?? null,
      errorStack: stack,
    }).run();

    if (++insertsSincePrune >= PRUNE_EVERY) {
      insertsSincePrune = 0;
      prune();
    }
  } catch {
    /* never throw from logging */
  }
}

/** Best-effort X-Forwarded-For first hop (we sit behind Coolify's proxy). */
function clientIp(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return request.headers.get('x-real-ip');
}

/** Delete everything older than the newest MAX_ROWS rows. */
function prune() {
  try {
    sqlite
      .query(
        `DELETE FROM request_logs WHERE id <= (
           SELECT id FROM request_logs ORDER BY id DESC LIMIT 1 OFFSET ?
         )`,
      )
      .run(MAX_ROWS);
  } catch {
    /* never throw from logging */
  }
}
