import { test, expect, describe } from 'bun:test';
import {
  buildSuggestions,
  matchRawQuery,
  matchChip,
  normalizeMoveQuery,
  moveDisplayName,
  type SearchChip,
} from '@/lib/pool-search';

/**
 * Pure-logic coverage for the unified draft-board search (pool-search.ts).
 * These helpers decide which Pokemon the merged search bar surfaces — by name,
 * ability, or learned move — plus the grouped autocomplete suggestions and the
 * "why it matched" badge reason. A regression here silently hides/shows the
 * wrong Pokemon during a live draft, so unit coverage is the right net.
 *
 * Run: `bun test src/lib/pool-search.test.ts` from frontend/.
 */

const FMT = 'gen9natdex' as const;
const GARCHOMP_ABILITIES = ['Sand Veil', 'Rough Skin'];

describe('normalizeMoveQuery', () => {
  test('strips spaces, punctuation, case', () => {
    expect(normalizeMoveQuery('Stealth Rock')).toBe('stealthrock');
    expect(normalizeMoveQuery('U-turn')).toBe('uturn');
  });
});

describe('moveDisplayName', () => {
  test('maps known ids, falls back to the id', () => {
    expect(moveDisplayName('stealthrock')).toBe('Stealth Rock');
    expect(moveDisplayName('thunderbolt')).toBe('Thunderbolt');
    expect(moveDisplayName('notarealmove')).toBe('notarealmove');
  });
});

describe('matchRawQuery (broad OR)', () => {
  test('matches by name → no badge reason', () => {
    const r = matchRawQuery('Garchomp', 'garch', FMT, GARCHOMP_ABILITIES);
    expect(r.matched).toBe(true);
    expect(r.reason).toBeNull();
  });

  test('matches by ability → ability reason', () => {
    const r = matchRawQuery('Garchomp', 'rough skin', FMT, GARCHOMP_ABILITIES);
    expect(r.matched).toBe(true);
    expect(r.reason).toEqual({ kind: 'ability', label: 'Rough Skin' });
  });

  test('matches by learned move → move reason with display name', () => {
    const r = matchRawQuery('Garchomp', 'stealth rock', FMT, GARCHOMP_ABILITIES);
    expect(r.matched).toBe(true);
    expect(r.reason).toEqual({ kind: 'move', label: 'Stealth Rock' });
  });

  test('no match when nothing hits', () => {
    const r = matchRawQuery('Garchomp', 'xqzzy', FMT, GARCHOMP_ABILITIES);
    expect(r.matched).toBe(false);
    expect(r.reason).toBeNull();
  });

  test('empty query always matches with no reason', () => {
    expect(matchRawQuery('Garchomp', '', FMT, GARCHOMP_ABILITIES)).toEqual({ matched: true, reason: null });
  });
});

describe('matchChip (AND, exact)', () => {
  test('name chip is exact (case-insensitive)', () => {
    const chip: SearchChip = { kind: 'name', value: 'Garchomp', label: 'Garchomp' };
    expect(matchChip('Garchomp', chip, FMT, [])).toBe(true);
    expect(matchChip('Gholdengo', chip, FMT, [])).toBe(false);
  });

  test('ability chip checks resolved abilities', () => {
    const chip: SearchChip = { kind: 'ability', value: 'Rough Skin', label: 'Rough Skin' };
    expect(matchChip('Garchomp', chip, FMT, GARCHOMP_ABILITIES)).toBe(true);
    expect(matchChip('Garchomp', chip, FMT, [])).toBe(false);
  });

  test('move chip checks the format learnset', () => {
    const chip: SearchChip = { kind: 'move', value: 'stealthrock', label: 'Stealth Rock' };
    expect(matchChip('Garchomp', chip, FMT, [])).toBe(true);
    // Garchomp does not learn Surf-less nonsense; use a move it lacks:
    const noLearn: SearchChip = { kind: 'move', value: 'moonblast', label: 'Moonblast' };
    expect(matchChip('Garchomp', noLearn, FMT, [])).toBe(false);
  });
});

describe('buildSuggestions', () => {
  test('empty query → all groups empty', () => {
    expect(buildSuggestions('', FMT)).toEqual({ pokemon: [], abilities: [], moves: [] });
  });

  test('surfaces a Pokemon name match', () => {
    const s = buildSuggestions('garch', FMT);
    expect(s.pokemon.some(p => p.value === 'Garchomp')).toBe(true);
  });

  test('surfaces an ability match', () => {
    const s = buildSuggestions('rough skin', FMT);
    expect(s.abilities.some(a => a.value === 'Rough Skin')).toBe(true);
  });

  test('surfaces a move match with display label and move id value', () => {
    const s = buildSuggestions('stealth rock', FMT);
    const m = s.moves.find(x => x.value === 'stealthrock');
    expect(m).toBeDefined();
    expect(m?.label).toBe('Stealth Rock');
  });

  test('caps each group at perGroup', () => {
    const s = buildSuggestions('a', FMT, { perGroup: 3 });
    expect(s.pokemon.length).toBeLessThanOrEqual(3);
    expect(s.abilities.length).toBeLessThanOrEqual(3);
    expect(s.moves.length).toBeLessThanOrEqual(3);
  });

  test('excludes already-committed chips', () => {
    const chip: SearchChip = { kind: 'move', value: 'stealthrock', label: 'Stealth Rock' };
    const s = buildSuggestions('stealth rock', FMT, { exclude: [chip] });
    expect(s.moves.some(x => x.value === 'stealthrock')).toBe(false);
  });
});
