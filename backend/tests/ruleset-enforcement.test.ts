/**
 * Step A parity: enforcement through `getLeagueRuleset` must behave exactly like
 * the old hardcoded rules for archived/legacy leagues, and must follow the
 * ruleset when it differs.
 *   - pick-time legality: legacy league (derived ruleset) vs the same league
 *     pointed at an identical `rulesets` row
 *   - post-move (trade/FA) legality on the golden archived rosters, old inline
 *     rule vs the ruleset-driven validator
 *   - captain validation + draft state follow a non-default ruleset
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { DEFAULT_RULESET } from '@cannoli/rules';
import { db, schema } from '../src/db';
import { validatePick, getDraftSnapshot, getAutoPick } from '../src/lib/draft-engine';
import { validateRosterLegality } from '../src/lib/roster-legality';
import { invalidateRulesetCache } from '../src/lib/rulesets';
import { validateTeraCaptains } from '../src/lib/free-agency';
import { ensurePokemonReference } from './pokemon-reference-seed';
import { getLeagueCostMap, invalidateCostCache } from '../src/lib/league-costs';
import { effectiveCost } from '../src/lib/tera-cost';
import { buildDraftFixture, pickByTier, type DraftFixture } from './draft-fixture';
import golden from './fixtures/rulesets-golden.json';

const fixtures: DraftFixture[] = [];
const rulesetIds: number[] = [];
const fakeMons: string[] = [];
// Another suite may have emptied the reference table and left a stale (empty)
// cached cost map behind; start every test from a rebuilt one.
beforeEach(() => { ensurePokemonReference(); invalidateCostCache(); });
afterEach(() => {
  while (fakeMons.length) db.delete(schema.pokemon).where(eq(schema.pokemon.name, fakeMons.pop()!)).run();
  while (fixtures.length) fixtures.pop()!.cleanup();
  while (rulesetIds.length) db.delete(schema.rulesets).where(eq(schema.rulesets.id, rulesetIds.pop()!)).run();
});

function fx(opts?: Parameters<typeof buildDraftFixture>[0]) {
  const f = buildDraftFixture(opts);
  fixtures.push(f);
  return f;
}

/** Synthetic tier-5 mega (the shared reference may hold none that are unbanned). */
let megaSeq = 0;
function fakeMega(): string {
  const name = `TestMega${Date.now()}-${++megaSeq}`;
  db.insert(schema.pokemon).values({
    name, type1: 'Normal', hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1,
    tier: 5, banned: false, nationalDexNumber: 990000 + megaSeq * 10 + Math.floor(Math.random() * 9), formCategory: 'mega',
  }).run();
  fakeMons.push(name);
  return name;
}

function attachRuleset(f: DraftFixture, over: Partial<typeof schema.rulesets.$inferInsert> = {}) {
  const row = db.insert(schema.rulesets).values({
    name: `test-${f.leagueId}`,
    costFormat: 'natdexplus',
    pointCap: f.pointCap,
    rosterSize: f.rosterSize,
    megaCap: 1,
    teraEnabled: f.teraCaptainSlots > 0,
    teraCaptainSlots: f.teraCaptainSlots,
    teraTypesPerCaptain: 3,
    teraMarkup: JSON.stringify(DEFAULT_RULESET.teraMarkup),
    ...over,
  }).returning().get();
  rulesetIds.push(row.id);
  db.update(schema.leagues).set({ rulesetId: row.id }).where(eq(schema.leagues.id, f.leagueId)).run();
  return row;
}

function draftTo(f: DraftFixture, teamId: string, names: string[]) {
  const base = db.select().from(schema.draftPicks).where(eq(schema.draftPicks.leagueId, f.leagueId)).all().length;
  names.forEach((name, i) => {
    const tier = db.select().from(schema.pokemon).where(eq(schema.pokemon.name, name)).get()!.tier;
    db.insert(schema.draftPicks).values({ leagueId: f.leagueId, teamId, pickNumber: base + i + 1, pokemonName: name, tier }).run();
  });
}

