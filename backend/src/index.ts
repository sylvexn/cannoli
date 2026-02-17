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

const app = new Elysia()
  .use(cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'https://cannoli.live',
      'https://mock.cannoli.live',
    ],
    credentials: true,
  }))

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

  .listen(3001);

console.log(`Backend running at http://localhost:${app.server?.port}`);

export type App = typeof app;
