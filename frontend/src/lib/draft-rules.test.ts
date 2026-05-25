import { test, expect, describe } from 'bun:test';
import {
  getBaseFormName,
  getFormCategory,
  isMegaForm,
  getMaxAffordableCost,
  findPickConflict,
  findPickWarning,
  type ConflictInputRoster,
} from '@/lib/draft-rules';

/**
 * Pure-logic coverage for the client-side draft validation mirror
 * (frontend/src/lib/draft-rules.ts). These functions gate which cards are
 * draftable, the inline conflict reasons, and the auto-pick skip logic on the
 * draft board — a regression here silently lets illegal picks through (or
 * blocks legal ones) without any visible crash, so unit coverage is the right
 * net rather than e2e.
 *
 * Run: `bun test` from frontend/.
 */

describe('getFormCategory / isMegaForm', () => {
  test('mega prefix and suffix forms classify as mega', () => {
    expect(getFormCategory('Mega Charizard X')).toBe('mega');
    expect(getFormCategory('Charizard-Mega-X')).toBe('mega');
    expect(getFormCategory('Primal Groudon')).toBe('mega');
    expect(isMegaForm('Mega Gengar')).toBe(true);
    expect(isMegaForm('Gengar')).toBe(false);
  });

  test('regional forms classify as regional, not other', () => {
    expect(getFormCategory('Raichu-Alola')).toBe('regional');
    expect(getFormCategory('Zapdos-Galar')).toBe('regional');
  });

  test('hyphenated base species are not misread as form variants', () => {
    expect(getFormCategory('Tapu Koko')).toBe('base');
    expect(getFormCategory('Ho-Oh')).toBe('base');
    expect(getFormCategory('Porygon-Z')).toBe('base');
    expect(getFormCategory('Mr. Mime')).toBe('base');
  });

  test('tera suffix (T) is stripped before classification', () => {
    expect(getFormCategory('Mega Charizard X (T)')).toBe('mega');
    expect(isMegaForm('Mega Gengar (T)')).toBe(true);
  });
});

describe('getBaseFormName (species key for dup detection)', () => {
  test('mega/primal forms reduce to base species', () => {
    expect(getBaseFormName('Mega Charizard X')).toBe('Charizard');
    expect(getBaseFormName('Charizard-Mega-Y')).toBe('Charizard');
    expect(getBaseFormName('Primal Kyogre')).toBe('Kyogre');
  });

  test('regional forms keep their own species key (distinct from base)', () => {
    expect(getBaseFormName('Raichu-Alola')).toBe('Raichu-Alola');
  });

  test('cosmetic suffixes collapse to base', () => {
    expect(getBaseFormName('Rotom-Heat')).toBe('Rotom');
    expect(getBaseFormName('Landorus-Therian')).toBe('Landorus');
  });

  test('tera suffix is stripped', () => {
    expect(getBaseFormName('Charizard (T)')).toBe('Charizard');
  });
});

describe('getMaxAffordableCost', () => {
  test('without picksLeft, returns raw remaining budget', () => {
    const roster: ConflictInputRoster = { pokemonNames: [], pointsUsed: 80 };
    expect(getMaxAffordableCost(roster, 110)).toBe(30);
  });

  test('reserves MIN_PICK_COST per future slot', () => {
    // 3 picks left including this one → must leave 2pt for 2 future slots.
    const roster: ConflictInputRoster = { pokemonNames: [], pointsUsed: 100, picksLeft: 3 };
    expect(getMaxAffordableCost(roster, 110)).toBe(8); // 10 remaining - 2
  });

  test('never returns negative', () => {
    const roster: ConflictInputRoster = { pokemonNames: [], pointsUsed: 110, picksLeft: 5 };
    expect(getMaxAffordableCost(roster, 110)).toBe(0);
  });
});

describe('findPickConflict', () => {
  const cap = 110;

  test('legal pick returns null', () => {
    const roster: ConflictInputRoster = { pokemonNames: ['Gengar'], pointsUsed: 10 };
    expect(findPickConflict('Garchomp', 18, roster, cap)).toBeNull();
  });

  test('duplicate species blocks (including mega vs base)', () => {
    const roster: ConflictInputRoster = { pokemonNames: ['Charizard'], pointsUsed: 18 };
    const c = findPickConflict('Mega Charizard X', 20, roster, cap);
    expect(c?.kind).toBe('duplicate-species');
    expect((c as any).conflictsWith).toBe('Charizard');
  });

  test('second mega blocks on mega-cap', () => {
    const roster: ConflictInputRoster = { pokemonNames: ['Mega Gengar'], pointsUsed: 20 };
    const c = findPickConflict('Mega Lucario', 18, roster, cap);
    expect(c?.kind).toBe('mega-cap');
    expect((c as any).conflictsWith).toBe('Mega Gengar');
  });

  test('over-budget blocks', () => {
    const roster: ConflictInputRoster = { pokemonNames: [], pointsUsed: 105 };
    const c = findPickConflict('Garchomp', 18, roster, cap);
    expect(c?.kind).toBe('over-budget');
  });

  test('roster-reserve blocks a pick that starves future slots', () => {
    // 10pt left, 3 picks remaining including this → can spend at most 8.
    const roster: ConflictInputRoster = { pokemonNames: [], pointsUsed: 100, picksLeft: 3 };
    const c = findPickConflict('Garchomp', 10, roster, cap);
    expect(c?.kind).toBe('roster-reserve');
  });

  test('exactly-affordable last pick is allowed (picksLeft=1)', () => {
    const roster: ConflictInputRoster = { pokemonNames: [], pointsUsed: 100, picksLeft: 1 };
    expect(findPickConflict('Garchomp', 10, roster, cap)).toBeNull();
  });
});

describe('findPickWarning (captain reserve — soft)', () => {
  const cap = 110;

  test('no warning when captainReserve is 0/undefined', () => {
    const roster: ConflictInputRoster = { pokemonNames: [], pointsUsed: 50 };
    expect(findPickWarning('Garchomp', 18, roster, cap)).toBeNull();
  });

  test('warns when the pick eats into the captain markup reserve', () => {
    // 110 cap, used 90, pick costs 18 → 2 left, reserve needs 6 → deficit 4.
    const roster: ConflictInputRoster = { pokemonNames: [], pointsUsed: 90, captainReserve: 6 };
    const w = findPickWarning('Garchomp', 18, roster, cap);
    expect(w?.kind).toBe('captain-reserve');
    expect((w as any).deficit).toBeGreaterThan(0);
  });
});
