/** Ruleset resolver + admin routes: freeze rules, clone, fork, assign, delete. */
import { afterAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq, inArray } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { rulesetAdminRoutes } from '../src/routes/admin/rulesets';
import { getLeagueRuleset, invalidateRulesetCache } from '../src/lib/rulesets';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

const tag = `rs-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const staff = db.insert(schema.users).values({ username: tag, passwordHash: 'x', role: 'admin' }).returning().get();
const app = new Elysia()
  .derive(() => ({ user: { id: String(staff.id), role: 'admin', username: 'rs-test' } }))
  .use(rulesetAdminRoutes);

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.handle(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) as any }; } catch { return { status: res.status, json: { raw: text } as any }; }
};

const seasonIds: number[] = [];
const leagueIds: string[] = [];

afterAll(() => {
  if (leagueIds.length) db.delete(schema.leagues).where(inArray(schema.leagues.id, leagueIds)).run();
  // rulesets reference each other (lineage): drop children first
  sqlite.exec(`DELETE FROM rulesets WHERE name LIKE '${tag}%' AND source_ruleset_id IS NOT NULL`);
  sqlite.exec(`DELETE FROM rulesets WHERE name LIKE '${tag}%'`);
  if (seasonIds.length) db.delete(schema.seasons).where(inArray(schema.seasons.id, seasonIds)).run();
  db.delete(schema.users).where(eq(schema.users.id, staff.id)).run();
  invalidateRulesetCache();
});

function mkLeague(id: string, phase: 'predraft' | 'draft' | 'offseason', rulesetId: number | null) {
  const s = db.insert(schema.seasons).values({ seasonNumber: 9000 + seasonIds.length, pointCap: 100, teraCaptainSlots: 1 }).returning().get();
  seasonIds.push(s.id);
  const lid = `${tag}-${id}`;
  leagueIds.push(lid);
  db.insert(schema.leagues).values({ id: lid, name: lid, color: '#fff', seasonId: s.id, phase, rulesetId, costFormat: 'natdex' }).run();
  return lid;
}

describe('rulesets routes', () => {
  test('derived ruleset for an un-backfilled league mirrors legacy columns', () => {
    const lid = mkLeague('legacy', 'offseason', null);
    const rs = getLeagueRuleset(lid);
    expect([rs.pointCap, rs.teraCaptainSlots, rs.costFormat, rs.megaCap, rs.rosterSize]).toEqual([100, 1, 'natdex', 1, 10]);
  });

  test('create template, clone to instance, freeze, fork, delete rules', async () => {
    const t = await call('POST', '/api/admin/rulesets', { name: `${tag}-tpl`, pointCap: 120 });
    expect(t.status).toBe(200);
    expect(t.json.isTemplate).toBe(true);
    expect(t.json.teraMarkup[9]).toBe(12);

    const bad = await call('POST', '/api/admin/rulesets', { name: `${tag}-bad`, rosterMin: 12 });
    expect(bad.status).toBe(400);

    const inst = await call('POST', `/api/admin/rulesets/${t.json.id}/clone`, { name: `${tag}-inst`, asInstance: true });
    expect(inst.json.isTemplate).toBe(false);
    expect(inst.json.sourceRulesetId).toBe(t.json.id);

    const lid = mkLeague('live', 'predraft', inst.json.id);
    expect(getLeagueRuleset(lid).pointCap).toBe(120);

    // predraft: freely editable
    const ok = await call('PUT', `/api/admin/rulesets/${inst.json.id}`, { pointCap: 130 });
    expect(ok.json.pointCap).toBe(130);
    expect(getLeagueRuleset(lid).pointCap).toBe(130); // cache invalidated

    // leave predraft -> frozen
    db.update(schema.leagues).set({ phase: 'draft' }).where(eq(schema.leagues.id, lid)).run();
    const frozen = await call('PUT', `/api/admin/rulesets/${inst.json.id}`, { pointCap: 140 });
    expect(frozen.status).toBe(409);
    expect(frozen.json.code).toBe('RULESET_FROZEN');
    expect(frozen.json.usedBy).toEqual([lid]);
    const name = await call('PUT', `/api/admin/rulesets/${inst.json.id}`, { name: `${tag}-renamed`, rosterMin: 9, rosterMax: 12 });
    expect(name.status).toBe(200);

    // fork with edits repoints only that league
    const fork = await call('POST', `/api/admin/rulesets/${inst.json.id}/fork`, { leagueId: lid, changes: { pointCap: 140 } });
    expect(fork.status).toBe(200);
    expect(getLeagueRuleset(lid).pointCap).toBe(140);
    expect(getRow(inst.json.id)?.pointCap).toBe(130);

    // in-use rulesets cannot be deleted; unused template can
    expect((await call('DELETE', `/api/admin/rulesets/${fork.json.id}`)).status).toBe(409);
    const tpl2 = await call('POST', '/api/admin/rulesets', { name: `${tag}-tpl2` });
    expect((await call('DELETE', `/api/admin/rulesets/${tpl2.json.id}`)).status).toBe(200);
  });

  test('assign: template is copied into an instance, predraft only', async () => {
    const t = await call('POST', '/api/admin/rulesets', { name: `${tag}-tpl3`, teraCaptainSlots: 1 });
    const pre = mkLeague('assign', 'predraft', null);
    const a = await call('POST', `/api/admin/rulesets/${t.json.id}/assign`, { leagueId: pre });
    expect(a.status).toBe(200);
    expect(a.json.isTemplate).toBe(false);
    expect(getLeagueRuleset(pre).teraCaptainSlots).toBe(1);
    const off = mkLeague('assign-off', 'offseason', null);
    expect((await call('POST', `/api/admin/rulesets/${t.json.id}/assign`, { leagueId: off })).status).toBe(409);
  });

  test('assign + edit keep the league cost format and roster columns in step', async () => {
    const t = await call('POST', '/api/admin/rulesets', { name: `${tag}-tpl4`, costFormat: 'natdexplus', rosterSize: 11 });
    const lid = mkLeague('mirror', 'predraft', null); // league column starts as natdex
    const a = await call('POST', `/api/admin/rulesets/${t.json.id}/assign`, { leagueId: lid });
    let row = db.select().from(schema.leagues).where(eq(schema.leagues.id, lid)).get()!;
    expect([row.costFormat, row.rosterSize]).toEqual(['natdexplus', 11]);
    expect((await call('PUT', `/api/admin/rulesets/${a.json.id}`, { costFormat: 'natdex', rosterMin: 10, rosterMax: 12 })).status).toBe(200);
    row = db.select().from(schema.leagues).where(eq(schema.leagues.id, lid)).get()!;
    expect([row.costFormat, row.minRosterSize, row.maxRosterSize]).toEqual(['natdex', 10, 12]);
  });

  test('frozen instance: full-form save that only renames is allowed', async () => {
    const t = await call('POST', '/api/admin/rulesets', { name: `${tag}-tpl5` });
    const lid = mkLeague('frozen-save', 'predraft', null);
    const inst = (await call('POST', `/api/admin/rulesets/${t.json.id}/assign`, { leagueId: lid })).json;
    db.update(schema.leagues).set({ phase: 'draft' }).where(eq(schema.leagues.id, lid)).run();
    const full = { ...inst, name: `${tag}-renamed`, teraMarkup: { ...inst.teraMarkup } };
    expect((await call('PUT', `/api/admin/rulesets/${inst.id}`, full)).status).toBe(200);
    expect((await call('PUT', `/api/admin/rulesets/${inst.id}`, { ...full, pointCap: inst.pointCap + 5 })).status).toBe(409);
  });
});

function getRow(id: number) {
  return db.select().from(schema.rulesets).where(eq(schema.rulesets.id, id)).get();
}