describe('pick-time legality: legacy league vs identical ruleset row', () => {
  test('validatePick + getDraftSnapshot + getAutoPick are identical', () => {
    const legacy = fx({ teams: 4, teraCaptainSlots: 2 });
    const viaRs = fx({ teams: 4, teraCaptainSlots: 2 });
    attachRuleset(viaRs);

    const owned = [pickByTier(12), pickByTier(11), pickByTier(10)];
    draftTo(legacy, legacy.teamIds[0], owned);
    draftTo(viaRs, viaRs.teamIds[0], owned);

    const candidates = [1, 3, 5, 7, 9, 10, 11, 12, 13, 14, 15]
      .map(t => { try { return pickByTier(t, owned); } catch { return null; } })
      .filter((n): n is string => !!n);
    expect(candidates.length).toBeGreaterThan(3);
    for (const name of candidates) {
      expect(validatePick(name, viaRs.teamIds[0], viaRs.leagueId))
        .toEqual(validatePick(name, legacy.teamIds[0], legacy.leagueId));
    }
    // A second team with no picks, plus a mega and a duplicate-species probe.
    const [mega1, mega2] = [fakeMega(), fakeMega()];
    for (const team of [0, 1]) {
      draftTo(legacy, legacy.teamIds[team], team ? [] : [mega1]);
      draftTo(viaRs, viaRs.teamIds[team], team ? [] : [mega1]);
    }
    for (const name of [mega1, mega2]) {
      for (const team of [0, 1]) {
        const r = validatePick(name, viaRs.teamIds[team], viaRs.leagueId);
        expect(r).toEqual(validatePick(name, legacy.teamIds[team], legacy.leagueId));
        if (team === 0 && name === mega2) expect(r.code).toBe('mega_cap');
      }
    }

    const a = getDraftSnapshot(legacy.leagueId)!, b = getDraftSnapshot(viaRs.leagueId)!;
    expect([b.pointCap, b.rosterSize, b.teraCaptainSlots]).toEqual([a.pointCap, a.rosterSize, a.teraCaptainSlots]);
    expect(b.snakeOrder.length).toBe(a.snakeOrder.length);
    expect(getAutoPick(viaRs.teamIds[0], viaRs.leagueId)?.tier).toBe(getAutoPick(legacy.teamIds[0], legacy.leagueId)?.tier);
  });

  test('a non-default ruleset changes pick legality', () => {
    const f = fx({ teams: 4, teraCaptainSlots: 2 });
    const big = pickByTier(12);
    expect(validatePick(big, f.teamIds[0], f.leagueId).valid).toBe(true);
    attachRuleset(f, { pointCap: 10 });
    const r = validatePick(big, f.teamIds[0], f.leagueId);
    expect(r.valid).toBe(false);
    expect(r.code).toBe('over_budget');
  });

  test('mega cap comes from the ruleset', () => {
    const f = fx({ teams: 4, teraCaptainSlots: 0 });
    const [m1, m2] = [fakeMega(), fakeMega()];
    const rs = attachRuleset(f, { megaCap: 0 });
    expect(validatePick(m1, f.teamIds[0], f.leagueId).code).toBe('mega_cap');
    db.update(schema.rulesets).set({ megaCap: 2 }).where(eq(schema.rulesets.id, rs.id)).run();
    invalidateRulesetCache(rs.id);
    draftTo(f, f.teamIds[0], [m1]);
    expect(validatePick(m2, f.teamIds[0], f.leagueId).valid).toBe(true);
  });
});

describe('post-move legality on archived rosters: old rule vs ruleset-driven', () => {
  type Mon = [tier: number, costAtDraft: number, isCaptain: number, teraBanned: number];
  const teams = golden.teams as { league: string; team: string; mons: Mon[] }[];

  test('point-cap verdict identical at every boundary (S9 costAtDraft=0 falls back to tier)', () => {
    let checked = 0;
    for (const t of teams) {
      const entries = t.mons.map(([tier, c, cap], i) => ({ pokemonName: `m${i}`, cost: c || tier, isTeraCaptain: !!cap }));
      const total = entries.reduce((s, r) => s + effectiveCost(r.cost, !!r.isTeraCaptain), 0);
      for (const cap of [total - 1, total, total + 1, 110]) {
        const oldOver = total > cap;
        const v = validateRosterLegality(entries, new Map(), { ruleset: { ...DEFAULT_RULESET, pointCap: cap } });
        expect(v?.code === 'point_cap').toBe(oldOver);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});

/** A mon the LEAGUE's cost format prices at `tier` and allows as a captain (other suites may repopulate format_costs). */
function captainMon(leagueId: string, tier: number): string {
  for (const [name, c] of getLeagueCostMap(leagueId)) {
    if (c.tier === tier && !c.teraBanned && !c.banned) return name;
  }
  throw new Error(`no tier-${tier} captain candidate`);
}

describe('captain validation follows the ruleset', () => {
  function teamWith(f: DraftFixture, names: string[]) {
    const teamId = f.teamIds[0];
    for (const name of names) {
      const p = db.select().from(schema.pokemon).where(eq(schema.pokemon.name, name)).get()!;
      db.insert(schema.rosters).values({ teamId, pokemonName: name, tier: p.tier, costAtDraft: p.tier }).run();
    }
    return teamId;
  }

  test('default: tier 9 ok, 3 types ok, 4 types rejected', () => {
    const f = fx({ teams: 2, teraCaptainSlots: 2 });
    const name = captainMon(f.leagueId, 9);
    const team = teamWith(f, [name]);
    expect(validateTeraCaptains(team, [{ pokemonName: name, teraTypes: ['Fire', 'Water', 'Grass'] }]).ok).toBe(true);
    const bad = validateTeraCaptains(team, [{ pokemonName: name, teraTypes: ['Fire', 'Water', 'Grass', 'Ice'] }]);
    expect(bad).toMatchObject({ ok: false, error: 'Max 3 tera types per captain' });
  });

  test('custom: one type per captain, tier-9 removed from the markup table', () => {
    const f = fx({ teams: 2, teraCaptainSlots: 2 });
    const name = captainMon(f.leagueId, 9);
    const team = teamWith(f, [name]);
    const { 9: _drop, ...markup } = DEFAULT_RULESET.teraMarkup;
    attachRuleset(f, { teraTypesPerCaptain: 1, teraMarkup: JSON.stringify(markup) });
    const r = validateTeraCaptains(team, [{ pokemonName: name, teraTypes: ['Fire'] }]);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain('captains must be tier 8 or below');
    attachRuleset(f, { teraTypesPerCaptain: 1 });
    expect(validateTeraCaptains(team, [{ pokemonName: name, teraTypes: ['Fire', 'Ice'] }]))
      .toMatchObject({ ok: false, error: 'Max 1 tera types per captain' });
  });

  test('captain count follows the ruleset', () => {
    const f = fx({ teams: 2, teraCaptainSlots: 2 });
    const a = captainMon(f.leagueId, 9), b = captainMon(f.leagueId, 8);
    const team = teamWith(f, [a, b]);
    attachRuleset(f, { teraCaptainSlots: 1 });
    expect(validateTeraCaptains(team, [
      { pokemonName: a, teraTypes: [] }, { pokemonName: b, teraTypes: [] },
    ])).toMatchObject({ ok: false, error: 'Max 1 tera captains allowed' });
  });
});
