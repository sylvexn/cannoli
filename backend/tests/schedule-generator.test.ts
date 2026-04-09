import { describe, expect, test } from 'bun:test';
import { generateRoundRobin } from '../src/lib/schedule-generator';

function teams(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${i + 1}`);
}

describe('generateRoundRobin (pure)', () => {
  describe('balanced home/away assignment', () => {
    for (const n of [4, 6, 8, 10, 12]) {
      test(`n=${n}: every team has within-1 home games`, () => {
        const ids = teams(n);
        const { matches } = generateRoundRobin(ids);

        const homeCount = new Map(ids.map(t => [t, 0]));
        for (const m of matches) {
          homeCount.set(m.homeTeamId, (homeCount.get(m.homeTeamId) ?? 0) + 1);
        }
        const counts = ids.map(t => homeCount.get(t)!);
        const min = Math.min(...counts);
        const max = Math.max(...counts);
        expect(max - min).toBeLessThanOrEqual(1);

        // Total home + away games per team = n - 1 (full round robin).
        const totalCount = new Map(ids.map(t => [t, 0]));
        for (const m of matches) {
          totalCount.set(m.homeTeamId, (totalCount.get(m.homeTeamId) ?? 0) + 1);
          totalCount.set(m.awayTeamId, (totalCount.get(m.awayTeamId) ?? 0) + 1);
        }
        for (const t of ids) {
          expect(totalCount.get(t)).toBe(n - 1);
        }
      });
    }
  });

  describe('full coverage', () => {
    for (const n of [4, 6, 8]) {
      test(`n=${n}: total fixtures = C(n,2) and every pair plays once`, () => {
        const ids = teams(n);
        const { matches } = generateRoundRobin(ids);
        expect(matches.length).toBe((n * (n - 1)) / 2);

        const seen = new Set<string>();
        for (const m of matches) {
          const key = [m.homeTeamId, m.awayTeamId].sort().join('|');
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
        expect(seen.size).toBe((n * (n - 1)) / 2);
      });
    }
  });

  describe('weeks per round', () => {
    test('n=8: each round has exactly n/2 = 4 matches, 7 rounds total', () => {
      const { matches } = generateRoundRobin(teams(8));
      const byWeek = new Map<number, number>();
      for (const m of matches) {
        byWeek.set(m.week, (byWeek.get(m.week) ?? 0) + 1);
      }
      expect(byWeek.size).toBe(7);
      for (const [, count] of byWeek) {
        expect(count).toBe(4);
      }
    });

    test('a team plays at most one match per week', () => {
      const ids = teams(8);
      const { matches } = generateRoundRobin(ids);
      const seen = new Set<string>();
      for (const m of matches) {
        const homeKey = `${m.homeTeamId}-w${m.week}`;
        const awayKey = `${m.awayTeamId}-w${m.week}`;
        expect(seen.has(homeKey)).toBe(false);
        expect(seen.has(awayKey)).toBe(false);
        seen.add(homeKey);
        seen.add(awayKey);
      }
    });
  });

  describe('odd team counts (bye weeks)', () => {
    for (const n of [3, 5, 7, 9]) {
      test(`n=${n}: every team gets exactly one bye, n rounds total`, () => {
        const ids = teams(n);
        const { matches, byes } = generateRoundRobin(ids);

        // n rounds when n odd
        const allWeeks = new Set([
          ...matches.map(m => m.week),
          ...byes.map(b => b.week),
        ]);
        expect(allWeeks.size).toBe(n);

        // Every team must sit out exactly once.
        const byeCount = new Map(ids.map(t => [t, 0]));
        for (const b of byes) byeCount.set(b.teamId, (byeCount.get(b.teamId) ?? 0) + 1);
        for (const t of ids) {
          expect(byeCount.get(t)).toBe(1);
        }
        expect(byes.length).toBe(n);
      });
    }

    test('n=5: full round-robin still happens (all C(5,2)=10 pairings)', () => {
      const { matches } = generateRoundRobin(teams(5));
      expect(matches.length).toBe(10);
      const seen = new Set<string>();
      for (const m of matches) {
        seen.add([m.homeTeamId, m.awayTeamId].sort().join('|'));
      }
      expect(seen.size).toBe(10);
    });

    test('n=7: balanced home counts even with byes', () => {
      const ids = teams(7);
      const { matches } = generateRoundRobin(ids);
      const homeCount = new Map(ids.map(t => [t, 0]));
      for (const m of matches) {
        homeCount.set(m.homeTeamId, (homeCount.get(m.homeTeamId) ?? 0) + 1);
      }
      const counts = ids.map(t => homeCount.get(t)!);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    });
  });

  describe('idempotency / determinism', () => {
    test('same input → identical output across calls', () => {
      const ids = teams(8);
      const a = generateRoundRobin(ids);
      const b = generateRoundRobin(ids);
      expect(a).toEqual(b);
    });

    test('regression: 8-team circle method bug — t6/t8 used to get only 2 home games', () => {
      // Before the Berger rewrite the old circle method gave teams 6 and 8 (in
      // the seeded order ['t1'..'t8']) only 2 home games each, and four other
      // teams 4 each. Pin the home-spread invariant so we don't regress.
      const ids = teams(8);
      const { matches } = generateRoundRobin(ids);
      const homeCount = new Map(ids.map(t => [t, 0]));
      for (const m of matches) {
        homeCount.set(m.homeTeamId, (homeCount.get(m.homeTeamId) ?? 0) + 1);
      }
      const counts = ids.map(t => homeCount.get(t)!).sort((a, b) => a - b);
      expect(counts[0]).toBeGreaterThanOrEqual(3);
      expect(counts[counts.length - 1]).toBeLessThanOrEqual(4);
    });
  });
});
