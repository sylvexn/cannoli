/**
 * Unit tests for the pure pokemonData validator powering
 * `POST /api/matches/:matchId/result`.
 *
 * The DB-backed wrapper (validatePokemonDataForMatch) just loads rosters and
 * delegates here; testing the pure helper covers the validation contract
 * without standing up a database for each case.
 */
import { describe, expect, test } from 'bun:test';
import {
  validatePokemonData,
  type PokemonDataEntry,
} from '../src/lib/match-validation';

const HOME = 'home-tid';
const AWAY = 'away-tid';

const rosters = new Map<string, Set<string>>([
  [HOME, new Set(['garchomp', 'tinkaton', 'iron valiant'])],
  [AWAY, new Set(['kingambit', 'baxcalibur', 'great tusk'])],
]);

function entry(over: Partial<PokemonDataEntry>): PokemonDataEntry {
  return {
    teamId: HOME,
    pokemonName: 'Garchomp',
    kills: 0,
    deaths: 0,
    ...over,
  };
}

describe('validatePokemonData', () => {
  test('accepts a valid result with both sides on roster', () => {
    const result = validatePokemonData(
      [
        entry({ teamId: HOME, pokemonName: 'Garchomp', kills: 3, deaths: 1 }),
        entry({ teamId: HOME, pokemonName: 'Tinkaton', kills: 1, deaths: 1 }),
        entry({ teamId: AWAY, pokemonName: 'Kingambit', kills: 2, deaths: 1 }),
        entry({ teamId: AWAY, pokemonName: 'Baxcalibur', kills: 1, deaths: 1 }),
      ],
      HOME,
      AWAY,
      rosters,
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test('warns on score / deaths-sum mismatch and >6 entries per team', () => {
    // homeScore=3 should equal awayDeaths (sum of deaths on AWAY); we give
    // away 4 deaths total → mismatch on home side. awayScore=2 should equal
    // home deaths; we give home 1 death → mismatch on away side. Plus we
    // pile 7 entries on the home team to trigger the >6 warning.
    const result = validatePokemonData(
      [
        entry({ teamId: HOME, pokemonName: 'Garchomp', kills: 2, deaths: 1 }),
        entry({ teamId: HOME, pokemonName: 'Tinkaton', kills: 1, deaths: 0 }),
        entry({ teamId: HOME, pokemonName: 'Iron Valiant', kills: 0, deaths: 0 }),
        entry({ teamId: HOME, pokemonName: 'Garchomp', kills: 0, deaths: 0 }),
        entry({ teamId: HOME, pokemonName: 'Tinkaton', kills: 0, deaths: 0 }),
        entry({ teamId: HOME, pokemonName: 'Iron Valiant', kills: 0, deaths: 0 }),
        entry({ teamId: HOME, pokemonName: 'Garchomp', kills: 0, deaths: 0 }),
        entry({ teamId: AWAY, pokemonName: 'Kingambit', kills: 1, deaths: 2 }),
        entry({ teamId: AWAY, pokemonName: 'Baxcalibur', kills: 0, deaths: 2 }),
      ],
      HOME,
      AWAY,
      rosters,
      { homeScore: 3, awayScore: 2 },
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    // Expect 3 warnings: home-mismatch, away-mismatch, home>6
    expect(result.warnings.length).toBe(3);
    expect(result.warnings.some(w => w.includes('homeScore=3'))).toBe(true);
    expect(result.warnings.some(w => w.includes('awayScore=2'))).toBe(true);
    expect(result.warnings.some(w => w.includes('home team') && w.includes('more than 6'))).toBe(true);
  });

  test('no warnings when scores match deaths and entry counts are normal', () => {
    const result = validatePokemonData(
      [
        entry({ teamId: HOME, pokemonName: 'Garchomp', kills: 3, deaths: 1 }),
        entry({ teamId: HOME, pokemonName: 'Tinkaton', kills: 0, deaths: 1 }),
        entry({ teamId: AWAY, pokemonName: 'Kingambit', kills: 2, deaths: 2 }),
        entry({ teamId: AWAY, pokemonName: 'Baxcalibur', kills: 0, deaths: 1 }),
      ],
      HOME,
      AWAY,
      rosters,
      { homeScore: 3, awayScore: 2 },
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test('case-insensitive pokemonName match against roster', () => {
    const result = validatePokemonData(
      [entry({ pokemonName: 'IRON VALIANT' })],
      HOME,
      AWAY,
      rosters,
    );
    expect(result.ok).toBe(true);
  });

  test('rejects an entry with a teamId outside the match', () => {
    const stranger = 'stranger-tid';
    const result = validatePokemonData(
      [
        entry({ teamId: HOME, pokemonName: 'Garchomp' }),
        entry({ teamId: stranger, pokemonName: 'Garchomp' }),
      ],
      HOME,
      AWAY,
      rosters,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      index: 1,
      teamId: stranger,
      reason: expect.stringContaining('teamId must be one of'),
    });
  });

  test('rejects an entry with a pokemonName not on that team\'s roster', () => {
    const result = validatePokemonData(
      [
        entry({ teamId: HOME, pokemonName: 'Garchomp' }),
        // Kingambit is on AWAY, not HOME — a side mix-up the staff client
        // could realistically produce by clicking the wrong column.
        entry({ teamId: HOME, pokemonName: 'Kingambit' }),
      ],
      HOME,
      AWAY,
      rosters,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      index: 1,
      teamId: HOME,
      pokemonName: 'Kingambit',
      reason: expect.stringContaining('not on team'),
    });
  });

  test('reports every offending row, not just the first', () => {
    const result = validatePokemonData(
      [
        entry({ teamId: HOME, pokemonName: 'Mewtwo' }),       // not on roster
        entry({ teamId: 'bogus', pokemonName: 'Garchomp' }),  // wrong teamId
        entry({ teamId: AWAY, pokemonName: 'Kingambit' }),    // ok
      ],
      HOME,
      AWAY,
      rosters,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map(e => e.index)).toEqual([0, 1]);
  });
});
