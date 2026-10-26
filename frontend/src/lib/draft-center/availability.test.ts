import { describe, expect, test } from 'bun:test';
import type { ApiTeam } from '@/lib/api';
import { buildOwnerMap, defaultLeagueId, isAvailable } from './availability';

const team = (id: string, userId: number | null, names: string[]) =>
  ({ id, teamName: `Team ${id}`, teamAbbrev: id.toUpperCase(), teamColor: '#fff', userId, roster: names.map(name => ({ name })) }) as unknown as ApiTeam;

describe('draft-center availability', () => {
  const teams = [team('a', 1, ['Garchomp']), team('b', 2, ['Gholdengo'])];
  const m = buildOwnerMap(teams, '1');
  test('maps owners and flags mine', () => {
    expect(m.get('Garchomp')?.mine).toBe(true);
    expect(m.get('Gholdengo')).toMatchObject({ mine: false, teamAbbrev: 'B' });
    expect(m.has('Pikachu')).toBe(false);
  });
  test('available = free or yours', () => {
    expect(isAvailable(m, 'Pikachu')).toBe(true);
    expect(isAvailable(m, 'Garchomp')).toBe(true);
    expect(isAvailable(m, 'Gholdengo')).toBe(false);
  });
  test('default league is the one the user coaches in', () => {
    expect(defaultLeagueId({ l1: [teams[1]], l2: [teams[0]] }, '1')).toBe('l2');
    expect(defaultLeagueId({ l1: teams }, null)).toBeNull();
    expect(defaultLeagueId({ l1: teams }, '9')).toBeNull();
  });
});
