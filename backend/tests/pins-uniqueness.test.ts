/**
 * Cross-cutting season-stress tests for pin award uniqueness + idempotency
 * (routes/pins.ts → POST /api/admin/pins/award).
 *
 * Coverage (scope #4):
 *   - season-scoped uniqueness: unique (userId × pinDefId × seasonId). The same
 *     pin may be earned in distinct seasons; a second award for the SAME season
 *     is a 409 no-op (no duplicate row).
 *   - lifetime pins (seasonId = NULL): NULL participates in the SQLite unique
 *     index, so a season-agnostic pin can be awarded at most once per user.
 *   - award idempotency: re-awarding (admin double-click) returns 409 and does
 *     NOT insert a duplicate.
 *
 * Driven through the real pinRoutes group with a staff user injected.
 * Fixtures (a throwaway user, pin def, and the two seed seasons) are torn down
 * in afterAll.
 */
import { describe, expect, test, afterAll, beforeAll } from 'bun:test';
import { Elysia } from 'elysia';
import { db, schema } from '../src/db';
import { eq, and, like, sql } from 'drizzle-orm';
import { pinRoutes } from '../src/routes/pins';

// `id` is repointed in beforeAll at the throwaway fixture user — `pins.awarded_by`
// is an FK to `users.id`, so a hardcoded '1' 500s on any DB where user 1 was
// never seeded (e.g. CI's fresh DB). role/username drive isStaff + the log actor.
const STAFF = { id: '1', username: 'pintester', role: 'admin' as const };
const TEST_USERNAME = 'pin-uniq-fixture';
const TEST_DEF = 'pin-uniq-test-def';

function makeApp() {
  return new Elysia()
    .derive(() => ({ user: STAFF, sessionToken: 'test-session' }))
    .use(pinRoutes);
}

