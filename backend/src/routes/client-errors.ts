/**
 * Client-side error capture — the browser write-side of the "API Logs" tab.
 *
 * The frontend (window.onerror, unhandledrejection, the React error boundary)
 * posts faults here; we persist them as source='client' rows in request_logs
 * via logClientError, sharing the same retention/pruning as server traffic.
 *
 * Open to unauthenticated callers on purpose: a crash can happen before login,
 * and we still want the trace. Best-effort — a logging failure must never be
 * visible to the user, so we always return a 200 with an error ref.
 */
import { Elysia, t } from 'elysia';
import { logClientError } from '../lib/request-log';
import type { AuthUser } from '../middleware/auth';

// Per-IP fixed-window limiter (anonymous endpoint). ponytail: in-memory, single process.
const RATE_MAX = 30;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { start: number; n: number }>();
export function clientErrorRateLimited(ip: string, now = Date.now()): boolean {
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start >= RATE_WINDOW_MS) hits.delete(k);
  const h = hits.get(ip);
  if (!h || now - h.start >= RATE_WINDOW_MS) { hits.set(ip, { start: now, n: 1 }); return false; }
  return ++h.n > RATE_MAX;
}

export const clientErrorRoutes = new Elysia()
  .post('/api/client-errors', ({ body, request, set, ...ctx }) => {
    const user = (ctx as { user?: AuthUser | null }).user ?? null;
    const xff = request.headers.get('x-forwarded-for');
    const ip = xff ? xff.split(',')[0]!.trim() : request.headers.get('x-real-ip');

    if (clientErrorRateLimited(ip ?? 'unknown')) {
      set.status = 429;
      return { errorId: null };
    }

    const errorId = logClientError(
      {
        page: body.page,
        name: body.name ?? null,
        message: body.message,
        stack: body.stack ?? null,
        kind: body.kind ?? null,
        breadcrumbs: body.breadcrumbs ?? null,
        version: body.version ?? null,
      },
      { user: user ? { id: user.id, username: user.username } : null, ip },
    );

    return { errorId };
  }, {
    body: t.Object({
      page: t.String(),
      message: t.String(),
      name: t.Optional(t.String()),
      stack: t.Optional(t.String()),
      kind: t.Optional(t.String()),
      breadcrumbs: t.Optional(t.Array(t.Unknown())),
      version: t.Optional(t.String()),
    }),
  });
