import { describe, expect, test } from 'bun:test';
import { championId, lastPlayedWeek, myPlayoffMatch, panelFor } from './phase-panels';
import type { Match } from '@/lib/types';

const m = (o: Partial<Match> & { id: string }): Match => ({ week: 1, homePlayer: 'a', awayPlayer: 'b', ...o });

describe('panelFor', () => {
  test('maps phases', () => {
    expect(panelFor({ phase: 'predraft' })).toBe('draft');
    expect(panelFor({ phase: 'draft' })).toBe('draft');
    expect(panelFor({ phase: 'regular' })).toBe('regular');
    expect(panelFor({ phase: 'playoffs' })).toBe('playoffs');
    expect(panelFor({ phase: 'offseason' })).toBe('complete');
    expect(panelFor({ phase: 'regular', archived: true })).toBe('complete');
  });
});

describe('lastPlayedWeek', () => {
  const ms = [
    m({ id: '1', week: 1, homeScore: 6, awayScore: 2 }),
    m({ id: '2', week: 2, status: 'completed' }),
    m({ id: '3', week: 3 }),
    m({ id: '4', week: 4, phase: 'playoffs', homeScore: 1, awayScore: 0 }),
  ];
  test('inclusive of the start week, ignores playoffs and unplayed', () => {
    expect(lastPlayedWeek(ms, 3)).toBe(2);
    expect(lastPlayedWeek(ms, 9)).toBe(2);
    expect(lastPlayedWeek(ms, 1)).toBe(1);
    expect(lastPlayedWeek([], 5)).toBe(0);
  });
});

describe('championId / myPlayoffMatch', () => {
  test('finals winner', () => {
    const f = m({ id: 'f', phase: 'playoffs', playoffRound: 'f', homePlayer: 'x', awayPlayer: 'y', homeScore: 1, awayScore: 3 });
    expect(championId([f])).toBe('y');
    expect(championId([{ ...f, homeScore: undefined, awayScore: undefined }])).toBeNull();
    expect(championId([])).toBeNull();
  });
  test('unplayed playoff fixture for a team', () => {
    const p = m({ id: 'p', phase: 'playoffs', homePlayer: 'x', awayPlayer: 'y' });
    expect(myPlayoffMatch([p], 'y')?.id).toBe('p');
    expect(myPlayoffMatch([{ ...p, homeScore: 1, awayScore: 0 }], 'y')).toBeUndefined();
  });
});
