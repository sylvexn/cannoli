/** Step B: ruleset in league/archive payloads, wizard ruleset assignment, per-league rule edits. */
import { afterAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq, inArray, like } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { leagueRoutes } from '../src/routes/leagues';
import { leagueAdminRoutes } from '../src/routes/admin/leagues';
import { seasonRoutes } from '../src/routes/admin/seasons';
import { archiveDeepRoutes as archiveFullRoutes } from '../src/routes/archive';
import { getLeagueRuleset, invalidateRulesetCache } from '../src/lib/rulesets';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

const tag = `rsapi-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const staff = db.insert(schema.users).values({ username: tag, passwordHash: 'x', role: 'admin' }).returning().get();
const app = new Elysia()
  .derive(() => ({ user: { id: String(staff.id), role: 'admin', username: tag } }))
  .use(leagueRoutes)
  .use(leagueAdminRoutes)
  .use(seasonRoutes)
  .use(archiveFullRoutes);

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.handle(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) as any }; } catch { return { status: res.status, json: { raw: text } as any }; }
};

// Very high season numbers so the new season is "latest" for GET /api/leagues.
const SEASON = 80000 + Math.floor(Math.random() * 9000);
const mkTemplate = (over: Record<string, unknown> = {}) => db.insert(schema.rulesets).values({
  name: `${tag}-tpl-${Math.random()}`, isTemplate: true, costFormat: 'natdex', pointCap: 120, rosterSize: 10,
  teraCaptainSlots: 3, teraMarkup: JSON.stringify({ 9: 12, 8: 10 }), ...over,
}).returning().get();

afterAll(() => {
  const lg = db.select({ id: schema.leagues.id }).from(schema.leagues).where(like(schema.leagues.id, `${tag}%`)).all().map(l => l.id);
  if (lg.length) {
    db.delete(schema.activityLog).where(inArray(schema.activityLog.leagueId, lg)).run();
    db.delete(schema.teams).where(inArray(schema.teams.leagueId, lg)).run();
    db.delete(schema.leagues).where(inArray(schema.leagues.id, lg)).run();
  }
  sqlite.exec(`DELETE FROM rulesets WHERE name LIKE '%${tag}%' AND source_ruleset_id IS NOT NULL`);
  sqlite.exec(`DELETE FROM rulesets WHERE name LIKE '%${tag}%'`);
  db.delete(schema.seasons).where(eq(schema.seasons.seasonNumber, SEASON)).run();
  db.delete(schema.activityLog).where(like(schema.activityLog.description, `%Season ${SEASON}%`)).run();
  db.delete(schema.users).where(eq(schema.users.id, staff.id)).run();
  invalidateRulesetCache();
});

let a = '', b = '';
let rsA = 0, rsB = 0;

describe('wizard assigns rulesets + cost_format', () => {
  test('per-league rulesetId, season-level prefill, cost format written', async () => {
    const tplEmerald = mkTemplate({ costFormat: 'natdex', pointCap: 120 });
    const tplRuby = mkTemplate({ costFormat: 'natdexplus', pointCap: 100, teraCaptainSlots: 1 });
    a = `${tag}-a`; b = `${tag}-b`;
    const res = await call('POST', '/api/seasons', {
      seasonNumber: SEASON, rulesetId: tplRuby.id,
      leagues: [
        { id: a, name: `${tag} A`, color: '#111', rulesetId: tplEmerald.id },
        { id: b, name: `${tag} B`, color: '#222' }, // falls back to season-level
      ],
    });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.json.leagues.map((l: any) => [l.id, l]));
    expect(byId[a].costFormat).toBe('natdex');
    expect(byId[b].costFormat).toBe('natdexplus');
    rsA = byId[a].rulesetId; rsB = byId[b].rulesetId;
    expect(rsA).not.toBe(tplEmerald.id); // instance, not the template itself
    const rowA = db.select().from(schema.leagues).where(eq(schema.leagues.id, a)).get()!;
    expect([rowA.costFormat, rowA.rulesetId]).toEqual(['natdex', rsA]);
    const inst = db.select().from(schema.rulesets).where(eq(schema.rulesets.id, rsA)).get()!;
    expect([inst.isTemplate, inst.sourceRulesetId, inst.pointCap]).toEqual([false, tplEmerald.id, 120]);
  });

  test('legacy payload (no rulesetId) builds instances and defaults cost format explicitly', async () => {
    const res = await call('POST', '/api/seasons', {
      overlapOverride: true, seasonNumber: SEASON + 1, pointCap: 90, teraCaptainSlots: 1, costFormat: 'natdex',
      leagues: [{ id: `${tag}-legacy`, name: `${tag} L`, color: '#333' }],
    });
    expect(res.status).toBe(200);
    const l = db.select().from(schema.leagues).where(eq(schema.leagues.id, `${tag}-legacy`)).get()!;
    const r = db.select().from(schema.rulesets).where(eq(schema.rulesets.id, l.rulesetId!)).get()!;
    expect([l.costFormat, r.costFormat, r.pointCap, r.teraCaptainSlots]).toEqual(['natdex', 'natdex', 90, 1]);
    db.delete(schema.leagues).where(eq(schema.leagues.id, `${tag}-legacy`)).run();
    db.delete(schema.seasons).where(eq(schema.seasons.seasonNumber, SEASON + 1)).run();
  });

  test('unknown ruleset is a 400 and creates nothing', async () => {
    const res = await call('POST', '/api/seasons', {
      overlapOverride: true, seasonNumber: SEASON + 2, leagues: [{ id: `${tag}-bad`, name: 'x', color: '#000', rulesetId: 99999999 }],
    });
    expect(res.status).toBe(400);
    expect(db.select().from(schema.seasons).where(eq(schema.seasons.seasonNumber, SEASON + 2)).get()).toBeUndefined();
  });
});

describe('league payload', () => {
  test('includes ruleset + compat aliases from the league ruleset', async () => {
    const { json } = await call('GET', '/api/leagues');
    const la = json.find((l: any) => l.id === a);
    expect(la.rulesetId).toBe(rsA);
    expect(la.ruleset).toMatchObject({ pointCap: 120, teraCaptainSlots: 3, costFormat: 'natdex' });
    expect(la.costFormat).toBe('natdex');
    expect(la.season.pointCap).toBe(120);
    expect(la.season.teraCaptainSlots).toBe(3);
    expect(la.season.rosterSize).toBe(10);
    const lb = json.find((l: any) => l.id === b);
    expect(lb.season.pointCap).toBe(100); // per league, not per season
  });
});

describe('PUT /api/leagues/:id edits the ruleset, not the season', () => {
  test('cap edit hits one league only and leaves the season row alone', async () => {
    const seasonId = db.select().from(schema.leagues).where(eq(schema.leagues.id, a)).get()!.seasonId;
    const before = db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).get()!;
    const res = await call('PUT', `/api/leagues/${a}`, { pointCap: 130, teraCaptainSlots: 2 });
    expect(res.status).toBe(200);
    const { json } = await call('GET', '/api/leagues');
    expect(json.find((l: any) => l.id === a).season).toMatchObject({ pointCap: 130, teraCaptainSlots: 2 });
    expect(json.find((l: any) => l.id === b).season).toMatchObject({ pointCap: 100, teraCaptainSlots: 1 });
    const after = db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).get()!;
    expect([after.pointCap, after.teraCaptainSlots]).toEqual([before.pointCap, before.teraCaptainSlots]);
    // unchanged values in a full-form PUT are no-ops
    expect((await call('PUT', `/api/leagues/${a}`, { pointCap: 130, name: `${tag} A` })).status).toBe(200);
  });

  test('roster size edit reaches the ruleset that enforcement reads', async () => {
    expect((await call('PUT', `/api/leagues/${a}`, { rosterSize: 11 })).status).toBe(200);
    invalidateRulesetCache();
    expect(getLeagueRuleset(a).rosterSize).toBe(11);
    expect(db.select().from(schema.leagues).where(eq(schema.leagues.id, a)).get()!.rosterSize).toBe(11);
  });

  test('instance shared by two leagues is forked, not edited in place', async () => {
    db.update(schema.leagues).set({ rulesetId: rsA }).where(eq(schema.leagues.id, b)).run();
    invalidateRulesetCache();
    expect((await call('PUT', `/api/leagues/${b}`, { pointCap: 77 })).status).toBe(200);
    const rowB = db.select().from(schema.leagues).where(eq(schema.leagues.id, b)).get()!;
    expect(rowB.rulesetId).not.toBe(rsA);
    expect(db.select().from(schema.rulesets).where(eq(schema.rulesets.id, rsA)).get()!.pointCap).toBe(130);
    const { json } = await call('GET', '/api/leagues');
    expect(json.find((l: any) => l.id === b).season.pointCap).toBe(77);
  });

  test('frozen ruleset -> 409 RULESET_FROZEN with fork hint; ruleset untouched', async () => {
    db.update(schema.leagues).set({ phase: 'regular' }).where(eq(schema.leagues.id, a)).run();
    const res = await call('PUT', `/api/leagues/${a}`, { pointCap: 140 });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('RULESET_FROZEN');
    expect(res.json.hint).toContain(`/api/admin/rulesets/${rsA}/fork`);
    expect(db.select().from(schema.rulesets).where(eq(schema.rulesets.id, rsA)).get()!.pointCap).toBe(130);
    // non-rule fields still editable
    expect((await call('PUT', `/api/leagues/${a}`, { name: `${tag} A2` })).status).toBe(200);
  });
});

describe('archive payload', () => {
  test('league block keeps its old fields and gains ruleset (additive)', async () => {
    const res = await call('GET', `/api/archive/leagues/${a}/full`);
    expect(res.status).toBe(200);
    const lg = res.json.league;
    for (const k of ['id', 'name', 'color', 'seasonId', 'seasonNumber', 'archived', 'phase', 'rosterSize', 'minRosterSize', 'maxRosterSize', 'playoffTeamCount']) {
      expect(k in lg).toBe(true);
    }
    expect(lg.rulesetId).toBe(rsA);
    expect(lg.ruleset.pointCap).toBe(130);
    for (const k of ['teams', 'schedule', 'draft', 'transactions', 'leaderboards']) expect(k in res.json).toBe(true);
  });
});
