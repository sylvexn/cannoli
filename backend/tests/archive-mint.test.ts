import { describe, expect, test } from 'bun:test';
import {
  pickChampion,
  pickHighScore,
  pickStealOfTheDraft,
  pickSweeper,
  STEAL_MIN_KILLS,
  type ChampionFinalsRow,
  type HighScoreRow,
  type StealRow,
  type SweeperMatchRow,
} from '../src/lib/pins/archive-mint';

// Champion

describe('pickChampion', () => {
  test('single decisive final → home wins', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 5, awayScore: 1, winnerTeamId: null },
    ];
    const out = pickChampion(rows);
    expect(out).not.toBeNull();
    expect(out!.winnerTeamId).toBe('a');
    expect(out!.loserTeamId).toBe('b');
    expect(out!.winnerSum).toBe(5);
    expect(out!.loserSum).toBe(1);
  });

  test('single decisive final → away wins', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 4, winnerTeamId: null },
    ];
    const out = pickChampion(rows);
    expect(out!.winnerTeamId).toBe('b');
    expect(out!.loserTeamId).toBe('a');
    expect(out!.winnerSum).toBe(4);
    expect(out!.loserSum).toBe(1);
  });

  test('best-of-3 series — game wins decide it', () => {
    // Game 1: a wins 4-2. Game 2: b wins 3-1. Game 3: a wins 5-2.
    // a wins 2 games to 1.
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 4, awayScore: 2, winnerTeamId: null },
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 3, winnerTeamId: null },
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 5, awayScore: 2, winnerTeamId: null },
    ];
    const out = pickChampion(rows);
    expect(out!.winnerTeamId).toBe('a');
    expect(out!.loserTeamId).toBe('b');
    expect(out!.winnerSum).toBe(10);
    expect(out!.loserSum).toBe(7);
  });

  test('a full-health forfeit (equal score, winner flag) still crowns a champion', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 2, awayScore: 2, winnerTeamId: 'a' },
    ];
    const out = pickChampion(rows);
    expect(out).not.toBeNull();
    expect(out!.winnerTeamId).toBe('a');
  });

  test('tied series, no winner flag → null (unresolved)', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 3, awayScore: 3, winnerTeamId: null },
    ];
    expect(pickChampion(rows)).toBeNull();
  });

  test('multi-game tied series → null', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 4, awayScore: 2, winnerTeamId: null },
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 3, winnerTeamId: null },
    ];
    // a=5, b=5, 1 game win each
    expect(pickChampion(rows)).toBeNull();
  });

  test('any unfinished match → null', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 4, awayScore: 2, winnerTeamId: null },
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: null, awayScore: null, winnerTeamId: null },
    ];
    expect(pickChampion(rows)).toBeNull();
  });

  test('empty input → null', () => {
    expect(pickChampion([])).toBeNull();
  });
});

// High Score

function hs(
  teamId: string, pokemon: string, kills: number, matchId = 'm1', week: number | null = 1,
  phase = 'regular', deaths = 0, teamRank: number | null = null,
): HighScoreRow {
  return { teamId, pokemonName: pokemon, matchId, kills, deaths, week, phase, teamRank };
}

