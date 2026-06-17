import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import {
  parseSessionToken, validateSession,
  csrfTokenForSession, parseCsrfCookie,
} from './lib/auth';
import type { AuthUser } from './middleware/auth';

import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { onlineRoutes, touchHeartbeat } from './routes/online';
import { leagueRoutes } from './routes/leagues';
import { adminRoutes } from './routes/admin';
import { draftRoutes } from './routes/draft';
import { tradeRoutes } from './routes/trades';
import { matchRoutes } from './routes/matches';
import { feedbackRoutes } from './routes/feedback';
import { changelogRoutes } from './routes/changelog';
import { notificationRoutes } from './routes/notifications';
import { clientErrorRoutes } from './routes/client-errors';
import { arenaRoutes } from './routes/arena';
import { psLoginRoutes } from './routes/ps-login';
import { psInternalRoutes } from './routes/ps-internal';
import { pinRoutes } from './routes/pins';
import { archiveDeepRoutes } from './routes/archive';
import { startBot } from './lib/ps-bot';
import { ensureBotUser, reconcileBotRoles } from './lib/ps-bot-seed';
import { startSchedulers, stopSchedulers } from './lib/scheduler';
import { markRequestStart, captureRequestError, logRequest, logServerFault, getRequestId } from './lib/request-log';
import { startHeartbeat, stopHeartbeat } from './lib/heartbeat';
import { GIT_SHA } from './lib/version';
import { sqlite } from './db';

// ─── Boot-time env guards ───────────────────────────────────────────────────
// Catch foot-guns before they cause silent corruption / silent auth failure.

const MODE = process.env.CANNOLI_MODE || 'mock';
const NODE_ENV = process.env.NODE_ENV || 'development';
const DB_PATH = process.env.CANNOLI_DB_PATH;

// Map Elysia's built-in error `code` strings to HTTP status for the request
// logger (a thrown generic Error doesn't update set.status, so we derive it).
const ERROR_CODE_STATUS: Record<string, number> = {
  VALIDATION: 422,
  NOT_FOUND: 404,
  PARSE: 400,
  INVALID_COOKIE_SIGNATURE: 401,
  INTERNAL_SERVER_ERROR: 500,
};

// Guard: refuse to boot in mock mode against a DB path that looks live.
if (MODE === 'mock' && DB_PATH && /live|prod|production/i.test(DB_PATH)) {
  console.error(`[boot] Refusing to start: CANNOLI_MODE=mock but DB_PATH=${DB_PATH} looks live.`);
  process.exit(1);
}

// Warn loudly: bot enabled without RSA private key → silent auth failure.
if (process.env.PS_SERVER_WS_URL && !process.env.PS_RSA_PRIVATE_KEY) {
  console.warn('[boot] WARNING: PS_SERVER_WS_URL is set but PS_RSA_PRIVATE_KEY is missing.');
  console.warn('[boot]          Bot will fail to authenticate; battles will not be detected.');
}

// Warn: production should run with NODE_ENV=production so SSO cookies set domain=.cannoli.live
if (MODE === 'live' && NODE_ENV !== 'production') {
  console.warn(`[boot] WARNING: CANNOLI_MODE=live but NODE_ENV=${NODE_ENV} (expected production).`);
  console.warn('[boot]          SSO cookies may not propagate across cannoli.live ↔ sim.cannoli.live.');
}

