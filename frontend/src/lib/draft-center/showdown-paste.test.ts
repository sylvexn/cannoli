import { describe, expect, test } from 'bun:test';
import { exportPaste, importPaste } from './showdown-paste';
import { emptySpread, type DcMon } from './types';

const garchomp: DcMon = {
  name: 'Garchomp', captain: true, teraTypes: ['steel', 'fire'],
  set: { moves: ['Earthquake', 'Swords Dance'], item: 'Rocky Helmet', ability: 'Rough Skin', nature: 'Jolly', evs: { ...emptySpread(0), atk: 252, spd: 4, spe: 252 }, ivs: { ...emptySpread(31), spa: 0 } },
};

describe('showdown paste', () => {
  test('export format', () => {
    expect(exportPaste([garchomp])).toBe(
      'Garchomp @ Rocky Helmet\nAbility: Rough Skin\nTera Type: Steel\nEVs: 252 Atk / 4 SpD / 252 Spe\nJolly Nature\nIVs: 0 SpA\n- Earthquake\n- Swords Dance');
  });

  test('round trip', () => {
    const { mons, warnings } = importPaste(exportPaste([garchomp]));
    expect(mons[0].set).toEqual(garchomp.set);
    expect(mons[0].teraTypes).toEqual(['steel']);
    expect(mons[0].captain).toBe(false);
    expect(warnings.some(w => w.includes('captain'))).toBe(true);
  });

  test('real-world paste: nicknames, gender, shiny, CRLF', () => {
    const paste = 'Landy (Landorus-Therian) (M) @ Choice Scarf  \r\nAbility: Intimidate\r\nShiny: Yes\r\nLevel: 50\r\nHappiness: 0\r\nEVs: 252 Atk / 4 Def / 252 Spe\r\nAdamant Nature\r\n- Earthquake\r\n- U-turn\r\n\r\n\r\nGengar (F)\r\n- Shadow Ball';
    const { mons } = importPaste(paste);
    expect(mons.map(m => m.name)).toEqual(['Landorus-Therian', 'Gengar']);
    expect(mons[0].set?.item).toBe('Choice Scarf');
    expect(mons[0].set?.evs.spe).toBe(252);
    expect(mons[1].set?.moves).toEqual(['Shadow Ball']);
  });

  test('megas map both ways', () => {
    const { mons } = importPaste('Charizard @ Charizardite Y\n\nAbsol-Mega\n\nCharizard-Mega-X');
    expect(mons.map(m => m.name)).toEqual(['Mega Charizard Y', 'Mega Absol', 'Mega Charizard X']);
    expect(exportPaste([{ name: 'Mega Charizard X', captain: false, teraTypes: [] }])).toBe('Charizard-Mega-X');
    expect(importPaste('Charizard @ Leftovers').mons[0].name).toBe('Charizard');
  });

  test('garbage', () => {
    expect(importPaste('').warnings).toEqual([]);
    const r = importPaste('lorem ipsum\n- dolor');
    expect(r.mons).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
