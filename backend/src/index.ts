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
  .onRequest(({ request, set }) => {
    const url = new URL(request.url);
    if (url.pathname.includes('/action.php')) {
      // Rewrite to our PS login action handler
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

// Start PS Monitor Bot if configured
if (process.env.PS_SERVER_WS_URL) {
  startBot();
  console.log('PS Monitor Bot starting...');
}

export type App = typeof app;