async function award(body: unknown): Promise<{ status: number; json: any }> {
  const res = await makeApp().handle(new Request('http://localhost/api/admin/pins/award', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json().catch(() => null) };
}

let userId: number;
let seasonA: number;
let seasonB: number;

beforeAll(() => {
  // Throwaway user
  db.delete(schema.pins).where(sql`user_id IN (SELECT id FROM users WHERE username = ${TEST_USERNAME})`).run();
  db.delete(schema.users).where(eq(schema.users.username, TEST_USERNAME)).run();
  userId = db.insert(schema.users).values({
    username: TEST_USERNAME, passwordHash: 'x', role: 'user', active: true,
  }).returning().get().id;
  // Award AS this real user so `pins.awarded_by` satisfies its FK on any DB.
  STAFF.id = String(userId);

  // Throwaway pin definition
  db.delete(schema.pinDefinitions).where(eq(schema.pinDefinitions.id, TEST_DEF)).run();
  db.insert(schema.pinDefinitions).values({
    id: TEST_DEF, name: 'Uniqueness Test Pin', description: '', iconName: 'Award',
    color: '#fbbf24', category: 'custom', isAuto: false,
  }).run();

  // Two throwaway NON-archived seasons so the award endpoint's
  // checkSeasonArchived guard never short-circuits. (The seeded S1 is
  // archived; relying on seed seasons would hit a 409 season_archived.)
  seasonA = db.insert(schema.seasons).values({ seasonNumber: 9001, archived: false }).returning().get().id;
  seasonB = db.insert(schema.seasons).values({ seasonNumber: 9002, archived: false }).returning().get().id;
});

afterAll(() => {
  db.delete(schema.pins).where(eq(schema.pins.userId, userId)).run();
  db.delete(schema.pins).where(eq(schema.pins.pinDefId, TEST_DEF)).run();
  db.delete(schema.pinDefinitions).where(eq(schema.pinDefinitions.id, TEST_DEF)).run();
  db.delete(schema.users).where(eq(schema.users.id, userId)).run();
  db.delete(schema.seasons).where(eq(schema.seasons.id, seasonA)).run();
  db.delete(schema.seasons).where(eq(schema.seasons.id, seasonB)).run();
});

function pinCount(seasonId: number | null): number {
  return db.select().from(schema.pins).where(and(
    eq(schema.pins.userId, userId),
    eq(schema.pins.pinDefId, TEST_DEF),
    seasonId == null ? sql`${schema.pins.seasonId} IS NULL` : eq(schema.pins.seasonId, seasonId),
  )).all().length;
}

describe('pin award — season-scoped uniqueness', () => {
  test('same user + def in two DIFFERENT seasons → both awarded', async () => {
    if (seasonA === seasonB) { expect(true).toBe(true); return; } // need 2 distinct seasons
    const a = await award({ userId, pinDefId: TEST_DEF, seasonId: seasonA });
    const b = await award({ userId, pinDefId: TEST_DEF, seasonId: seasonB });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(pinCount(seasonA)).toBe(1);
    expect(pinCount(seasonB)).toBe(1);
  });

  test('same user + def + SAME season twice → second is 409, no duplicate row', async () => {
    // Clean slate for seasonA.
    db.delete(schema.pins).where(and(eq(schema.pins.userId, userId), eq(schema.pins.pinDefId, TEST_DEF), eq(schema.pins.seasonId, seasonA))).run();
    const first = await award({ userId, pinDefId: TEST_DEF, seasonId: seasonA });
    expect(first.status).toBe(200);
    const second = await award({ userId, pinDefId: TEST_DEF, seasonId: seasonA });
    expect(second.status).toBe(409);
    expect(second.json.error).toMatch(/already has this pin/i);
    expect(pinCount(seasonA)).toBe(1);
  });
});

describe('pin award — lifetime (NULL season) uniqueness', () => {
  // PIN-NULL-SEASON-DUP (FIXED): a partial unique index
  // `pins_user_def_lifetime_idx` ON (user_id, pin_def_id) WHERE season_id IS
  // NULL (migration 0041) now dedupes lifetime pins — SQLite's default
  // "every NULL is distinct" behavior in the full composite index meant
  // (user, def, NULL) rows never collided, so a second lifetime award used to
  // insert a duplicate. With the partial index, INSERT OR IGNORE no-ops the
  // dup → the award handler returns 409.
  test('lifetime pin awarded once; second award is 409 no-op', async () => {
    db.delete(schema.pins).where(and(eq(schema.pins.userId, userId), eq(schema.pins.pinDefId, TEST_DEF), sql`${schema.pins.seasonId} IS NULL`)).run();
    const first = await award({ userId, pinDefId: TEST_DEF }); // no seasonId → NULL
    expect(first.status).toBe(200);
    expect(pinCount(null)).toBe(1);

    const second = await award({ userId, pinDefId: TEST_DEF, seasonId: null });
    expect(second.status).toBe(409);
    expect(pinCount(null)).toBe(1);
  });

  test('a lifetime (NULL) pin and a season-scoped pin of the same def coexist', async () => {
    if (seasonA == null) { expect(true).toBe(true); return; }
    db.delete(schema.pins).where(and(eq(schema.pins.userId, userId), eq(schema.pins.pinDefId, TEST_DEF))).run();
    const lifetime = await award({ userId, pinDefId: TEST_DEF, seasonId: null });
    const scoped = await award({ userId, pinDefId: TEST_DEF, seasonId: seasonA });
    expect(lifetime.status).toBe(200);
    expect(scoped.status).toBe(200);
    expect(pinCount(null)).toBe(1);
    expect(pinCount(seasonA)).toBe(1);
  });
});

describe('pin award — idempotency under repeated calls', () => {
  test('awarding the same season pin 5 times yields exactly one row', async () => {
    db.delete(schema.pins).where(and(eq(schema.pins.userId, userId), eq(schema.pins.pinDefId, TEST_DEF), eq(schema.pins.seasonId, seasonA))).run();
    let okCount = 0, dupCount = 0;
    for (let i = 0; i < 5; i++) {
      const r = await award({ userId, pinDefId: TEST_DEF, seasonId: seasonA });
      if (r.status === 200) okCount++;
      else if (r.status === 409) dupCount++;
    }
    expect(okCount).toBe(1);
    expect(dupCount).toBe(4);
    expect(pinCount(seasonA)).toBe(1);
  });

  test('award returns the inserted pin id on first success', async () => {
    db.delete(schema.pins).where(and(eq(schema.pins.userId, userId), eq(schema.pins.pinDefId, TEST_DEF), eq(schema.pins.seasonId, seasonA))).run();
    const r = await award({ userId, pinDefId: TEST_DEF, seasonId: seasonA });
    expect(r.status).toBe(200);
    expect(typeof r.json.id).toBe('number');
  });
});

describe('pin award — input + auth guards', () => {
  test('missing userId / pinDefId → 400', async () => {
    const r = await award({ pinDefId: TEST_DEF });
    expect(r.status).toBe(400);
  });

  test('unknown pinDefId → 404', async () => {
    const r = await award({ userId, pinDefId: 'no-such-pin-def-xyz' });
    expect(r.status).toBe(404);
  });

  test('non-staff is forbidden', async () => {
    const app = new Elysia()
      .derive(() => ({ user: { id: '99', username: 'rando', role: 'user' }, sessionToken: 's' }))
      .use(pinRoutes);
    const res = await app.handle(new Request('http://localhost/api/admin/pins/award', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, pinDefId: TEST_DEF }),
    }));
    expect(res.status).toBe(403);
  });
});

// keep `like` referenced if a future edit drops its sole use
void like;
