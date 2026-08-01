import { test, expect, describe } from 'bun:test';
import {
  validateTrade, pointDelta, tradePointSummary,
  isTradeDeadlinePassed,
} from './trade-validation';
import type { Player, RosterPokemon } from '@/lib/types';

/**
 * Pure-logic coverage for the shared trade validator. This is the client-side
 * pre-flight that drives the inline "point cap / max 1 mega / duplicate species"
 * feedback in the trade composer and disables the Send button. The backend
 * re-verifies, but a regression here means the UI lies to the user about legality.
 *
 * Unequal (N-for-M) trades are now legal as long as both resulting rosters pass
 * all other invariants (point cap, mega cap, no natdex dupes, roster size).
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

  test('allows an unequal (2-for-1) swap when both rosters stay legal', () => {
    // a gives Gengar(16) + Pikachu(4) = 20pt for Garchomp(16).
    // postA: [Garchomp=16] → 16 ≤ 110. postB: [Gengar=16, Pikachu=4] → 20 ≤ 110.
    const a = team('a', 'AAA', [mon('Gengar', 16), mon('Pikachu', 4)]);
    const b = team('b', 'BBB', [mon('Garchomp', 16)]);
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['Gengar', 'Pikachu']), requesting: new Set(['Garchomp']),
      pointCap: cap,
    });
    expect(issues).toEqual([]);
  });

  test('flags a roster-size violation on a 1-for-2 when recipient would exceed cap', () => {
    const a = team('a', 'AAA', [mon('Gengar', 16)]);
    const b = team('b', 'BBB', [mon('A', 4), mon('B', 4), mon('C', 4)]);
    // a gives 1, gets 2 → postA has 2 mons, postB has 2 mons. With maxRosterSize=2 → postB=2, ok.
    // With maxRosterSize=1 → postA=2 > 1, should flag.
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['Gengar']), requesting: new Set(['A', 'B']),
      pointCap: cap,
      maxRosterSize: 1,
    });
    expect(issues.some(i => /max/i.test(i.message))).toBe(true);
  });

  test('flags a side that would fall below the roster minimum', () => {
    // a gives 2, gets 1 → postA has 1 mon. With minRosterSize=2 → postA=1 < 2, flag.
    const a = team('a', 'AAA', [mon('Gengar', 8), mon('Spare', 4)]);
    const b = team('b', 'BBB', [mon('Garchomp', 8)]);
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['Gengar', 'Spare']), requesting: new Set(['Garchomp']),
      pointCap: cap,
      minRosterSize: 2,
    });
    expect(issues.some(i => /min/i.test(i.message))).toBe(true);
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

describe('tera captain markup', () => {
  // A captain's slot costs the marked-up price (tier 8 → 10), same as the
  // backend's effectiveCost. Before this was mirrored, the composer said
  // "both rosters legal" at 107/110 while the API rejected the same trade at
  // 111 > 110.
  test('counts a captain at its marked-up cost against the cap', () => {
    const cap = 110;
    const captain = { ...mon('Kingambit', 8), isTeraCaptain: true }; // 8 → 10
    const a = team('a', 'AAA', [captain, mon('Filler', 98), mon('Bait', 2)]);
    const b = team('b', 'BBB', [mon('Latios', 4)]);
    // raw tiers: 8+98+2 = 108, swap Bait(2)→Latios(4) = 110 (looks legal)
    // effective: 10+98+2 = 110, swap = 112 > 110
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['Bait']), requesting: new Set(['Latios']),
      pointCap: cap,
    });
    expect(issues.some(i => /point cap \(112 > 110\)/.test(i.message))).toBe(true);
  });

  test('an incoming mon sheds captaincy, so it only costs base tier', () => {
    const captain = { ...mon('Kingambit', 8), isTeraCaptain: true };
    const a = team('a', 'AAA', [mon('Bait', 2)]);
    const b = team('b', 'BBB', [captain]);
    const s = tradePointSummary(a, b, new Set(['Bait']), new Set(['Kingambit']), 110);
    expect(s.recipient.before).toBe(10);  // captain marked up
    expect(s.proposer.after).toBe(8);     // arrives as a plain 8pt mon
    expect(s.recipient.after).toBe(2);
  });
});

describe('scheduled moves (pending projection)', () => {
  const cap = 110;
  // Gaffz's case: an approved FA that drops a mon on Monday night hasn't
  // applied yet, so the raw roster is 111/110 — but the trade can't land
  // before the FA does, so it must validate against the projected roster.
  const a = team('a', 'AAA', [mon('Ferrothorn', 5), mon('Filler', 103), mon('Bait', 2)]);
  const b = team('b', 'BBB', [mon('Latios', 4)]);
  const pending = {
    a: {
      moves: 1,
      outgoing: ['Ferrothorn'],
      roster: [
        { name: 'Filler', tier: 103, isTeraCaptain: false },
        { name: 'Bait', tier: 2, isTeraCaptain: false },
        { name: 'Corviknight', tier: 3, isTeraCaptain: false }, // FA pickup
      ],
    },
  };

  test('current roster blocks the trade', () => {
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['Bait']), requesting: new Set(['Latios']),
      pointCap: cap,
    });
    expect(issues.some(i => /point cap/.test(i.message))).toBe(true);
  });

  test('projected roster allows it', () => {
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['Bait']), requesting: new Set(['Latios']),
      pointCap: cap, pending,
    });
    expect(issues).toEqual([]);
    const s = tradePointSummary(a, b, new Set(['Bait']), new Set(['Latios']), cap, pending);
    expect(s.proposer.before).toBe(108);  // 103 + 2 + 3 (FA pickup), Ferrothorn dropped
    expect(s.proposer.after).toBe(110);   // -Bait(2) +Latios(4)
  });

  test('flags a mon already committed to a scheduled move', () => {
    const issues = validateTrade({
      proposer: a, recipient: b,
      offering: new Set(['Ferrothorn']), requesting: new Set(['Latios']),
      pointCap: cap, pending,
    });
    expect(issues.some(i => /committed to a scheduled move/.test(i.message))).toBe(true);
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

/**
 * Deadline gate. The league rule is "the deadline for Trades and Free Agencies
 * is Week 7", and the deadline week is INCLUSIVE — week 7 is the last week you
 * can trade, not the week trading is already over.
 *
 * These assertions are the frontend half of a cross-package invariant: the
 * backend's isTradeDeadlinePassed (lib/queries.ts, `currentWeek > deadline`)
 * must agree with this for every week, or the market UI and the API disagree
 * about who can trade.
 */
describe('trade deadline', () => {
  const DEADLINE = 7;

  test('the deadline week itself is still open', () => {
    expect(isTradeDeadlinePassed(6, DEADLINE)).toBe(false);
    expect(isTradeDeadlinePassed(7, DEADLINE)).toBe(false);
  });

  test('closes the week after the deadline', () => {
    expect(isTradeDeadlinePassed(8, DEADLINE)).toBe(true);
    expect(isTradeDeadlinePassed(9, DEADLINE)).toBe(true);
  });

  test('open in every week before that', () => {
    for (const w of [1, 2, 3, 4, 5]) {
      expect(isTradeDeadlinePassed(w, DEADLINE)).toBe(false);
    }
  });

  test('matches the backend rule `currentWeek > deadline` for every week', () => {
    for (let w = 0; w <= 20; w++) {
      expect(isTradeDeadlinePassed(w, DEADLINE)).toBe(w > DEADLINE);
    }
  });

  test('a non-positive deadline means no deadline at all', () => {
    expect(isTradeDeadlinePassed(99, 0)).toBe(false);
    expect(isTradeDeadlinePassed(99, -1)).toBe(false);
  });
});
