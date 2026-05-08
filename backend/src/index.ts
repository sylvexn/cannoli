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
import { arenaRoutes } from './routes/arena';
import { psLoginRoutes } from './routes/ps-login';
import { pinRoutes } from './routes/pins';
import { archiveDeepRoutes } from './routes/archive';
import { startBot } from './lib/ps-bot';
import { ensureBotUser } from './lib/ps-bot-seed';
import { startSchedulers } from './lib/scheduler';
import { sqlite } from './db';

// ─── Boot-time env guards ───────────────────────────────────────────────────
// Catch foot-guns before they cause silent corruption / silent auth failure.

const MODE = process.env.CANNOLI_MODE || 'mock';
const NODE_ENV = process.env.NODE_ENV || 'development';
const DB_PATH = process.env.CANNOLI_DB_PATH;

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
        path === '/api/auth/me';
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
  .use(arenaRoutes)
  .use(psLoginRoutes)

  .listen(3001);

console.log(`Backend running at http://localhost:${app.server?.port}`);
console.log(`Mode: ${MODE}, NODE_ENV: ${NODE_ENV}`);

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

export type App = typeof app;
