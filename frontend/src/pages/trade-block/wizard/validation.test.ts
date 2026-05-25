import { test, expect, describe } from 'bun:test';
import { validateTrade, pointDelta } from './validation';
import type { Player, RosterPokemon } from '@/lib/types';

/**
 * Pure-logic coverage for the shared trade validator. This is the client-side
 * pre-flight that drives the inline "would exceed point cap / max 1 mega /
 * duplicate species" feedback in both the quick-propose dialog and the trade
 * wizard, and disables the Send button. The backend re-verifies, but a
 * regression here means the UI lies to the user about legality.
 *
 * NOTE: trade-block/trade-propose-dialog.tsx currently ships its OWN private
 * copy of validateTrade rather than importing this module (see code-quality
 * findings). These tests pin the canonical shared implementation; if the
 * dialog's copy drifts, that's the bug to fix.
 *
 * Run: `bun test` from frontend/.
 */

function mon(name: string, tier: number): RosterPokemon {
  return {
    name,
    types: [],
    tier,
    isTeraCaptain: false,
    stats: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    abilities: [],
    seasonStats: { kills: 0, deaths: 0, gp: 0 },
  };
}

function team(id: string, abbrev: string, roster: RosterPokemon[]): Player {
  return {
    id,
    name: id,
    teamName: id,
    teamAbbrev: abbrev,
    teamColor: '#fff',
    record: { wins: 0, losses: 0, differential: 0 },
    roster,
  };
}

describe('validateTrade', () => {
  const cap = 110;

  test('empty selection on either side is treated as not-yet-legal (no issues)', () => {
    const a = team('a', 'AAA', [mon('Gengar', 16)]);
    const b = team('b', 'BBB', [mon('Garchomp', 18)]);
    expect(validateTrade({ proposer: a, recipient: b, offering: new Set(), requesting: new Set(['Garchomp']), pointCap: cap })).toEqual([]);
    expect(validateTrade({ proposer: a, recipient: b, offering: new Set(['Gengar']), requesting: new Set(), pointCap: cap })).toEqual([]);
  });

  test('an even, in-budget swap is legal', () => {
    const a = team('a', 'AAA', [mon('Gengar', 16), mon('Pikachu', 4)]);
    const b = team('b', 'BBB', [mon('Garchomp', 16), mon('Snorlax', 4)]);
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['Gengar']), requesting: new Set(['Garchomp']),
      pointCap: cap,
    });
    expect(issues).toEqual([]);
  });

  test('flags a side that would exceed the point cap', () => {
    // proposer already at 108, gives away a 4pt and receives a 18pt → 122 > 110.
    const a = team('a', 'AAA', [mon('Spare', 4), mon('Filler', 104)]);
    const b = team('b', 'BBB', [mon('Garchomp', 18)]);
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['Spare']), requesting: new Set(['Garchomp']),
      pointCap: cap,
    });
    expect(issues.some(i => i.side === 'offering' && /point cap/i.test(i.message))).toBe(true);
  });

  test('flags a side that would hold 2 megas', () => {
    const a = team('a', 'AAA', [mon('Mega Gengar', 20)]);
    const b = team('b', 'BBB', [mon('Mega Lucario', 18)]);
    // a offers nothing of its mega and requests b's mega → a ends with 2 megas.
    const a2 = team('a', 'AAA', [mon('Mega Gengar', 20), mon('Trade Bait', 4)]);
    const issues = validateTrade({
      proposer: a2, recipient: b,
      offering: new Set(['Trade Bait']), requesting: new Set(['Mega Lucario']),
      pointCap: cap,
    });
    expect(issues.some(i => i.side === 'offering' && /mega/i.test(i.message))).toBe(true);
  });

  test('flags a duplicate species post-trade (mega vs base of same dex)', () => {
    const a = team('a', 'AAA', [mon('Charizard', 18), mon('Trade Bait', 4)]);
    const b = team('b', 'BBB', [mon('Mega Charizard X', 22)]);
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['Trade Bait']), requesting: new Set(['Mega Charizard X']),
      pointCap: cap,
    });
    expect(issues.some(i => i.side === 'offering' && /duplicate species/i.test(i.message))).toBe(true);
  });

  test('reports issues per affected side independently', () => {
    // Both teams overload: each receives a heavy mon while at the cap.
    const a = team('a', 'AAA', [mon('A4', 4), mon('AFill', 104)]);
    const b = team('b', 'BBB', [mon('B4', 4), mon('BFill', 104)]);
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['A4']), requesting: new Set(['B4']),
      pointCap: cap,
    });
    // Even swap of equal-cost mons stays in budget → legal.
    expect(issues).toEqual([]);
  });
});

describe('pointDelta', () => {
  test('sums tier costs of the named subset', () => {
    const a = team('a', 'AAA', [mon('Gengar', 16), mon('Pikachu', 4), mon('Snorlax', 8)]);
    expect(pointDelta(a, new Set(['Gengar', 'Snorlax']))).toBe(24);
    expect(pointDelta(a, new Set())).toBe(0);
    expect(pointDelta(a, new Set(['Nonexistent']))).toBe(0);
  });
});
