import { test, expect, describe } from 'bun:test';
import { validateTrade, pointDelta, tradePointSummary } from './trade-validation';
import type { Player, RosterPokemon } from '@/lib/types';

/**
 * Pure-logic coverage for the shared trade validator. This is the client-side
 * pre-flight that drives the inline "even swap / point cap / max 1 mega /
 * duplicate species" feedback in the trade composer and disables the Send
 * button. The backend re-verifies, but a regression here means the UI lies to
 * the user about legality.
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

  test('flags an uneven (2-for-1) swap on the count side', () => {
    const a = team('a', 'AAA', [mon('Gengar', 16), mon('Pikachu', 4)]);
    const b = team('b', 'BBB', [mon('Garchomp', 16)]);
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['Gengar', 'Pikachu']), requesting: new Set(['Garchomp']),
      pointCap: cap,
    });
    expect(issues.some(i => i.side === 'count' && /even/i.test(i.message))).toBe(true);
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
    // Even swap of equal-cost mons stays in budget → legal.
    const a = team('a', 'AAA', [mon('A4', 4), mon('AFill', 104)]);
    const b = team('b', 'BBB', [mon('B4', 4), mon('BFill', 104)]);
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['A4']), requesting: new Set(['B4']),
      pointCap: cap,
    });
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

describe('tradePointSummary', () => {
  test('computes before/after/delta/over per side for an even swap', () => {
    const a = team('a', 'AAA', [mon('Gengar', 16), mon('Pikachu', 4)]);  // before 20
    const b = team('b', 'BBB', [mon('Garchomp', 18), mon('Snorlax', 4)]); // before 22
    const s = tradePointSummary(a, b, new Set(['Gengar']), new Set(['Garchomp']), 110);
    expect(s.proposer.before).toBe(20);
    expect(s.proposer.after).toBe(22);   // -16 +18
    expect(s.proposer.delta).toBe(2);
    expect(s.proposer.over).toBe(false);
    expect(s.recipient.after).toBe(20);  // -18 +16
    expect(s.recipient.delta).toBe(-2);
  });

  test('flags over-cap on the side that breaches', () => {
    const a = team('a', 'AAA', [mon('Spare', 4), mon('Filler', 104)]); // before 108
    const b = team('b', 'BBB', [mon('Garchomp', 18)]);
    const s = tradePointSummary(a, b, new Set(['Spare']), new Set(['Garchomp']), 110);
    expect(s.proposer.after).toBe(122);
    expect(s.proposer.over).toBe(true);
  });
});
