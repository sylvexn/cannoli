/**
 * Error group fingerprinting and occurrence recording — the write side of the
 * observability "Error Groups" dashboard.
 *
 * A fingerprint collapses identical faults into a single error_groups row so
 * transient spikes don't flood the triage queue with 500 unique entries. The
 * algorithm is intentionally lossy: we strip volatile tokens (UUIDs, row ids,
 * line numbers) so the same logical bug maps to the same fingerprint across
 * deploys and across different request ids.
 *
 * All functions are best-effort. A logging failure must NEVER break a real
 * request — every exported function wraps its body in try/catch and returns a
 * safe default on any caught error.
 *
 * The table schema lives in src/db/schema.ts (errorGroups, errorGroupUsers).
 * request_logs.fingerprint links back here but is written by request-log.ts.
 */
import { createHash } from 'crypto';
import { sqlite } from '../db';

/** Occurrences-per-fingerprint in this window trigger isSpike. */
const SPIKE_THRESHOLD = 10;
/** Window length (minutes) for the spike check. */
const SPIKE_WINDOW_MINUTES = 5;

// Fingerprinting

/**
 * Normalize a raw error message so that two occurrences of the same bug
 * produce the same normalized form even if they carry different runtime values
 * (ids, timestamps, file paths with line numbers, etc.).
 */
function normalizeMessage(msg: string): string {
  return (
    msg
      // UUIDs (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
      // Hex ids like "0x1a2b3c4d"
      .replace(/0x[0-9a-f]+/gi, '<hex>')
      // Quoted string literals (single or double)
      .replace(/"[^"]*"/g, '<str>')
      .replace(/'[^']*'/g, '<str>')
      // File path :line:col or :line suffixes, e.g. "/foo/bar.ts:42:7"
      .replace(/:\d+(?::\d+)?(?=\)|"|'|$|\s)/g, ':<loc>')
      // Digit-only tokens (standalone numbers — ids, counts, timestamps)
      .replace(/\b\d+\b/g, '<n>')
      .toLowerCase()
      .trim()
  );
}

/**
 * Pick the topmost "meaningful" stack frame — the first line that is not
 * clearly from node_modules, a bundler chunk, or the V8/Bun runtime internals.
 * Returns a path-only string with line:col stripped so it stays stable across
 * recompiles of the same logical file.
 */
function topFrame(stack: string | null | undefined): string {
  if (!stack) return '';
  const lines = stack.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip the first "Error: ..." summary line
    if (!trimmed.startsWith('at ')) continue;
    // Skip vendor noise
    if (/node_modules|\/vendor\/|chunk-[0-9a-f]+/.test(trimmed)) continue;
    // Skip Bun/Node internals (bun:…, node:…)
    if (/\bat (bun:|node:)/.test(trimmed)) continue;
    // Strip line:col from the frame so it collapses across minor edits
    return trimmed.replace(/:\d+:\d+\)?$/, '').replace(/:\d+\)?$/, '');
  }
  return '';
}

/**
 * Compute a deterministic 16-hex-char fingerprint for an error occurrence.
 * Identical bugs (same kind + error class + normalised message + code origin)
 * always produce the same fingerprint regardless of which user triggered them
 * or which specific runtime values appeared in the message.
 */
export function computeFingerprint(input: {
  kind: string;
  name?: string | null;
  message: string;
  stack?: string | null;
  path?: string | null;
}): string {
  try {
    const normMsg = normalizeMessage(input.message);
    const frame = topFrame(input.stack) || normMsg + (input.path ?? '');
    const raw = `${input.kind}:${input.name ?? ''}:${normMsg}:${frame}`;
    return createHash('sha1').update(raw).digest('hex').slice(0, 16);
  } catch {
    // Fallback: hash the raw message so we always return something usable
    return createHash('sha1')
      .update(String(input.kind) + String(input.message))
      .digest('hex')
      .slice(0, 16);
  }
}

// Types

export interface OccurrenceInput {
  fingerprint: string;
  kind: string;
  name?: string | null;
  message: string;
  path?: string | null;
  stack?: string | null;
  userId?: number | null;
  version: string;
}

export interface RecordResult {
  isNew: boolean;
  isSpike: boolean;
  count: number;
  affectedUsers: number;
  fingerprint: string;
  kind: string;
  errorName: string | null;
  sampleMessage: string | null;
  samplePath: string | null;
}

// Recent count helper

/**
 * Count request_logs rows with a given fingerprint within the last N minutes.
 * Used for spike detection and can be reused by alert/notify logic elsewhere.
 * Best-effort — returns 0 on any error.
 */
