import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { parseSessionToken, validateSession } from './lib/auth';
import type { AuthUser } from './middleware/auth';

import { authRoutes } from './routes/auth';
import { leagueRoutes } from './routes/leagues';
import { adminRoutes } from './routes/admin';
import { draftRoutes } from './routes/draft';
import { tradeRoutes } from './routes/trades';
import { matchRoutes } from './routes/matches';
import { feedbackRoutes } from './routes/feedback';
import { arenaRoutes } from './routes/arena';
import { psLoginRoutes } from './routes/ps-login';
import { startBot } from './lib/ps-bot';
import { startSchedulers } from './lib/scheduler';

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

  // Auth context — derived once, available to all routes
  .derive(({ request }) => {
    const cookieHeader = request.headers.get('cookie') ?? undefined;
    const token = parseSessionToken(cookieHeader);
    const user = token ? validateSession(token) : null;
    return { user: user as AuthUser | null, sessionToken: token };
  })

  .get('/', () => ({ message: 'cannoli api' }))
  .get('/health', () => ({ status: 'ok' }))

  .use(authRoutes)
  .use(leagueRoutes)
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
  startBot();
  console.log('PS Monitor Bot starting...');
}

// Start cron-style schedulers (auto-forfeit, week-advance)
startSchedulers();

export type App = typeof app;
