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

/** Short, user-quotable correlation id (e.g. "k3f9q2a1"). Stamped on server
 *  5xx rows and every client-error row; surfaced in the error boundary and
 *  embedded in the user's feedback issue so a report ties back to one row. */
export function genErrorId(): string {
  return Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6);
}

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
      source: 'server',
      method,
      path,
      status,
      durationMs,
      userId: user ? parseInt(user.id) : null,
      username: user?.username ?? null,
      ip: clientIp(request),
      errorId: status >= 500 ? genErrorId() : null,
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

/** A browser-reported fault (window.onerror / unhandledrejection / React error
 *  boundary), posted to /api/client-errors. */
export interface ClientErrorInput {
  /** App route the user was on, e.g. "/leagues/abc/draft". */
  page: string;
  name?: string | null;
  message: string;
  stack?: string | null;
  /** Which browser hook caught it — recorded in error_name for triage. */
  kind?: 'render' | 'window' | 'unhandledrejection' | string | null;
}

/**
 * Record a client-side fault as a request_logs row (source='client'). Reuses
 * the same table/retention as server traffic so the dev "API Logs" tab is the
 * single place to look. Returns a correlation id the client shows to the user
 * and embeds in any follow-up feedback issue. Best-effort — never throws.
 */
export function logClientError(
  input: ClientErrorInput,
  ctx: { user?: { id: string; username: string } | null; ip?: string | null },
): string {
  const errorId = genErrorId();
  try {
    const kind = (input.kind || 'render').toString().slice(0, 40);
    db.insert(schema.requestLogs).values({
      source: 'client',
      // Client faults aren't HTTP calls; we borrow method/status to slot into
      // the existing schema: a synthetic 500 so they group with server errors,
      // and the originating page as the path.
      method: 'CLIENT',
      path: (input.page || '/').slice(0, 512),
      status: 500,
      durationMs: 0,
      userId: ctx.user ? parseInt(ctx.user.id) : null,
      username: ctx.user?.username ?? null,
      ip: ctx.ip ?? null,
      errorId,
      errorName: input.name ? `${input.name} (${kind})` : kind,
      errorMessage: (input.message || 'Unknown client error').slice(0, 1000),
      errorStack: input.stack ? input.stack.slice(0, MAX_STACK) : null,
    }).run();

    if (++insertsSincePrune >= PRUNE_EVERY) {
      insertsSincePrune = 0;
      prune();
    }
  } catch {
    /* never throw from logging */
  }
  return errorId;
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
