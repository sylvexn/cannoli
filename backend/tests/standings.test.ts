import { describe, expect, test } from 'bun:test';
import { computeStandings, orderRecords, type RawRecord } from '../src/lib/standings';

/** Build a head-to-head lookup that returns the same provided wins map for any
 *  tiedIds set. Tests pass in the wins map directly so we don't have to recompute. */
function staticH2h(wins: Record<string, number>) {
  return (tiedIds: string[]) => {
    const m = new Map<string, number>();
    for (const id of tiedIds) m.set(id, wins[id] ?? 0);
    return m;
  };
}

function record(id: string, w: number, l: number, pf: number, pa: number): RawRecord {
  return { id, wins: w, losses: l, pointsFor: pf, pointsAgainst: pa };
}

describe('orderRecords (tiebreaker hierarchy)', () => {
  test('unique wins → no tiebreaker', () => {
    const out = orderRecords(
      [record('a', 5, 2, 30, 20), record('b', 3, 4, 25, 25), record('c', 7, 0, 40, 10)],
      staticH2h({}),
    );
    expect(out.map(r => r.id)).toEqual(['c', 'a', 'b']);
    for (const row of out) expect(row.tiebreaker).toBeNull();
  });

  test('two-way tie resolved by H2H', () => {
    // a, b both 4-3 with same diff and PF; H2H gives a 1-0 → a above b
    const out = orderRecords(
      [
        record('a', 4, 3, 30, 25),
        record('b', 4, 3, 30, 25),
        record('c', 2, 5, 20, 30),
      ],
      staticH2h({ a: 1, b: 0 }),
    );
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(out[0].tiebreaker).toEqual({ rule: 'h2h', value: 1 });
    expect(out[1].tiebreaker).toEqual({ rule: 'h2h', value: 0 });
    expect(out[2].tiebreaker).toBeNull();
  });

  test('3-way tie at wins=4 resolved by H2H sub-bucket (a > b > c)', () => {
    // 3 teams 4-3; H2H within the set: a=2, b=1, c=0
    const out = orderRecords(
      [
        record('a', 4, 3, 30, 25),
        record('b', 4, 3, 32, 26),
        record('c', 4, 3, 28, 22),
      ],
      staticH2h({ a: 2, b: 1, c: 0 }),
    );
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(out.every(r => r.tiebreaker?.rule === 'h2h')).toBe(true);
  });

  test('tied W-L with equal H2H resolved by differential', () => {
    // a, b both 4-3, both 0 H2H wins (e.g. swept), but a has +5 diff vs b's -1
    const out = orderRecords(
      [
        record('a', 4, 3, 30, 25), // diff +5
        record('b', 4, 3, 24, 25), // diff -1
      ],
      staticH2h({ a: 0, b: 0 }),
    );
    expect(out.map(r => r.id)).toEqual(['a', 'b']);
    expect(out[0].tiebreaker).toEqual({ rule: 'diff', value: 5 });
    expect(out[1].tiebreaker).toEqual({ rule: 'diff', value: -1 });
  });

  test('tied diff resolved by points-for (kills)', () => {
    const out = orderRecords(
      [
        record('a', 4, 3, 35, 30), // diff +5, PF 35
        record('b', 4, 3, 25, 20), // diff +5, PF 25
      ],
      staticH2h({ a: 0, b: 0 }),
    );
    expect(out.map(r => r.id)).toEqual(['a', 'b']);
    expect(out[0].tiebreaker).toEqual({ rule: 'kills', value: 35 });
    expect(out[1].tiebreaker).toEqual({ rule: 'kills', value: 25 });
  });

  test('truly identical rows fall back to id ordering', () => {
    const out = orderRecords(
      [
        record('beta', 4, 3, 30, 25),
        record('alpha', 4, 3, 30, 25),
      ],
      staticH2h({ alpha: 0, beta: 0 }),
    );
    expect(out.map(r => r.id)).toEqual(['alpha', 'beta']);
    expect(out[0].tiebreaker).toEqual({ rule: 'id', value: 'alpha' });
  });

  test('tiebreaker field carries the value used to break the tie', () => {
    const out = orderRecords(
      [
        record('a', 4, 3, 35, 25), // diff +10
        record('b', 4, 3, 25, 25), // diff 0
      ],
      staticH2h({ a: 0, b: 0 }),
    );
    expect(out[0].tiebreaker?.value).toBe(10);
    expect(out[1].tiebreaker?.value).toBe(0);
  });

  test('returned rows include differential, kills, deaths', () => {
    const out = orderRecords(
      [record('a', 5, 2, 33, 21)],
      staticH2h({}),
    );
    expect(out[0].differential).toBe(12);
    expect(out[0].kills).toBe(33);
    expect(out[0].deaths).toBe(21);
  });

  // Regression: phase: 'all' used to splice an empty sql`` into and(...),
  // producing `WHERE … AND ()` and crashing with `near ")" syntax error`.
  // Just exercise the SQL path — empty/unknown leagueId is fine, we only care
  // that no SQLiteError is thrown.
  test("regression: computeStandings({ phase: 'all' }) does not crash with SQL syntax error", () => {
    expect(() => computeStandings('__nonexistent_league__', { phase: 'all' })).not.toThrow();
    expect(() => computeStandings('__nonexistent_league__', { phase: 'regular' })).not.toThrow();
    expect(() => computeStandings('__nonexistent_league__')).not.toThrow();
  });

  test('different wins-buckets each evaluate tiebreakers independently', () => {
    // High bucket (a, b at 5 wins) ties with diff differing.
    // Low bucket (c, d at 2 wins) ties with H2H differing.
    const out = orderRecords(
      [
        record('a', 5, 2, 35, 25),
        record('b', 5, 2, 28, 26),
        record('c', 2, 5, 18, 22),
        record('d', 2, 5, 18, 22),
      ],
      staticH2h({ c: 1, d: 0 }),
    );
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(out[0].tiebreaker?.rule).toBe('diff'); // a vs b
    expect(out[1].tiebreaker?.rule).toBe('diff');
    expect(out[2].tiebreaker?.rule).toBe('h2h'); // c vs d
    expect(out[3].tiebreaker?.rule).toBe('h2h');
  });
});
