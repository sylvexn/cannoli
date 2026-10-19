/**
 * Pure-helper regression tests for the pin pickers: a forfeit at full health
 * (equal KO score, real `winner_team_id`) resolves a winner instead of
 * reading as a tie, in both computeStreak and pickChampion.
 */
import { describe, expect, test } from 'bun:test';
import { sqlite } from '../src/db';
import { computeStreak, type StreakMatch } from '../src/lib/pins/auto-award-pickers';
import { pickChampion, type ChampionFinalsRow } from '../src/lib/pins/archive-mint-pickers';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

// ---- pure-helper regression tests (no DB) ----------------------------

describe('computeStreak — winner flag over score comparison', () => {
  test('a 2-2 forfeit with a winner flag extends the streak, not resets it', () => {
    const matches: StreakMatch[] = [
      { homeTeamId: 'A', awayTeamId: 'B', homeScore: 2, awayScore: 2, winnerTeamId: 'A' },
    ];
    expect(computeStreak(matches, 'A')).toBe(1);
    expect(computeStreak(matches, 'B')).toBe(0);
  });

  test('a genuine tie (no winner flag, equal score) still resets the streak', () => {
    const matches: StreakMatch[] = [
      { homeTeamId: 'A', awayTeamId: 'B', homeScore: 2, awayScore: 2, winnerTeamId: null },
    ];
    expect(computeStreak(matches, 'A')).toBe(0);
  });
});

describe('pickChampion — winner flag over score-sum comparison', () => {
  test('a single final forfeited 2-2 with a winner flag still crowns a champion', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'A', awayTeamId: 'B', homeScore: 2, awayScore: 2, winnerTeamId: 'A' },
    ];
    const winner = pickChampion(rows);
    expect(winner).not.toBeNull();
    expect(winner!.winnerTeamId).toBe('A');
    expect(winner!.loserTeamId).toBe('B');
  });

  test('a genuinely tied series (no winner flag, equal score sum) still returns null', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'A', awayTeamId: 'B', homeScore: 2, awayScore: 2, winnerTeamId: null },
    ];
    expect(pickChampion(rows)).toBeNull();
  });
});
