import { describe, expect, test } from 'bun:test';
import { DEFAULT_RULESET } from '@cannoli/rules';
import {
  captainHeadroomNeeded,
  describeConflict,
  findPickConflict,
  type ConflictInputRoster,
} from '@/lib/draft-rules';

describe('ruleset-driven rules', () => {
  const rs = (over: object = {}) => ({ ...DEFAULT_RULESET, ...over });
  const roster = (names: string[]): ConflictInputRoster => ({ pokemonNames: names, pointsUsed: 0 });

  test('mega cap 1 (default): second mega blocked', () => {
    const c = findPickConflict('Mega Gengar', 5, roster(['Mega Garchomp']), 110, rs());
    expect(c).toMatchObject({ kind: 'mega-cap', limit: 1 });
  });
  test('mega cap 2 allows a second, blocks a third', () => {
    expect(findPickConflict('Mega Gengar', 5, roster(['Mega Garchomp']), 110, rs({ megaCap: 2 }))).toBeNull();
    expect(findPickConflict('Mega Gengar', 5, roster(['Mega Garchomp', 'Mega Gyarados']), 110, rs({ megaCap: 2 }))).not.toBeNull();
  });
  test('mega cap 0 blocks every mega (primals count)', () => {
    const c = findPickConflict('Primal Kyogre', 5, roster([]), 110, rs({ megaCap: 0 }));
    expect(c).toMatchObject({ kind: 'mega-cap', limit: 0 });
    expect(describeConflict(c!)).toContain('not allowed');
  });
  test('mega cap null = unlimited', () => {
    expect(findPickConflict('Mega Gengar', 5, roster(['Mega A', 'Mega B', 'Mega C']), 110, rs({ megaCap: null }))).toBeNull();
  });

  const team = [{ name: 'Garchomp', tier: 9 }, { name: 'Rotom-Wash', tier: 5 }];
  test('captain headroom: default table matches legacy numbers', () => {
    expect(captainHeadroomNeeded(team, 2, 'natdexplus')).toBe(4);
    expect(captainHeadroomNeeded(team, 1, 'natdexplus')).toBe(3);
  });
  test('captain headroom follows a custom table; eligibility is the table keys', () => {
    expect(captainHeadroomNeeded(team, 2, 'natdexplus', rs({ teraMarkup: { 5: 10 } }))).toBe(5);
  });
  test('captain headroom is 0 with tera off', () => {
    expect(captainHeadroomNeeded(team, 2, 'natdexplus', rs({ teraEnabled: false }))).toBe(0);
  });
});