const app = new Elysia()
  .use(cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'https://cannoli.live',
      'https://mock.cannoli.live',
      'https://sim.cannoli.live',
      'http://sim.cannoli.localhost',
      'http://localhost:8080',
    ],
    credentials: true,
  }))

  // Rewrite /~~*/action.php → /api/ps/action.php (PS testclient compat)
  // Only rewrites non-canonical paths (e.g. /~~serverId/action.php from direct PS client hits).
  // The ps-client-server proxy already sends to /api/ps/action.php, so skip those.
  .onRequest(({ request, set }) => {
    // Stamp handler-start for the request logger (read back in onAfterResponse
    // to compute latency). Cheap WeakMap write; safe for every request.
    markRequestStart(request);
    const url = new URL(request.url);
    if (url.pathname.includes('/action.php') && url.pathname !== '/api/ps/action.php') {
      const newUrl = new URL(request.url);
      newUrl.pathname = '/api/ps/action.php';
      return fetch(new Request(newUrl.toString(), request));
    }
  })

  // Auth context — derived once, available to all routes.
  // We also fire a debounced heartbeat (touches users.last_seen_at) any time an
  // authenticated request lands on /api/*, so the who's-online widget has fresh
  // signal without needing a dedicated client-side ping. The debounce lives in
  // routes/online.ts to keep this file uncluttered.
  .derive(({ request }) => {
    const cookieHeader = request.headers.get('cookie') ?? undefined;
    const token = parseSessionToken(cookieHeader);
    const user = token ? validateSession(token) : null;
    if (user) touchHeartbeat(parseInt(user.id));
    return { user: user as AuthUser | null, sessionToken: token };
  })

  // ── Request logging (admin "API Logs" tab) ─────────────────────────────────
  // onError captures the thrown error's class/message/stack; onAfterResponse
  // writes the final row (deduped per Request, so an errored request that also
  // fires afterResponse produces exactly one row). Both are best-effort and
  // never throw — see lib/request-log.ts.
  .onError(({ request, error, code, set, user }) => {
    captureRequestError(request, error);
    // Write here too (deduped): if Elysia skips onAfterResponse for an errored
    // request, this is the only chance to record it. Prefer the framework error
    // code's status (a thrown Error leaves set.status at its default 200, so we
    // can't trust it); fall back to an explicit 4xx/5xx the handler set, else 500.
    const mapped = ERROR_CODE_STATUS[code];
    const status = mapped ??
      (typeof set.status === 'number' && set.status >= 400 ? set.status : 500);
    logRequest({ request, status, user });

    // For unhandled/unexpected server errors (5xx), return a generic shaped body
    // so raw Error.message and internal details are never leaked to the client.
    // 4xx codes (VALIDATION, NOT_FOUND, PARSE, INVALID_COOKIE_SIGNATURE) and
    // errors that already have an explicit <500 status set by the handler are
    // left alone — they return their own shaped bodies via the normal flow.
    const is4xx = mapped != null ? mapped < 500 : (typeof set.status === 'number' && set.status >= 400 && set.status < 500);
    if (!is4xx && status >= 500) {
      set.status = status;
      return {
        error: 'Internal error',
        requestId: getRequestId(request),
      };
    }
  })
  .onAfterResponse(({ request, set, user }) => {
    const status = typeof set.status === 'number' ? set.status : 200;
    logRequest({ request, status, user });
  })
  // Echo the per-request correlation id so a client can quote it alongside the
  // server log row. Set in onRequest (markRequestStart); read back here.
  .onRequest(({ request, set }) => {
    const rid = getRequestId(request);
    if (rid) set.headers['x-request-id'] = rid;
  })

  // ── Auth guards on state-changing requests ─────────────────────────────────
  // Two checks fire on the same set of requests (POST/PUT/PATCH/DELETE under
  // /api), in order:
  //   1. CSRF double-submit token: header X-CSRF-Token must match csrf_token
  //      cookie. The cookie is set by /api/auth/login + /api/auth/me; its
  //      value is HMAC(sessionToken, secret). Login itself is exempt.
  //   2. mustChangePassword guard: a user flagged for forced password reset
  //      can only hit /api/auth/change-password, /api/auth/logout, /api/auth/me.
  //
  // Reads (GET/HEAD) and unauthenticated requests pass through both guards;
  // CSRF only matters when there's a session cookie attached.
  .onBeforeHandle(({ request, user, sessionToken, set }) => {
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return;

    // ── CSRF double-submit ──
    // Exempt login itself (no session yet). Exempt the PS action.php proxy
    // path because Showdown's testclient does not participate in our CSRF
    // scheme; that endpoint has its own auth (sid cookie + signed assertion).
    const csrfExempt = path === '/api/auth/login' || path === '/api/ps/action.php';
    if (!csrfExempt && sessionToken) {
      const cookieHeader = request.headers.get('cookie') ?? undefined;
      const cookieToken = parseCsrfCookie(cookieHeader);
      const headerToken = request.headers.get('x-csrf-token');
      const expected = csrfTokenForSession(sessionToken);
      if (!cookieToken || !headerToken || cookieToken !== expected || headerToken !== expected) {
        set.status = 403;
        return { error: 'CSRF token missing or invalid', code: 'csrf_failed' };
      }
    }

    // ── Force password change ──
    if (user?.mustChangePassword) {
      const allowed =
        path === '/api/auth/change-password' ||
        path === '/api/auth/logout' ||
        path === '/api/auth/me' ||
        // PS SSO endpoints authenticate via the sid cookie + signed assertion,
        // independent of the app session. They must not be gated on the app's
        // forced-password-change flow, or Showdown auto-login breaks for any
        // coach who hasn't yet changed their default password. (Same rationale
        // as the CSRF exemption above.)
        path.startsWith('/api/ps/');
      if (!allowed) {
        set.status = 403;
        return { error: 'Password change required', code: 'must_change_password' };
      }
    }
  })

  .get('/', () => ({ message: 'cannoli api' }))
  .get('/health', () => ({ status: 'ok' }))

  // Ops health probe — uptime, mode, db connectivity. Mounted before all
  // route modules so it's reachable even if a feature route throws on boot.
  .get('/api/health', () => {
    let dbOk = false;
    try {
      sqlite.query('SELECT 1').get();
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return {
      status: dbOk ? 'ok' : 'degraded',
      mode: MODE,
      db: dbOk ? 'connected' : 'disconnected',
      uptime: Math.round(process.uptime()),
      // Deployed commit (SOURCE_COMMIT, 12 chars). The CI deploy job polls this
      // to confirm the *new* build actually came up before moving on / going green.
      version: GIT_SHA,
    };
  })

  .use(authRoutes)
  // Pin routes must register before userRoutes so /api/users/:username/pins
  // is matched before the more general /api/users/:username profile route.
  .use(pinRoutes)
  .use(onlineRoutes)
  .use(userRoutes)
  .use(leagueRoutes)
  .use(archiveDeepRoutes)
  .use(adminRoutes)
  .use(draftRoutes)
  .use(tradeRoutes)
  .use(matchRoutes)
  .use(feedbackRoutes)
  .use(changelogRoutes)
  .use(notificationRoutes)
  .use(clientErrorRoutes)
  .use(arenaRoutes)
  .use(psLoginRoutes)
  .use(psInternalRoutes)

  .listen(3001);

console.log(`Backend running at http://localhost:${app.server?.port}`);
console.log(`Mode: ${MODE}, NODE_ENV: ${NODE_ENV}`);

// Graceful shutdown — registered only when the server actually starts listening
// (this block is outside the app definition, so test imports that don't reach
// .listen() never register these handlers and won't close the DB under tests).
function shutdown(signal: string) {
  console.log(`[shutdown] received ${signal}, stopping schedulers and closing DB...`);
  stopSchedulers();
  stopHeartbeat();
  try { sqlite.close(); } catch { /* best-effort */ }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Self-heal the system bot accounts (root + CannoliBot) to the `bot` role on
// every boot, independent of whether the PS bot is configured.
reconcileBotRoles();

// Start PS Monitor Bot if configured
if (process.env.PS_SERVER_WS_URL) {
  // Ensure the chat-plugin-required `cannolibot` user exists in our DB
  // before starting the bot. The /cannoli-battle plugin gates on this row,
  // so booting without it leaves the bot unable to create matches.
  ensureBotUser();
  startBot();
  console.log('PS Monitor Bot starting...');
}

// Start cron-style schedulers (auto-forfeit, week-advance)
startSchedulers();

// In-process self-monitor: probes DB / PS bot on an interval, records into
// health_checks, and Discord-alerts on ok→down flips. Catches silent deaths
// (e.g. PS bot disconnect) that no user-facing error would ever surface.
startHeartbeat();

// Process-level crash backstop. An uncaughtException / unhandledRejection
// bypasses Elysia's onError entirely — capture it into the observability
// pipeline (grouped + Discord-alerted) before the runtime would otherwise
// swallow or terminate. Best-effort; logging itself never throws.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  logServerFault({
    kind: 'process',
    name: err?.name ?? 'UncaughtException',
    message: err?.message ?? String(err),
    stack: err?.stack ?? null,
    path: '/process/uncaughtException',
  });
});
process.on('unhandledRejection', (reason: any) => {
  console.error('[unhandledRejection]', reason);
  logServerFault({
    kind: 'process',
    name: reason?.name ?? 'UnhandledRejection',
    message: reason?.message ?? String(reason),
    stack: reason?.stack ?? null,
    path: '/process/unhandledRejection',
  });
});

console.log(`Build: ${GIT_SHA}`);

export type App = typeof app;
