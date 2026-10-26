import { describe, expect, test } from 'bun:test';
import { DEFAULT_RULESET } from './ruleset';
import { holesOf, isHole, mergedSpeedLadder, sharedUnique, typeTotals } from './compare';
import type { DcMon } from './types';

const mon = (name: string): DcMon => ({ name, captain: false, teraTypes: [] });

describe('compare helpers', () => {
  test('isHole needs 3+ weak and <=1 resist', () => {
    expect(isHole({ weak: 3, resist: 1 })).toBe(true);
    expect(isHole({ weak: 3, resist: 2 })).toBe(false);
    expect(isHole({ weak: 2, resist: 0 })).toBe(false);
  });

  test('holes detected from a real roster', () => {
    const t = typeTotals([mon('Charizard'), mon('Moltres'), mon('Talonflame')], DEFAULT_RULESET);
    expect(t.find(x => x.type === 'rock')!.weak).toBe(3);
    expect(holesOf(t)).toContain('rock');
  });

  test('merged ladder is ordered fastest first with ties A before B', () => {
    const l = mergedSpeedLadder([mon('Garchomp'), mon('Snorlax')], [mon('Garchomp'), mon('Dragapult')], DEFAULT_RULESET);
    expect(l.map(e => e.base)).toEqual([...l.map(e => e.base)].sort((x, y) => y - x));
    expect(l.filter(e => e.name === 'Garchomp').map(e => e.side)).toEqual(['a', 'b']);
    expect(l[l.length - 1].name).toBe('Snorlax');
  });

  test('shared / unique split', () => {
    expect(sharedUnique([mon('A'), mon('B')], [mon('B'), mon('C')])).toEqual({ shared: ['B'], onlyA: ['A'], onlyB: ['C'] });
  });
});
