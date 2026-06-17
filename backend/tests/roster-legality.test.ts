import { describe, expect, test } from 'bun:test';
import { validateRosterLegality, type PokeMeta } from '../src/lib/roster-legality';

const meta = new Map<string, PokeMeta>([
  ['Garchomp', { formCategory: 'base', nationalDexNumber: 445 }],
  ['Charizard', { formCategory: 'base', nationalDexNumber: 6 }],
  ['Charizard-Mega-X', { formCategory: 'mega', nationalDexNumber: 6 }],
  ['Venusaur-Mega', { formCategory: 'mega', nationalDexNumber: 3 }],
  ['Tornadus', { formCategory: 'base', nationalDexNumber: 641 }],
  ['Tornadus-Therian', { formCategory: 'base', nationalDexNumber: 641 }],
  ['Landorus', { formCategory: 'base', nationalDexNumber: 645 }],
  ['Landorus-Therian', { formCategory: 'base', nationalDexNumber: 645 }],
]);

const e = (pokemonName: string, cost: number, isTeraCaptain = false) => ({
  pokemonName,
  cost,
  isTeraCaptain,
});

describe('validateRosterLegality', () => {
  test('accepts a legal roster', () => {
    const v = validateRosterLegality(
      [e('Garchomp', 18), e('Charizard', 16)],
      meta,
      { pointCap: 110 },
    );
    expect(v).toBeNull();
  });

  test('rejects over the point cap (raw)', () => {
    const v = validateRosterLegality([e('Garchomp', 60), e('Charizard', 60)], meta, { pointCap: 110 });
    expect(v?.code).toBe('point_cap');
  });

  test('captain markup pushes a borderline roster over the cap', () => {
    // effectiveCost applies the captain markup, so a captain costs more than raw.
    const legal = validateRosterLegality([e('Garchomp', 9, false)], meta, { pointCap: 9 });
    expect(legal).toBeNull();
    const overWithCaptain = validateRosterLegality([e('Garchomp', 9, true)], meta, { pointCap: 9 });
    expect(overWithCaptain?.code).toBe('point_cap');
  });

  test('rejects >1 mega', () => {
    const v = validateRosterLegality(
      [e('Charizard-Mega-X', 20), e('Venusaur-Mega', 18)],
      meta,
      { pointCap: 110 },
    );
    expect(v?.code).toBe('mega_cap');
  });

  test('allows exactly one mega', () => {
    const v = validateRosterLegality([e('Charizard-Mega-X', 20), e('Garchomp', 18)], meta, { pointCap: 110 });
    expect(v).toBeNull();
  });

  test('rejects duplicate national-dex number (base + mega same dex)', () => {
    const v = validateRosterLegality([e('Charizard', 16), e('Charizard-Mega-X', 20)], meta, { pointCap: 110 });
    // same dex #6 -> dup_natdex (also same base species; dup_species would fire first)
    expect(v).not.toBeNull();
    expect(['dup_natdex', 'dup_species']).toContain(v?.code);
  });

  test('rejects same-species different-forme (the cross-subsystem gap)', () => {
    // Tornadus + Tornadus-Therian: same base species, this is exactly what trade/FA
    // used to permit and draft forbade.
    const v = validateRosterLegality([e('Tornadus', 14), e('Tornadus-Therian', 16)], meta, { pointCap: 110 });
    expect(v?.code).toBe('dup_species');
  });

  test('allows two genuinely different species', () => {
    const v = validateRosterLegality([e('Landorus-Therian', 20), e('Tornadus', 14)], meta, { pointCap: 110 });
    expect(v).toBeNull();
  });
});
