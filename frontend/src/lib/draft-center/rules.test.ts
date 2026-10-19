import { describe, expect, test } from 'bun:test';
import { DEFAULT_RULESET, type Ruleset } from './ruleset';
import { captainEligibility, validateTeam } from './rules';
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
    expect(captainEligibility('Garchomp', 'natdexplus').ok).toBe(false); // tier 18
    expect(captainEligibility('Muk', 'natdexplus').ok).toBe(true);
    expect(codes([mon('Garchomp', { captain: true })])).toContain('captain_tier');
    expect(codes([mon('Alcremie', { captain: true })])).toContain('captain_tera_banned');
    expect(codes([mon('Muk', { captain: true }), mon('Breloom', { captain: true })])).toContain('captain_count');
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
