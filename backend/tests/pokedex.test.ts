import { describe, expect, test } from 'bun:test';
import { getBaseFormName, getFormCategory } from '../src/lib/pokedex';

describe('getFormCategory', () => {
  test('classifies megas', () => {
    expect(getFormCategory('Mega Charizard X')).toBe('mega');
    expect(getFormCategory('Mega Charizard Y')).toBe('mega');
    expect(getFormCategory('Mega Garchomp')).toBe('mega');
    expect(getFormCategory('Charizard-Mega-X')).toBe('mega');
    expect(getFormCategory('Charizard-Mega')).toBe('mega');
    expect(getFormCategory('Primal Groudon')).toBe('mega');
  });

  test('classifies regional forms', () => {
    expect(getFormCategory('Arcanine-Hisui')).toBe('regional');
    expect(getFormCategory('Tauros-Paldea-Aqua')).toBe('regional');
    expect(getFormCategory('Articuno-Galar')).toBe('regional');
    expect(getFormCategory('Ninetales-Alola')).toBe('regional');
  });

  test('classifies base forms', () => {
    expect(getFormCategory('Charizard')).toBe('base');
    expect(getFormCategory('Garchomp')).toBe('base');
    expect(getFormCategory('Pikachu')).toBe('base');
  });

  test('strips tera suffix before classifying', () => {
    expect(getFormCategory('Mega Charizard X (T)')).toBe('mega');
    expect(getFormCategory('Charizard (T)')).toBe('base');
  });
});

describe('getBaseFormName', () => {
  test('strips Mega prefix and X/Y suffix → species name', () => {
    expect(getBaseFormName('Mega Charizard X')).toBe('Charizard');
    expect(getBaseFormName('Mega Charizard Y')).toBe('Charizard');
    expect(getBaseFormName('Mega Garchomp')).toBe('Garchomp');
  });

  test('strips Charizard-Mega-X form → species name', () => {
    expect(getBaseFormName('Charizard-Mega-X')).toBe('Charizard');
    expect(getBaseFormName('Charizard-Mega-Y')).toBe('Charizard');
    expect(getBaseFormName('Charizard-Mega')).toBe('Charizard');
  });

  test('regional forms keep their suffix (treated as distinct species)', () => {
    expect(getBaseFormName('Tauros-Paldea-Aqua')).toBe('Tauros-Paldea-Aqua');
    expect(getBaseFormName('Articuno-Galar')).toBe('Articuno-Galar');
  });

  test('base species names pass through', () => {
    expect(getBaseFormName('Charizard')).toBe('Charizard');
    expect(getBaseFormName('Garchomp')).toBe('Garchomp');
  });

  test('cosmetic suffixes (Therian, Crowned) collapse to base', () => {
    expect(getBaseFormName('Tornadus-Therian')).toBe('Tornadus');
    expect(getBaseFormName('Zacian-Crowned')).toBe('Zacian');
  });

  test('two megas of the same species collide', () => {
    // This is the rule we enforce in validatePick:
    expect(getBaseFormName('Mega Charizard X')).toBe(getBaseFormName('Mega Charizard Y'));
    expect(getBaseFormName('Mega Charizard X')).toBe(getBaseFormName('Charizard'));
  });
});
