/**
 * simulateMatch tests — the synthetic result generator must be deterministic
 * and must produce K/D tables that the REAL match validator accepts with zero
 * errors AND zero warnings.
 */
import { describe, expect, test } from 'bun:test';
import { MockRng } from '../src/lib/sim/mock-rng';
import { simulateMatch, type SimRosterMon } from '../src/lib/sim/simulate-match';
import { validatePokemonData } from '../src/lib/match-validation';

const HOME = 'home-team';
const AWAY = 'away-team';

/** Build an N-mon roster with deterministic tiers from a MockRng. */
function makeRoster(rng: MockRng, size: number, prefix: string): SimRosterMon[] {
  return Array.from({ length: size }, (_, i) => ({
    pokemonName: `${prefix}-mon-${i}`,
    tier: rng.int(1, 9),
  }));
}

/** Roster→Set map in the shape validatePokemonData wants. */
function rosterMap(home: SimRosterMon[], away: SimRosterMon[]): Map<string, Set<string>> {
  return new Map([
    [HOME, new Set(home.map(m => m.pokemonName.toLowerCase()))],
    [AWAY, new Set(away.map(m => m.pokemonName.toLowerCase()))],
  ]);
}

describe('MockRng', () => {
  test('is deterministic for a given seed', () => {
    const a = new MockRng(12345);
    const b = new MockRng(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test('next() stays in [0, 1)', () => {
    const rng = new MockRng(7);
    for (let i = 0; i < 5000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('int() respects bounds inclusively', () => {
    const rng = new MockRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(3, 8);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(8);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([3, 4, 5, 6, 7, 8]));
  });

  test('weighted() never returns a zero-weight item when others exist', () => {
    const rng = new MockRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.weighted([
        { value: 'a', weight: 1 },
        { value: 'b', weight: 0 },
      ]);
      expect(v).toBe('a');
    }
  });
});

describe('simulateMatch — determinism', () => {
  test('same seed → byte-identical output', () => {
    const homeR = makeRoster(new MockRng(1), 11, 'h');
    const awayR = makeRoster(new MockRng(2), 11, 'a');
    const r1 = simulateMatch({ homeTeamId: HOME, awayTeamId: AWAY, homeRoster: homeR, awayRoster: awayR, rng: new MockRng(555) });
    const r2 = simulateMatch({ homeTeamId: HOME, awayTeamId: AWAY, homeRoster: homeR, awayRoster: awayR, rng: new MockRng(555) });
    expect(r1).toEqual(r2);
  });

  test('different seeds diverge', () => {
    const homeR = makeRoster(new MockRng(1), 11, 'h');
    const awayR = makeRoster(new MockRng(2), 11, 'a');
    const r1 = simulateMatch({ homeTeamId: HOME, awayTeamId: AWAY, homeRoster: homeR, awayRoster: awayR, rng: new MockRng(1) });
    const r2 = simulateMatch({ homeTeamId: HOME, awayTeamId: AWAY, homeRoster: homeR, awayRoster: awayR, rng: new MockRng(900001) });
    // Overwhelmingly likely to differ in score or K/D layout.
    expect(JSON.stringify(r1)).not.toBe(JSON.stringify(r2));
  });
});

describe('simulateMatch — validator contract (1000 seeds)', () => {
  test('zero errors AND zero warnings across 1000 random matches', () => {
    let errorRuns = 0;
    let warningRuns = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const setup = new MockRng(seed * 2654435761);
      const homeSize = setup.int(8, 12);
      const awaySize = setup.int(8, 12);
      const homeR = makeRoster(setup, homeSize, `h${seed}`);
      const awayR = makeRoster(setup, awaySize, `a${seed}`);

      const result = simulateMatch({
        homeTeamId: HOME,
        awayTeamId: AWAY,
        homeRoster: homeR,
        awayRoster: awayR,
        rng: new MockRng(seed),
      });

      const v = validatePokemonData(
        result.pokemonData,
        HOME,
        AWAY,
        rosterMap(homeR, awayR),
        { homeScore: result.homeScore, awayScore: result.awayScore },
      );
      if (v.errors.length > 0) {
        errorRuns++;
        if (errorRuns <= 3) console.error(`seed ${seed} errors:`, v.errors);
      }
      if (v.warnings.length > 0) {
        warningRuns++;
        if (warningRuns <= 3) console.error(`seed ${seed} warnings:`, v.warnings);
      }
    }
    expect(errorRuns).toBe(0);
    expect(warningRuns).toBe(0);
  });
});

describe('simulateMatch — scoring', () => {
  test('scores are in valid Pokemon-draft range and have a clear winner', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const setup = new MockRng(seed * 40503);
      const homeR = makeRoster(setup, 11, `h${seed}`);
      const awayR = makeRoster(setup, 11, `a${seed}`);
      const r = simulateMatch({ homeTeamId: HOME, awayTeamId: AWAY, homeRoster: homeR, awayRoster: awayR, rng: new MockRng(seed) });

      const winner = Math.max(r.homeScore, r.awayScore);
      const loser = Math.min(r.homeScore, r.awayScore);
      expect(winner).toBe(6);
      expect(loser).toBeGreaterThanOrEqual(0);
      expect(loser).toBeLessThanOrEqual(5);
      // No draws — Pokemon draft matches always resolve.
      expect(r.homeScore).not.toBe(r.awayScore);
    }
  });

  test('each brought mon faints 0 or 1 time; ≤6 mons per team', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const setup = new MockRng(seed * 7919);
      const homeR = makeRoster(setup, 11, `h${seed}`);
      const awayR = makeRoster(setup, 11, `a${seed}`);
      const r = simulateMatch({ homeTeamId: HOME, awayTeamId: AWAY, homeRoster: homeR, awayRoster: awayR, rng: new MockRng(seed) });

      const homeEntries = r.pokemonData.filter(e => e.teamId === HOME);
      const awayEntries = r.pokemonData.filter(e => e.teamId === AWAY);
      expect(homeEntries.length).toBeLessThanOrEqual(6);
      expect(awayEntries.length).toBeLessThanOrEqual(6);
      for (const e of r.pokemonData) {
        expect(e.deaths === 0 || e.deaths === 1).toBe(true);
        expect(e.kills).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('replayUrl is the synthetic sim namespace', () => {
    const homeR = makeRoster(new MockRng(1), 11, 'h');
    const awayR = makeRoster(new MockRng(2), 11, 'a');
    const r = simulateMatch({ homeTeamId: HOME, awayTeamId: AWAY, homeRoster: homeR, awayRoster: awayR, rng: new MockRng(3) });
    expect(r.replayUrl).toBe(`https://replay.cannoli.live/sim/${HOME}-${AWAY}`);
  });
});

describe('simulateMatch — competitive balance', () => {
  test('higher-value roster wins > 70% of a large sample', () => {
    // Home roster is uniformly stronger (all tier 9) vs away (all tier 3).
    const strong: SimRosterMon[] = Array.from({ length: 11 }, (_, i) => ({ pokemonName: `s-${i}`, tier: 9 }));
    const weak: SimRosterMon[] = Array.from({ length: 11 }, (_, i) => ({ pokemonName: `w-${i}`, tier: 3 }));
    let strongWins = 0;
    const N = 2000;
    for (let seed = 1; seed <= N; seed++) {
      const r = simulateMatch({ homeTeamId: HOME, awayTeamId: AWAY, homeRoster: strong, awayRoster: weak, rng: new MockRng(seed) });
      if (r.homeScore > r.awayScore) strongWins++;
    }
    const rate = strongWins / N;
    expect(rate).toBeGreaterThan(0.7);
    // Upsets still happen — not a 100% steamroll.
    expect(rate).toBeLessThan(0.95);
  });

  test('evenly-matched rosters split roughly 50/50', () => {
    const even: SimRosterMon[] = Array.from({ length: 11 }, (_, i) => ({ pokemonName: `e-${i}`, tier: 6 }));
    const evenB: SimRosterMon[] = Array.from({ length: 11 }, (_, i) => ({ pokemonName: `f-${i}`, tier: 6 }));
    let homeWins = 0;
    const N = 2000;
    for (let seed = 1; seed <= N; seed++) {
      const r = simulateMatch({ homeTeamId: HOME, awayTeamId: AWAY, homeRoster: even, awayRoster: evenB, rng: new MockRng(seed) });
      if (r.homeScore > r.awayScore) homeWins++;
    }
    const rate = homeWins / N;
    expect(rate).toBeGreaterThan(0.4);
    expect(rate).toBeLessThan(0.6);
  });
});
