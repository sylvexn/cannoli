import { describe, expect, test } from 'bun:test';
import {
  pickGarchompWinners,
  pickCannoliWinners,
  pickCynthiaWinners,
  computeStreak,
  type GarchompRow,
  type CannoliRecord,
  type CynthiaStreak,
  type StreakMatch,
} from '../src/lib/pins/auto-award';

// Garchomp

describe('pickGarchompWinners', () => {
  test('top kill total → single winner', () => {
    const rows: GarchompRow[] = [
      { teamId: 'a', pokemon: 'dragapult', kills: 16 },
      { teamId: 'b', pokemon: 'garchomp', kills: 12 },
      { teamId: 'c', pokemon: 'gholdengo', kills: 9 },
    ];
    const out = pickGarchompWinners(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('a');
    expect(out[0].kills).toBe(16);
  });

  test('tie at top → multiple winners', () => {
    const rows: GarchompRow[] = [
      { teamId: 'a', pokemon: 'dragapult', kills: 14 },
      { teamId: 'b', pokemon: 'garchomp', kills: 14 },
      { teamId: 'c', pokemon: 'koraidon', kills: 10 },
    ];
    const out = pickGarchompWinners(rows);
    expect(out).toHaveLength(2);
    expect(new Set(out.map(w => w.teamId))).toEqual(new Set(['a', 'b']));
  });

  test('case-insensitive grouping ("Garchomp" + "garchomp" coalesce)', () => {
    const rows: GarchompRow[] = [
      { teamId: 'a', pokemon: 'Garchomp', kills: 8 },
      { teamId: 'a', pokemon: 'garchomp', kills: 7 },
      { teamId: 'b', pokemon: 'Dragapult', kills: 10 },
    ];
    const out = pickGarchompWinners(rows);
    // a's coalesced kills = 15 > b's 10
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('a');
    expect(out[0].kills).toBe(15);
    expect(out[0].pokemon).toBe('garchomp');
  });

  test('zero kills total → no winners', () => {
    const rows: GarchompRow[] = [
      { teamId: 'a', pokemon: 'dragapult', kills: 0 },
      { teamId: 'b', pokemon: 'garchomp', kills: 0 },
    ];
    expect(pickGarchompWinners(rows)).toEqual([]);
  });

  test('empty input → no winners', () => {
    expect(pickGarchompWinners([])).toEqual([]);
  });
});

// Cannoli

function rec(teamId: string, userId: number | null, wins: number, losses: number, diff: number, played = wins + losses): CannoliRecord {
  return { teamId, userId, wins, losses, diff, played };
}

describe('pickCannoliWinners', () => {
  test('highest wins wins outright', () => {
    const out = pickCannoliWinners([
      rec('a', 1, 8, 2, 20),
      rec('b', 2, 6, 4, 5),
      rec('c', 3, 3, 7, -10),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('a');
  });

  test('tie on wins → tiebreak by diff', () => {
    const out = pickCannoliWinners([
      rec('a', 1, 7, 3, 5),   // tied wins, lower diff
      rec('b', 2, 7, 3, 22),  // tied wins, higher diff
      rec('c', 3, 4, 6, 0),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('b');
  });

  test('tie on wins AND diff → split (multiple winners)', () => {
    const out = pickCannoliWinners([
      rec('a', 1, 7, 3, 12),
      rec('b', 2, 7, 3, 12),
      rec('c', 3, 4, 6, 0),
    ]);
    expect(out).toHaveLength(2);
    expect(new Set(out.map(w => w.teamId))).toEqual(new Set(['a', 'b']));
  });

  test('teams with no games played are excluded', () => {
    const out = pickCannoliWinners([
      rec('a', 1, 0, 0, 0, 0),
      rec('b', 2, 5, 5, 3),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('b');
  });
});

// Cynthia (streak helpers)

function m(home: string, away: string, hs: number | null, as: number | null, forfeitedBy?: 'home' | 'away' | 'both' | null): StreakMatch {
  return { homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as, forfeitedBy: forfeitedBy ?? null };
}

describe('computeStreak', () => {
  test('streak resets on a loss', () => {
    // a wins, wins, LOSES, wins → best = 2
    const matches = [
      m('a', 'x', 4, 1),
      m('a', 'y', 5, 2),
      m('a', 'z', 1, 4), // loss
      m('a', 'w', 6, 0),
    ];
    expect(computeStreak(matches, 'a')).toBe(2);
  });

  test('streak resets on a tie', () => {
    const matches = [
      m('a', 'x', 4, 1),
      m('a', 'y', 3, 3), // tie -> reset
      m('a', 'z', 6, 0),
    ];
    // Best of: [1] then reset, then [1] again → 1
    expect(computeStreak(matches, 'a')).toBe(1);
  });

  test("forfeitedBy='both' is SKIPPED — neither extends nor breaks", () => {
    // 2 wins, double-forfeit (skipped), 1 more win → streak should be 3
    const matches = [
      m('a', 'x', 5, 0),
      m('a', 'y', 5, 0),
      m('a', 'z', 0, 0, 'both'), // skipped
      m('a', 'w', 5, 0),
    ];
    expect(computeStreak(matches, 'a')).toBe(3);
  });

  test('NULL scores reset the streak', () => {
    const matches = [
      m('a', 'x', 5, 0),
      m('a', 'y', null, null), // not played → reset
      m('a', 'z', 5, 0),
    ];
    expect(computeStreak(matches, 'a')).toBe(1);
  });

  test('matches consumed in given order (caller orders by week)', () => {
    // If reordered, the result would differ — the helper trusts caller order.
    const matches = [
      m('x', 'a', 0, 5),
      m('y', 'a', 0, 5),
      m('a', 'z', 5, 0),
    ];
    expect(computeStreak(matches, 'a')).toBe(3);
  });
});

describe('pickCynthiaWinners', () => {
  test('threshold min=2 → top streak of 1 yields no winners', () => {
    const streaks: CynthiaStreak[] = [
      { teamId: 'a', userId: 1, best: 1 },
      { teamId: 'b', userId: 2, best: 1 },
    ];
    expect(pickCynthiaWinners(streaks, 2)).toEqual([]);
  });

  test('threshold min=2 → top streak of 2 returns winners', () => {
    const streaks: CynthiaStreak[] = [
      { teamId: 'a', userId: 1, best: 2 },
      { teamId: 'b', userId: 2, best: 1 },
    ];
    const out = pickCynthiaWinners(streaks, 2);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('a');
  });

  test('multiple-team tie at top → all returned', () => {
    const streaks: CynthiaStreak[] = [
      { teamId: 'a', userId: 1, best: 4 },
      { teamId: 'b', userId: 2, best: 4 },
      { teamId: 'c', userId: 3, best: 3 },
    ];
    const out = pickCynthiaWinners(streaks, 2);
    expect(out).toHaveLength(2);
    expect(new Set(out.map(w => w.teamId))).toEqual(new Set(['a', 'b']));
  });

  test('empty input → no winners', () => {
    expect(pickCynthiaWinners([], 2)).toEqual([]);
  });
});
