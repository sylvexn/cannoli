/**
 * Spoiler-free preferences + per-week reveal.
 *
 * Verifies the contract the frontend depends on:
 *   - spoiler-free mode defaults ON, with an empty per-league reveal map
 *   - POST /spoiler-reveal bumps a league's high-water mark to max(existing, week)
 *     (catch-up: revealing week N reveals weeks 1..N) and persists
 *   - marks are per-league and only ever move forward
 *   - validation (bad week / empty leagueId → 400; unauthenticated → 401)
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { userRoutes } from '../src/routes/users';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

function buildApp() {
  return new Elysia()
    .derive(({ request }) => {
      const cookieHeader = request.headers.get('cookie') ?? undefined;
      const token = parseSessionToken(cookieHeader);
      const user = token ? validateSession(token) : null;
      return { user, sessionToken: token };
    })
    .use(userRoutes);
}

const tag = `spoiler-${Date.now()}`;
let app: Elysia;
let userId: number;
let session: string;
const cookie = () => `session=${session}`;

function hit(method: string, path: string, c?: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (c) headers.cookie = c;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.handle(new Request(`http://localhost${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }));
}

beforeAll(() => {
  app = buildApp();
  const u = db.insert(schema.users).values({
    username: `${tag}-u`, passwordHash: 'x', role: 'user', mustChangePassword: false, active: true,
  }).returning().get();
  userId = u.id;
  session = createSession(userId);
});

afterAll(() => {
  try {
    db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)).run();
    db.delete(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)).run();
    db.delete(schema.users).where(eq(schema.users.id, userId)).run();
  } catch { /* best-effort cleanup */ }
});

describe('spoiler-free preferences + per-week reveal', () => {
  test('GET preferences defaults spoiler-free ON with an empty reveal map (no row yet)', async () => {
    const res = await hit('GET', '/api/users/me/preferences', cookie());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.spoilerFreeMode).toBe(true);
    expect(body.spoilerRevealedThrough).toEqual({});
  });

  test('reveal bumps a league high-water mark, persists, and keeps spoiler-free ON', async () => {
    const r = await hit('POST', '/api/users/me/spoiler-reveal', cookie(), { leagueId: 's-test', week: 3 });
    expect(r.status).toBe(200);
    expect((await r.json()).spoilerRevealedThrough).toEqual({ 's-test': 3 });

    const g = await (await hit('GET', '/api/users/me/preferences', cookie())).json();
    expect(g.spoilerRevealedThrough).toEqual({ 's-test': 3 });
    // Creating the row via reveal must not silently disable spoiler-free.
    expect(g.spoilerFreeMode).toBe(true);
  });

  test('mark only moves forward (max), never backward', async () => {
    await hit('POST', '/api/users/me/spoiler-reveal', cookie(), { leagueId: 's-test', week: 1 });
    let g = await (await hit('GET', '/api/users/me/preferences', cookie())).json();
    expect(g.spoilerRevealedThrough['s-test']).toBe(3);

    await hit('POST', '/api/users/me/spoiler-reveal', cookie(), { leagueId: 's-test', week: 5 });
    g = await (await hit('GET', '/api/users/me/preferences', cookie())).json();
    expect(g.spoilerRevealedThrough['s-test']).toBe(5);
  });

  test('marks are per-league (independent)', async () => {
    await hit('POST', '/api/users/me/spoiler-reveal', cookie(), { leagueId: 's-other', week: 2 });
    const g = await (await hit('GET', '/api/users/me/preferences', cookie())).json();
    expect(g.spoilerRevealedThrough).toEqual({ 's-test': 5, 's-other': 2 });
  });

  test('validation: bad week → 400, empty leagueId → 400, unauthenticated → 401', async () => {
    expect((await hit('POST', '/api/users/me/spoiler-reveal', cookie(), { leagueId: 's-test', week: 0 })).status).toBe(400);
    expect((await hit('POST', '/api/users/me/spoiler-reveal', cookie(), { leagueId: 's-test', week: 1.5 })).status).toBe(400);
    expect((await hit('POST', '/api/users/me/spoiler-reveal', cookie(), { leagueId: '', week: 2 })).status).toBe(400);
    expect((await hit('POST', '/api/users/me/spoiler-reveal', undefined, { leagueId: 's-test', week: 2 })).status).toBe(401);
  });
});
