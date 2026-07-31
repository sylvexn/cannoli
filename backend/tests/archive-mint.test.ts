import { describe, expect, test } from 'bun:test';
import {
  pickChampion,
  pickHighScore,
  pickStealOfTheDraft,
  pickSweeper,
  type ChampionFinalsRow,
  type HighScoreRow,
  type StealRow,
  type SweeperMatchRow,
} from '../src/lib/pins/archive-mint';

// Champion

describe('pickChampion', () => {
  test('single decisive final → home wins', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 5, awayScore: 1 },
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
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 4 },
    ];
    const out = pickChampion(rows);
    expect(out!.winnerTeamId).toBe('b');
    expect(out!.loserTeamId).toBe('a');
    expect(out!.winnerSum).toBe(4);
    expect(out!.loserSum).toBe(1);
  });

  test('best-of-3 series — sum scores to pick winner', () => {
    // Game 1: a wins 4-2. Game 2: b wins 3-1. Game 3: a wins 5-2.
    // Series totals: a=10, b=7. a should win.
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 4, awayScore: 2 },
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 3 },
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 5, awayScore: 2 },
    ];
    const out = pickChampion(rows);
    expect(out!.winnerTeamId).toBe('a');
    expect(out!.loserTeamId).toBe('b');
    expect(out!.winnerSum).toBe(10);
    expect(out!.loserSum).toBe(7);
  });

  test('tied series → null (unresolved)', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 3, awayScore: 3 },
    ];
    expect(pickChampion(rows)).toBeNull();
  });

  test('multi-game tied series → null', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 4, awayScore: 2 },
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 3 },
    ];
    // a=5, b=5
    expect(pickChampion(rows)).toBeNull();
  });

  test('any unfinished match → null', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 4, awayScore: 2 },
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: null, awayScore: null },
    ];
    expect(pickChampion(rows)).toBeNull();
  });

  test('empty input → null', () => {
    expect(pickChampion([])).toBeNull();
  });
});

// High Score

function hs(teamId: string, pokemon: string, kills: number, matchId = 'm1', week: number | null = 1, phase = 'regular'): HighScoreRow {
  return { teamId, pokemonName: pokemon, matchId, kills, week, phase };
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

  test('tie at the top → all tied returned', () => {
    const rows: HighScoreRow[] = [
      hs('a', 'dragapult', 6, 'm1'),
      hs('b', 'garchomp', 6, 'm2'),
      hs('c', 'gholdengo', 4, 'm3'),
    ];
    const out = pickHighScore(rows);
    expect(out).toHaveLength(2);
    expect(new Set(out.map(w => w.teamId))).toEqual(new Set(['a', 'b']));
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
    const rows: HighScoreRow[] = [
      hs('a', 'dragapult', 0),
      hs('b', 'garchomp', 0),
    ];
    expect(pickHighScore(rows)).toEqual([]);
  });

  test('empty input → no winners', () => {
    expect(pickHighScore([])).toEqual([]);
  });

  test('same Pokemon for one team in different matches → both kept if tied', () => {
    // Same Pokemon, different matches both at top kill count.
    const rows: HighScoreRow[] = [
      hs('a', 'dragapult', 5, 'm1', 1),
      hs('a', 'dragapult', 5, 'm5', 5),
      hs('b', 'garchomp', 3, 'm2'),
    ];
    const out = pickHighScore(rows);
    expect(out).toHaveLength(2);
    expect(new Set(out.map(w => w.matchId))).toEqual(new Set(['m1', 'm5']));
  });
});

// Steal of the Draft

function sr(teamId: string, pokemon: string, kills: number, gp: number, cost: number | null): StealRow {
  return { teamId, pokemonName: pokemon, kills, gp, cost };
}

describe('pickStealOfTheDraft', () => {
  test('best K-per-point ratio wins', () => {
    // a: 12k / 3cost = 4.0
    // b: 10k / 5cost = 2.0
    // c: 8k / 2cost = 4.0
    const rows: StealRow[] = [
      sr('a', 'dragapult', 12, 8, 3),
      sr('b', 'koraidon', 10, 8, 5),
      sr('c', 'rotom-wash', 8, 8, 2),
    ];
    const out = pickStealOfTheDraft(rows);
    // a and c tie at 4.0
    expect(out).toHaveLength(2);
    expect(new Set(out.map(w => w.teamId))).toEqual(new Set(['a', 'c']));
    expect(out.every(w => w.ratio === 4)).toBe(true);
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

  test('rows with zero kills are filtered out', () => {
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

function swm(matchId: string, winnerTeamId: string, winnerDeaths: number, winnerGp = 6): SweeperMatchRow {
  return { matchId, winnerTeamId, winnerGp, winnerDeaths };
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

  test('tie at top → all tied teams returned', () => {
    const rows: SweeperMatchRow[] = [
      swm('m1', 'a', 0),
      swm('m2', 'a', 0),
      swm('m3', 'b', 0),
      swm('m4', 'b', 0),
      swm('m5', 'c', 0),
    ];
    const out = pickSweeper(rows);
    expect(out).toHaveLength(2);
    expect(new Set(out.map(w => w.teamId))).toEqual(new Set(['a', 'b']));
    expect(out.every(w => w.sweeps === 2)).toBe(true);
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
