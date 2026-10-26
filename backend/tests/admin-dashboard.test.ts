import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { adminRoutes } from '../src/routes/admin';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

const tag = `dash-${Date.now()}`;
const userIds: number[] = [];
const app = new Elysia()
  .derive(({ request }) => {
    const token = parseSessionToken(request.headers.get('cookie') ?? undefined);
    return { user: token ? validateSession(token) : null, sessionToken: token };
  })
  .use(adminRoutes);

function mk(name: string, role: 'dev' | 'admin' | 'user'): string {
  const u = db.insert(schema.users).values({
    username: `${tag}-${name}`, passwordHash: 'x', role, mustChangePassword: false, active: true,
  }).returning().get();
  userIds.push(u.id);
  return createSession(u.id);
}
const get = (cookie?: string) => app.handle(new Request('http://localhost/api/admin/dashboard', { headers: cookie ? { cookie: `session=${cookie}` } : {} }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const counts = async (c: string) => (await (await get(c)).json()) as any;

let admin: string, dev: string, coach: string;
const faIds: number[] = [];
const tradeIds: number[] = [];

beforeAll(() => {
  admin = mk('admin', 'admin'); dev = mk('dev', 'dev'); coach = mk('coach', 'user');
});
afterAll(() => {
  try {
    for (const id of faIds) db.delete(schema.faRequests).where(eq(schema.faRequests.id, id)).run();
    for (const id of tradeIds) db.delete(schema.trades).where(eq(schema.trades.id, id)).run();
    for (const id of userIds) {
      db.delete(schema.sessions).where(eq(schema.sessions.userId, id)).run();
      db.delete(schema.users).where(eq(schema.users.id, id)).run();
    }
  } catch { /* teardown */ }
});

describe('GET /api/admin/dashboard', () => {
  test('401 anon, 403 non-staff', async () => {
    expect((await get()).status).toBe(401);
    expect((await get(coach)).status).toBe(403);
  });

  test('counts pending queues; alerts dev-only', async () => {
    const team = db.select().from(schema.teams).limit(1).get();
    if (!team) return; // empty DB: nothing to attach rows to
    const before = await counts(admin);
    const fa = (type: 'pickup' | 'tera_change', status: 'pending' | 'approved') =>
      faIds.push(db.insert(schema.faRequests).values({
        leagueId: team.leagueId, week: 1, teamId: team.id, status, requestType: type,
        pickups: '["A"]', drops: '[]', teraChanges: type === 'tera_change' ? '[{"pokemonName":"A","teraTypes":["Fire"]}]' : null,
      }).returning().get().id);
    fa('pickup', 'pending'); fa('pickup', 'approved'); fa('tera_change', 'pending'); fa('tera_change', 'pending');
    tradeIds.push(db.insert(schema.trades).values({
      leagueId: team.leagueId, week: 1, status: 'awaiting_admin', proposerId: team.id, recipientId: team.id,
      offering: '["A"]', requesting: '["B"]',
    }).returning().get().id);

    const after = await counts(admin);
    expect(after.fa.count).toBe(before.fa.count + 1);
    expect(after.tera.count).toBe(before.tera.count + 2);
    expect(after.trades.count).toBe(before.trades.count + 1);
    expect(after.fa.top.length).toBeLessThanOrEqual(3);
    expect(after.alerts).toBeNull();
    const d = await counts(dev);
    expect(typeof d.alerts.errors).toBe('number');
    expect(['green', 'yellow', 'red']).toContain(d.alerts.bot);
  });
});
