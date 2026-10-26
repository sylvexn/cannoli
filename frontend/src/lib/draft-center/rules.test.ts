import { describe, expect, test } from 'bun:test';
import { DEFAULT_RULESET, EMPTY_CATALOG, resolveTeamRuleset, rosterSizeOf, toDcRuleset, type Ruleset } from './ruleset';
import { captainEligibility, monCost, validateTeam } from './rules';
import { calcStat, setSpeed, speedNature } from './sets';
import type { DcMon } from './types';

const RS: Ruleset = { ...DEFAULT_RULESET, pointCap: 40, rosterSize: 3, teraCaptainSlots: 1 };
const mon = (name: string, over: Partial<DcMon> = {}): DcMon => ({ name, captain: false, teraTypes: [], ...over });
const codes = (r: DcMon[], rs = RS) => validateTeam(r, rs).violations.map(v => v.code);

describe('draft-center rules (frontend mirror)', () => {
  test('budget uses captain markup', () => {
    // Araquanid is tier 9 in the bundled list: 9 -> 12 as a captain
    expect(validateTeam([mon('Araquanid')], RS).used).toBe(9);
    expect(validateTeam([mon('Araquanid', { captain: true })], RS).used).toBe(12);
  });

  test('over budget, roster size, mega cap, duplicate species all warn', () => {
    expect(codes([mon('Mega Blastoise'), mon('Mega Charizard X'), mon('Mega Gyarados')])).toContain('over_budget');
    expect(codes([mon('Mega Blastoise'), mon('Mega Gyarados')])).toContain('multi_mega');
    expect(codes([mon('Charizard'), mon('Mega Charizard X')])).toContain('duplicate_species');
    expect(codes([mon('Muk'), mon('Gengar'), mon('Breloom'), mon('Garchomp')])).toContain('roster_over');
  });

  test('banned + tera-banned + tier cap on captains', () => {
    expect(codes([mon('Arceus')])).toContain('banned');
    expect(captainEligibility('Garchomp', RS).ok).toBe(false); // tier 18
    expect(captainEligibility('Muk', RS).ok).toBe(true);
    expect(codes([mon('Garchomp', { captain: true })])).toContain('captain_tier');
    expect(codes([mon('Alcremie', { captain: true })])).toContain('captain_tera_banned');
    expect(codes([mon('Muk', { captain: true }), mon('Breloom', { captain: true })])).toContain('captain_count');
  });
});

const custom = (over: Partial<Ruleset>): Ruleset => ({ ...DEFAULT_RULESET, ...over });

describe('draft-center custom rulesets', () => {
  test('markup off: captains cost base price, no captain_tier/count warnings', () => {
    const rs = custom({ teraEnabled: false, teraCaptainSlots: 0 });
    expect(monCost(mon('Araquanid', { captain: true }), rs)).toBe(9);
    expect(captainEligibility('Muk', rs).ok).toBe(false);
    expect(codes([mon('Araquanid', { captain: true })], rs)).toEqual(['tera_disabled']);
  });

  test('custom markup table drives cost and eligibility', () => {
    const rs = custom({ teraMarkup: { 9: 20 } });
    expect(monCost(mon('Araquanid', { captain: true }), rs)).toBe(20);
    expect(captainEligibility('Muk', rs).ok).toBe(false); // Muk's tier is not in the table
    expect(codes([mon('Muk', { captain: true })], rs)).toContain('captain_tier');
  });

  test('mega cap 0 forbids megas; cap 2 allows two', () => {
    expect(codes([mon('Mega Blastoise')], custom({ megaCap: 0 }))).toContain('multi_mega');
    expect(codes([mon('Mega Blastoise'), mon('Mega Gyarados')], custom({ megaCap: 2, pointCap: 999 }))).not.toContain('multi_mega');
  });

  test('roster size is roster_max ?? roster_size', () => {
    expect(rosterSizeOf(DEFAULT_RULESET)).toBe(10);
    expect(rosterSizeOf(custom({ rosterMin: 10, rosterMax: 12 }))).toBe(12);
    const rs = custom({ rosterSize: 10, rosterMax: 12, pointCap: 999 });
    expect(validateTeam([], rs).rosterSize).toBe(12);
    expect(codes(Array.from({ length: 12 }, (_, i) => mon(['Muk', 'Gengar', 'Breloom', 'Garchomp', 'Alcremie', 'Araquanid', 'Pikachu', 'Snorlax', 'Gyarados', 'Machamp', 'Golem', 'Slowbro'][i])), rs)).not.toContain('roster_over');
  });
});

describe('resolveTeamRuleset', () => {
  const api = { ...DEFAULT_RULESET, id: 7, name: 'S12 Emerald', description: null, isTemplate: false, sourceRulesetId: null, archived: false, createdAt: null, updatedAt: null, createdBy: null, frozen: false, usedBy: [], draftCenterTeams: 0,
    costFormat: 'natdex', pointCap: 100 };
  const cat = { ...EMPTY_CATALOG, rulesets: [api] };

  test('rulesetId wins', () => {
    const r = resolveTeamRuleset({ rulesetId: 7, leagueId: 'x' }, cat);
    expect([r.id, r.pointCap, r.costFormat, r.label]).toEqual([7, 100, 'natdex', 'S12 Emerald']);
  });
  test('legacy league resolves via for-league (listed instance preferred)', () => {
    const fl = { rulesetId: 7, ruleset: toDcRuleset({ ...DEFAULT_RULESET, pointCap: 1 }) };
    expect(resolveTeamRuleset({ leagueId: 'L' }, { ...cat, leagueRulesets: { L: fl } }).pointCap).toBe(100);
    const unlisted = resolveTeamRuleset({ leagueId: 'L' }, { ...EMPTY_CATALOG, leagueRulesets: { L: { rulesetId: 9, ruleset: { ...DEFAULT_RULESET, pointCap: 90 } } } });
    expect([unlisted.id, unlisted.pointCap]).toEqual([9, 90]);
  });
  test('unknown / missing falls back to the default', () => {
    expect(resolveTeamRuleset({ rulesetId: 99 }, cat)).toBe(DEFAULT_RULESET);
    expect(resolveTeamRuleset({ leagueId: 'nope' }, { ...cat, leagueRulesets: { nope: null } })).toBe(DEFAULT_RULESET);
    expect(resolveTeamRuleset({})).toBe(DEFAULT_RULESET);
  });
});

describe('draft-center sets', () => {
  test('stat + speed math', () => {
    // Garchomp base 102 Spe: 252 EV / 31 IV / Jolly at L100 = 333
    expect(calcStat('spe', 102, 252, 31, 'Jolly')).toBe(333);
    expect(speedNature('Jolly')).toBe('positive');
    expect(speedNature('Brave')).toBe('negative');
    const set = { moves: [], item: 'Choice Scarf', ability: '', nature: 'Jolly', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } };
    expect(setSpeed(mon('Garchomp', { set }))).toBe(Math.floor(333 * 1.5));
    expect(setSpeed(mon('Garchomp'))).toBeNull();
  });
});
