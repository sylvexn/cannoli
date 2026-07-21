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

  test('two-way tie resolved by H2H (diff also tied)', () => {
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

  test('two-way tie: differential outranks H2H (feedback #77)', () => {
    // a and b both 4-3. b lost the head-to-head (0 in-set wins vs a's 1) but
    // has the better overall point differential. Differential is checked
    // before H2H, so b ranks above a despite losing their direct match.
    const out = orderRecords(
      [
        record('a', 4, 3, 28, 25), // diff +3, h2h 1
        record('b', 4, 3, 34, 25), // diff +9, h2h 0
      ],
      staticH2h({ a: 1, b: 0 }),
    );
    expect(out.map(r => r.id)).toEqual(['b', 'a']);
    expect(out[0].tiebreaker).toEqual({ rule: 'diff', value: 9 });
    expect(out[1].tiebreaker).toEqual({ rule: 'diff', value: 3 });
  });

  test('two-way tie: H2H decides once differential is tied (feedback #77)', () => {
    // a and b both 4-3 with identical differential (+5). a won their direct
    // match (h2h 1-0), so once diff fails to separate them H2H promotes a.
    const out = orderRecords(
      [
        record('a', 4, 3, 30, 25), // diff +5, h2h 1
        record('b', 4, 3, 29, 24), // diff +5, h2h 0
      ],
      staticH2h({ a: 1, b: 0 }),
    );
    expect(out.map(r => r.id)).toEqual(['a', 'b']);
    expect(out[0].tiebreaker).toEqual({ rule: 'h2h', value: 1 });
    expect(out[1].tiebreaker).toEqual({ rule: 'h2h', value: 0 });
  });

  test('3-way tie at wins=4 with distinct differentials resolved by differential', () => {
    // 3 teams 4-3 with distinct diffs: b=+9, a=+5, c=+1. Differential is checked
    // before H2H and already fully separates them, so H2H never comes into play
    // (each diff is unique) even though the in-set H2H favors a (a=2, b=1, c=0).
    const out = orderRecords(
      [
        record('a', 4, 3, 30, 25), // diff +5
        record('b', 4, 3, 34, 25), // diff +9
        record('c', 4, 3, 26, 25), // diff +1
      ],
      staticH2h({ a: 2, b: 1, c: 0 }),
    );
    expect(out.map(r => r.id)).toEqual(['b', 'a', 'c']);
    expect(out.every(r => r.tiebreaker?.rule === 'diff')).toBe(true);
  });

  test('multi-way tie: differential outranks h2h (feedback #62)', () => {
    // Early-season 1-1 tie among 3+ teams: x has a strong +4 differential but
    // 0 in-set H2H wins (hasn't played the others yet); y has a losing -1
    // differential but 1 in-set H2H win. Differential is checked FIRST and the
    // three diffs are distinct, so H2H never fires — x ranks top on +4, not y on
    // its lone H2H win. (Before the #62 fix H2H ran first and wrongly promoted y.)
    const out = orderRecords(
      [
        record('x', 1, 1, 14, 10), // diff +4, h2h 0
        record('y', 1, 1, 9, 10),  // diff -1, h2h 1
        record('z', 1, 1, 10, 10), // diff 0,  h2h 0
      ],
      staticH2h({ x: 0, y: 1, z: 0 }),
    );
    expect(out.map(r => r.id)).toEqual(['x', 'z', 'y']);
    expect(out.every(r => r.tiebreaker?.rule === 'diff')).toBe(true);
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

  test('within a 3-way wins tie, H2H breaks a differential sub-tie (not just 2-way)', () => {
    // Three teams 4-3. c is separated by its superior +9 differential. a and b
    // are a genuine wins+differential tie (both +5); a won their head-to-head so
    // H2H — over only {a, b} — promotes a above b, even though b has more kills
    // (PF 32 > 30). The old 2-way-only rule skipped H2H here and let b's kills win.
    const out = orderRecords(
      [
        record('a', 4, 3, 30, 25), // diff +5, PF 30
        record('b', 4, 3, 32, 27), // diff +5, PF 32 (more kills, but lost H2H)
        record('c', 4, 3, 34, 25), // diff +9
      ],
      staticH2h({ a: 1, b: 0, c: 0 }),
    );
    expect(out.map(r => r.id)).toEqual(['c', 'a', 'b']);
    expect(out[0].tiebreaker).toEqual({ rule: 'diff', value: 9 });
    expect(out[1].tiebreaker).toEqual({ rule: 'h2h', value: 1 });
    expect(out[2].tiebreaker).toEqual({ rule: 'h2h', value: 0 });
  });

  test('H2H is scoped to the differential-run, never the whole wins-bucket', () => {
    // 4 teams at 3-2. p (+8) and s (-3) are separated by differential; q and r
    // are the only real tie (+2 each). H2H must be consulted ONLY for {q, r} —
    // a bucket-wide lookup could let a win over p/s leak into the q-vs-r order.
    const calls: string[][] = [];
    const lookup = (tiedIds: string[]) => {
      calls.push([...tiedIds].sort());
      const m = new Map<string, number>();
      for (const id of tiedIds) m.set(id, id === 'q' ? 1 : 0); // q beat r head-to-head
      return m;
    };
    const out = orderRecords(
      [
        record('p', 3, 2, 28, 20), // +8 (unique)
        record('q', 3, 2, 24, 22), // +2 (lower PF, but won H2H)
        record('r', 3, 2, 26, 24), // +2 (higher PF)
        record('s', 3, 2, 17, 20), // -3 (unique)
      ],
      lookup,
    );
    expect(out.map(r => r.id)).toEqual(['p', 'q', 'r', 's']);
    // Consulted exactly once, for exactly the {q, r} run — never for p or s.
    expect(calls).toEqual([['q', 'r']]);
    expect(out[1].tiebreaker).toEqual({ rule: 'h2h', value: 1 });
    expect(out[2].tiebreaker).toEqual({ rule: 'h2h', value: 0 });
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