export function recentCount(fingerprint: string, minutes: number): number {
  try {
    const row = sqlite
      .query<{ n: number }, [string, number]>(
        `SELECT COUNT(*) AS n FROM request_logs
         WHERE fingerprint = ?
           AND timestamp >= datetime('now', '-' || ? || ' minutes')`,
      )
      .get(fingerprint, minutes);
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

// Occurrence recording

/**
 * Upsert an error_groups row for this fingerprint, track the distinct user (if
 * authenticated), and detect new/regressed/spiking groups.
 *
 * The function does several small SQLite ops in sequence rather than a single
 * transaction so a partial failure (e.g. the user-tracking insert fails) still
 * leaves the main count incremented. All ops are best-effort.
 *
 * Returns a RecordResult describing the post-update state, or null on any
 * unhandled error.
 */
export function recordOccurrence(input: OccurrenceInput): RecordResult | null {
  try {
    const {
      fingerprint,
      kind,
      name,
      message,
      path,
      stack,
      userId,
      version,
    } = input;

    // 1. Check whether this fingerprint already has a group row
    const existing = sqlite
      .query<
        {
          id: number;
          status: string;
          resolved_version: string | null;
          count: number;
          affected_users: number;
          error_name: string | null;
          sample_message: string | null;
          sample_path: string | null;
        },
        [string]
      >(
        `SELECT id, status, resolved_version, count, affected_users,
                error_name, sample_message, sample_path
         FROM error_groups WHERE fingerprint = ?`,
      )
      .get(fingerprint);

    const isNew = existing == null;

    // 2. Determine whether to reopen a resolved regression
    // A group was marked resolved at a specific version. If we see a fresh
    // occurrence from a *different* version, the fix didn't hold — reopen it.
    const shouldReopen =
      !isNew &&
      existing!.status === 'resolved' &&
      existing!.resolved_version != null &&
      version !== existing!.resolved_version;

    // 3. Upsert the group row
    if (isNew) {
      sqlite
        .query(
          `INSERT INTO error_groups
             (fingerprint, kind, error_name, sample_message, sample_path,
              sample_stack, count, affected_users, status,
              first_seen, last_seen, first_version, last_version)
           VALUES
             (?, ?, ?, ?, ?, ?, 1, 0, 'open',
              datetime('now'), datetime('now'), ?, ?)`,
        )
        .run(
          fingerprint,
          kind,
          name ?? null,
          message ?? null,
          path ?? null,
          stack ?? null,
          version,
          version,
        );
    } else if (shouldReopen) {
      sqlite
        .query(
          `UPDATE error_groups
           SET count = count + 1,
               last_seen = datetime('now'),
               last_version = ?,
               status = 'open',
               resolved_at = NULL,
               resolved_version = NULL
           WHERE fingerprint = ?`,
        )
        .run(version, fingerprint);
    } else {
      sqlite
        .query(
          `UPDATE error_groups
           SET count = count + 1,
               last_seen = datetime('now'),
               last_version = ?
           WHERE fingerprint = ?`,
        )
        .run(version, fingerprint);
    }

    // 4. Track distinct users
    if (userId != null) {
      // INSERT OR IGNORE enforces the (fingerprint, user_id) unique index
      // defined in the migration — the count only goes up on genuinely new users.
      sqlite
        .query(
          `INSERT OR IGNORE INTO error_group_users (fingerprint, user_id)
           VALUES (?, ?)`,
        )
        .run(fingerprint, userId);

      // Write the accurate count back to the group row
      sqlite
        .query(
          `UPDATE error_groups
           SET affected_users = (
             SELECT COUNT(*) FROM error_group_users WHERE fingerprint = ?
           )
           WHERE fingerprint = ?`,
        )
        .run(fingerprint, fingerprint);
    }

    // 5. Read final state for the result
    const final = sqlite
      .query<
        {
          count: number;
          affected_users: number;
          kind: string;
          error_name: string | null;
          sample_message: string | null;
          sample_path: string | null;
        },
        [string]
      >(
        `SELECT count, affected_users, kind, error_name, sample_message, sample_path
         FROM error_groups WHERE fingerprint = ?`,
      )
      .get(fingerprint);

    // 6. Spike detection
    // A newly-created group can't be a spike (no prior baseline to compare
    // against) — we'd always fire on first occurrence. Skip for isNew.
    const isSpike =
      !isNew && recentCount(fingerprint, SPIKE_WINDOW_MINUTES) >= SPIKE_THRESHOLD;

    return {
      isNew,
      isSpike,
      count: final?.count ?? 1,
      affectedUsers: final?.affected_users ?? 0,
      fingerprint,
      kind: final?.kind ?? kind,
      errorName: final?.error_name ?? null,
      sampleMessage: final?.sample_message ?? null,
      samplePath: final?.sample_path ?? null,
    };
  } catch {
    /* never throw from logging */
    return null;
  }
}