describe('pickHighScore', () => {
  test('one clear winner', () => {
    const rows: HighScoreRow[] = [
      hs('a', 'dragapult', 5, 'm1'),
      hs('b', 'garchomp', 3, 'm2'),
      hs('c', 'gholdengo', 4, 'm3'),
    ];
    const out = pickHighScore(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('a');
    expect(out[0].pokemonName).toBe('dragapult');
    expect(out[0].kills).toBe(5);
  });

  test('tie at the top kills, equal deaths/week → earliest (lowest) match id wins', () => {
    const rows: HighScoreRow[] = [
      hs('b', 'garchomp', 6, 'm2'),
      hs('a', 'dragapult', 6, 'm1'),
      hs('c', 'gholdengo', 4, 'm3'),
    ];
    const out = pickHighScore(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('a');
    expect(out[0].matchId).toBe('m1');
  });

  test('tie on kills → fewer deaths in that match wins', () => {
    const rows: HighScoreRow[] = [
      hs('a', 'dragapult', 6, 'm1', 1, 'regular', 1),
      hs('b', 'garchomp', 6, 'm2', 1, 'regular', 0),
    ];
    const out = pickHighScore(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('b');
  });

  test('preserves match metadata (matchId, week, phase)', () => {
    const rows: HighScoreRow[] = [
      hs('a', 'koraidon', 7, 'm-final', 14, 'playoffs'),
      hs('b', 'garchomp', 3, 'm-week1', 1, 'regular'),
    ];
    const out = pickHighScore(rows);
    expect(out).toHaveLength(1);
    expect(out[0].matchId).toBe('m-final');
    expect(out[0].week).toBe(14);
    expect(out[0].phase).toBe('playoffs');
  });

  test('zero kills only → no winners', () => {
    const rows: HighScoreRow[] = [hs('a', 'dragapult', 0), hs('b', 'garchomp', 0)];
    expect(pickHighScore(rows)).toEqual([]);
  });

  test('empty input → no winners', () => {
    expect(pickHighScore([])).toEqual([]);
  });

  test('same Pokemon for one team in different matches, tied → earliest match wins', () => {
    const rows: HighScoreRow[] = [
      hs('a', 'dragapult', 5, 'm1', 1),
      hs('a', 'dragapult', 5, 'm5', 5),
      hs('b', 'garchomp', 3, 'm2'),
    ];
    const out = pickHighScore(rows);
    expect(out).toHaveLength(1);
    expect(out[0].matchId).toBe('m1');
  });
});

// Steal of the Draft

function sr(
  teamId: string, pokemon: string, kills: number, gp: number, cost: number | null,
  teamRank: number | null = null,
): StealRow {
  return { teamId, pokemonName: pokemon, kills, gp, cost, teamRank };
}

describe('pickStealOfTheDraft', () => {
  test('best K-per-point ratio wins, ties broken by higher raw kills', () => {
    // a: 12k / 3cost = 4.0
    // b: 10k / 5cost = 2.0
    // c: 8k / 2cost = 4.0 — ties a on ratio, fewer kills
    const rows: StealRow[] = [
      sr('a', 'dragapult', 12, 8, 3),
      sr('b', 'koraidon', 10, 8, 5),
      sr('c', 'rotom-wash', 8, 8, 2),
    ];
    const out = pickStealOfTheDraft(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('a');
    expect(out[0].ratio).toBe(4);
  });

  test('one clear winner', () => {
    const rows: StealRow[] = [
      sr('a', 'dragapult', 12, 8, 3), // 4.0
      sr('b', 'koraidon', 10, 8, 5),  // 2.0
    ];
    const out = pickStealOfTheDraft(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('a');
    expect(out[0].cost).toBe(3);
    expect(out[0].kills).toBe(12);
    expect(out[0].ratio).toBe(4);
  });

  test('below the minimum-kills floor is excluded even at a great ratio', () => {
    // Regression: S10 Sapphire's Frogadier (2 kills, cost 1, ratio 2.0) beat
    // a 19-kill workhorse under the old no-floor ranking. The floor now
    // excludes it outright regardless of ratio.
    expect(STEAL_MIN_KILLS).toBeGreaterThan(2);
    const rows: StealRow[] = [
      sr('frog', 'frogadier', 2, 5, 1),   // ratio 2.0, but only 2 kills
      sr('mon', 'bigmon', 19, 10, 10),    // ratio 1.9, real workhorse
    ];
    const out = pickStealOfTheDraft(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('mon');
  });

  test('rows with zero cost are filtered out (no div-by-0)', () => {
    const rows: StealRow[] = [
      sr('a', 'free-pick', 30, 8, 0),  // would dominate but filtered
      sr('b', 'koraidon', 10, 8, 5),   // 2.0
    ];
    const out = pickStealOfTheDraft(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('b');
  });

  test('rows with null cost are filtered out', () => {
    const rows: StealRow[] = [
      sr('a', 'unknown', 30, 8, null),
      sr('b', 'koraidon', 10, 8, 5),
    ];
    const out = pickStealOfTheDraft(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('b');
  });

  test('rows below the kill floor are filtered out', () => {
    const rows: StealRow[] = [
      sr('a', 'no-kills', 0, 8, 1),
      sr('b', 'koraidon', 10, 8, 5),
    ];
    const out = pickStealOfTheDraft(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('b');
  });

  test('rows with zero games played are filtered out', () => {
    const rows: StealRow[] = [
      sr('a', 'never-played', 5, 0, 3),
      sr('b', 'koraidon', 10, 8, 5),
    ];
    const out = pickStealOfTheDraft(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('b');
  });

  test('empty input → no winners', () => {
    expect(pickStealOfTheDraft([])).toEqual([]);
  });

  test('all rows below threshold → no winners', () => {
    const rows: StealRow[] = [
      sr('a', 'no-cost', 5, 8, 0),
      sr('b', 'no-kills', 0, 8, 5),
    ];
    expect(pickStealOfTheDraft(rows)).toEqual([]);
  });

  test('ratio is rounded to 3 decimals', () => {
    // 10 / 3 = 3.333...
    const rows: StealRow[] = [sr('a', 'p', 10, 5, 3)];
    const out = pickStealOfTheDraft(rows);
    expect(out[0].ratio).toBe(3.333);
  });
});

// Sweeper

function swm(matchId: string, winnerTeamId: string, winnerDeaths: number, winnerGp = 6, teamRank: number | null = null): SweeperMatchRow {
  return { matchId, winnerTeamId, winnerGp, winnerDeaths, teamRank };
}

describe('pickSweeper', () => {
  test('most clean sweeps wins', () => {
    // a: 3 sweeps, b: 1, c: 0 sweeps but a non-sweep win
    const rows: SweeperMatchRow[] = [
      swm('m1', 'a', 0),
      swm('m2', 'a', 0),
      swm('m3', 'a', 0),
      swm('m4', 'b', 0),
      swm('m5', 'c', 2),
    ];
    const out = pickSweeper(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('a');
    expect(out[0].sweeps).toBe(3);
  });

  test('matches with deaths > 0 do not count as sweeps', () => {
    const rows: SweeperMatchRow[] = [
      swm('m1', 'a', 0),
      swm('m2', 'a', 1), // not a sweep
      swm('m3', 'a', 3), // not a sweep
    ];
    const out = pickSweeper(rows);
    expect(out).toHaveLength(1);
    expect(out[0].sweeps).toBe(1);
  });

  test('tie at top, no rank data → exactly one winner (lowest team id)', () => {
    const rows: SweeperMatchRow[] = [
      swm('m1', 'b', 0),
      swm('m2', 'b', 0),
      swm('m3', 'a', 0),
      swm('m4', 'a', 0),
      swm('m5', 'c', 0),
    ];
    const out = pickSweeper(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('a');
    expect(out[0].sweeps).toBe(2);
  });

  test('tie at top → better standings rank wins', () => {
    const rows: SweeperMatchRow[] = [
      swm('m1', 'a', 0, 6, 3),
      swm('m2', 'a', 0, 6, 3),
      swm('m3', 'b', 0, 6, 1), // better rank
      swm('m4', 'b', 0, 6, 1),
    ];
    const out = pickSweeper(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('b');
  });

  test('zero sweeps in input → no winners', () => {
    const rows: SweeperMatchRow[] = [
      swm('m1', 'a', 1),
      swm('m2', 'b', 2),
    ];
    expect(pickSweeper(rows)).toEqual([]);
  });

  test('empty input → no winners', () => {
    expect(pickSweeper([])).toEqual([]);
  });

  test('winnerGp=0 (no Pokemon recorded) is skipped even with 0 deaths', () => {
    // Edge case: a match with no match_pokemon rows for the winner shouldn't
    // count as a sweep (we have no evidence they didn't lose mons).
    const rows: SweeperMatchRow[] = [
      swm('m1', 'a', 0, 0), // 0 GP — not a real sweep
      swm('m2', 'b', 0, 6),
    ];
    const out = pickSweeper(rows);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe('b');
  });
});
