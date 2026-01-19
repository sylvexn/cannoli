import { Elysia } from 'elysia';

const app = new Elysia()
  .get('/', () => ({ message: 'cannoli api' }))
  .get('/health', () => ({ status: 'ok' }))
  .listen(3001);

console.log(`Backend running at http://localhost:${app.server?.port}`);

export type App = typeof app;
