/**
 * Draft-order lock: permutation validation, lock persistence, non-staff visibility,
 * start-draft auto-lock, history endpoint. Uses an isolated fixture league (unique ids).
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { adminRoutes } from '../src/routes/admin';
import { leagueRoutes } from '../src/routes/leagues';
import { draftRoutes } from '../src/routes/draft';
import { startDraft } from '../src/lib/draft-engine';
import { buildDraftFixture, type DraftFixture } from './draft-fixture';

const app = new Elysia()
  .derive(({ request }) => {
    const token = parseSessionToken(request.headers.get('cookie') ?? undefined);
    return { user: token ? validateSession(token) : null, sessionToken: token };
  })
  .use(adminRoutes)
  .use(leagueRoutes)
  .use(draftRoutes);

const tag = `dord-${Date.now()}`;
const userIds: number[] = [];
let staff: string;
let coach: string;
let fx: DraftFixture;

function mkUser(name: string, role: 'admin' | 'user'): string {
  const u = db.insert(schema.users).values({
    username: `${tag}-${name}`, passwordHash: 'x', role, mustChangePassword: false, active: true,
  }).returning().get();
  userIds.push(u.id);
  return createSession(u.id);
}

const call = (method: string, path: string, session?: string, body?: unknown) =>
  app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(session ? { cookie: `session=${session}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

const leagueRow = () => db.select().from(schema.leagues).where(eq(schema.leagues.id, fx.leagueId)).get()!;
const listedOrder = async (session?: string) => {
  const rows = await (await call('GET', '/api/leagues?all=1', session)).json() as any[];
  return rows.find(l => l.id === fx.leagueId);
};

beforeAll(() => {
  staff = mkUser('staff', 'admin');
  coach = mkUser('coach', 'user');
  fx = buildDraftFixture({ teams: 4, status: 'not_started' });
  // Pre-draft world: no picks, draft phase not yet started.
  db.update(schema.leagues).set({ phase: 'predraft', draftOrder: null }).where(eq(schema.leagues.id, fx.leagueId)).run();
});

afterAll(() => {
  try {
    db.delete(schema.activityLog).where(eq(schema.activityLog.leagueId, fx.leagueId)).run();
    fx.cleanup();
    for (const id of userIds) {
      db.delete(schema.sessions).where(eq(schema.sessions.userId, id)).run();
      db.delete(schema.users).where(eq(schema.users.id, id)).run();
    }
  } catch { /* DB closed during suite teardown */ }
});

describe('POST /draft-order validation', () => {
  const url = () => `/api/leagues/${fx.leagueId}/draft-order`;

  test('rejects non-permutations with 400', async () => {
    const [a, b, c, d] = fx.teamIds;
    for (const order of [[a, b, c], [a, b, c, c], [a, b, c, 'nope'], [a, b, c, d, a], 'x']) {
      const res = await call('POST', url(), staff, { order });
      expect(res.status).toBe(400);
    }
    expect(leagueRow().draftOrder).toBeNull();
  });

  test('requires staff', async () => {
    expect((await call('POST', url(), coach, { order: fx.teamIds })).status).toBe(403);
    expect((await call('POST', url(), undefined, { order: fx.teamIds })).status).toBe(401);
  });

  test('valid order persists; lock unchanged when omitted, set when provided', async () => {
    const order = [...fx.teamIds].reverse();
    let res = await call('POST', url(), staff, { order });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, draftOrderLocked: false });
    expect(JSON.parse(leagueRow().draftOrder!)).toEqual(order);

    res = await call('POST', url(), staff, { order, locked: true });
    expect(await res.json()).toEqual({ success: true, draftOrderLocked: true });
    expect(leagueRow().draftOrderLocked).toBe(true);

    res = await call('POST', url(), staff, { order }); // omitted -> unchanged
    expect((await res.json() as any).draftOrderLocked).toBe(true);

    expect((await call('POST', url(), staff, { order, locked: 'yes' })).status).toBe(400);

    res = await call('POST', url(), staff, { order, locked: false });
    expect((await res.json() as any).draftOrderLocked).toBe(false);
  });
});

describe('visibility', () => {
  test('non-staff see null until locked; staff always see the order', async () => {
    const order = [...fx.teamIds];
    await call('POST', `/api/leagues/${fx.leagueId}/draft-order`, staff, { order, locked: false });

    for (const s of [undefined, coach]) {
      const l = await listedOrder(s);
      expect(l.draftOrder).toBeNull();
      expect(l.draftOrderLocked).toBe(false);
    }
    const asStaff = await listedOrder(staff);
    expect(asStaff.draftOrder).toEqual(order);
    expect(asStaff.draftOrderLocked).toBe(false);

    await call('POST', `/api/leagues/${fx.leagueId}/draft-order`, staff, { order, locked: true });
    for (const s of [undefined, coach, staff]) {
      const l = await listedOrder(s);
      expect(l.draftOrder).toEqual(order);
      expect(l.draftOrderLocked).toBe(true);
    }
  });

  test('draft state snapshot does not leak an unlocked order to non-staff', async () => {
    db.update(schema.leagues).set({ phase: 'draft', draftOrderLocked: false }).where(eq(schema.leagues.id, fx.leagueId)).run();
    db.update(schema.draftState).set({ status: 'in_progress' }).where(eq(schema.draftState.leagueId, fx.leagueId)).run();
    const pub = await (await call('GET', `/api/leagues/${fx.leagueId}/draft/state`, coach)).json() as any;
    expect(pub.status).toBe('not_started');
    const adm = await (await call('GET', `/api/leagues/${fx.leagueId}/draft/state`, staff)).json() as any;
    expect(adm.snakeOrder?.length).toBeGreaterThan(0);
    db.update(schema.draftState).set({ status: 'not_started' }).where(eq(schema.draftState.leagueId, fx.leagueId)).run();
  });
});

describe('startDraft', () => {
  test('auto-locks the order', () => {
    db.update(schema.leagues).set({ draftOrderLocked: false }).where(eq(schema.leagues.id, fx.leagueId)).run();
    const r = startDraft(fx.leagueId, 120, 'tester', { force: true });
    expect(r.success).toBe(true);
    expect(leagueRow().draftOrderLocked).toBe(true);
  });
});

describe('GET /draft-order/history', () => {
  test('staff-only, newest first, documented shape', async () => {
    const url = `/api/leagues/${fx.leagueId}/draft-order/history`;
    expect((await call('GET', url, coach)).status).toBe(403);
    expect((await call('GET', url)).status).toBe(401);

    const res = await call('GET', url, staff);
    expect(res.status).toBe(200);
    const rows = await res.json() as any[];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.length).toBeLessThanOrEqual(20);
    for (const r of rows) {
      expect(r.actor).toBe(`${tag}-staff`);
      expect(new Date(r.at).toISOString()).toBe(r.at);
      expect(r.order.slice().sort()).toEqual(fx.teamIds.slice().sort());
      expect(typeof r.locked).toBe('boolean');
    }
    // Last POST was locked:true then... the final successful call before this test set locked via POSTs;
    // newest-first means the first row reflects the most recent write (locked:true).
    expect(rows[0].locked).toBe(true);
  });
});
