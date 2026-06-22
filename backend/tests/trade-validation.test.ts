/**
 * Cross-cutting season-stress tests for trade roster validation
 * (routes/trades.ts → validateProposedTrade, exercised through the
 * /trades/propose endpoint).
 *
 * Focus areas (scope #1):
 *   - combined roster legality on a MULTI-Pokemon trade: point cap +
 *     max-1-mega + no-duplicate-National-Dex are all checked together
 *   - weekly trade-deadline enforcement at propose time
 *   - phase gate (regular-only)
 *
 * ── Approach ───────────────────────────────────────────────────────────────
 * validateProposedTrade is NOT exported, so we drive it through the real
 * Elysia route group. We mount tradeRoutes behind a .derive() that injects a
 * staff `user` so authorization passes, then hand-craft fixtures with a unique
 * id prefix and tear them down explicitly afterward (the route's internal
 * tx()/SAVEPOINT does not compose cleanly with a test-held BEGIN across an
 * await, so we clean up by id instead of relying on ROLLBACK).
 *
 * Skips cleanly if the seeded regular-phase league is absent.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { db, schema } from '../src/db';
import { eq, like, inArray } from 'drizzle-orm';
import { tradeRoutes } from '../src/routes/trades';

const PFX = 'ttrade-';

// Staff user so the propose handler's authorization + body.proposerId override path works.
const STAFF = { id: '1', username: 'tester', role: 'admin' as const };

function makeApp() {
  return new Elysia()
    .derive(() => ({ user: STAFF, sessionToken: 'test-session' }))
    .use(tradeRoutes);
}

async function propose(leagueId: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await makeApp().handle(new Request(`http://localhost/api/leagues/${leagueId}/trades/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Find a regular-phase league whose deadline hasn't passed (currentWeek < tradeDeadlineWeek). */
function pickRegularLeague(): { id: string; seasonId: number } | null {
  const rows = db.select().from(schema.leagues).where(eq(schema.leagues.phase, 'regular')).all();
  for (const l of rows) {
    if (l.tradeDeadlineWeek <= 0 || l.currentWeek < l.tradeDeadlineWeek) {
      return { id: l.id, seasonId: l.seasonId };
    }
  }
  return null;
}

const host = pickRegularLeague();
// Effective roster band floor for the host league (NULL band → rosterSize).
// Tests pad rosters to this size so the band minimum is satisfied and the
// trade keeps each side within [effMin, effMax].
const HOST_ROSTER = host
  ? (db.select().from(schema.leagues).where(eq(schema.leagues.id, host.id)).get()?.rosterSize ?? 10)
  : 10;

// ── Fixture lifecycle: every test uses the PFX teams/mons; tear them all down
//    after each test so we never pollute the seeded DB.
function cleanupFixtures() {
  // Delete any trades involving the fixture teams first (FK to teams).
  const teamIds = db.select().from(schema.teams).where(like(schema.teams.id, `${PFX}%`)).all().map(t => t.id);
  if (teamIds.length) {
    db.delete(schema.trades).where(inArray(schema.trades.proposerId, teamIds)).run();
    db.delete(schema.tradeBlockListings).where(inArray(schema.tradeBlockListings.teamId, teamIds)).run();
    db.delete(schema.rosters).where(inArray(schema.rosters.teamId, teamIds)).run();
  }
  db.delete(schema.teams).where(like(schema.teams.id, `${PFX}%`)).run();
  db.delete(schema.pokemon).where(like(schema.pokemon.name, `${PFX}%`)).run();
  // Activity-log rows reference leagueId only (no FK to teams), harmless to leave,
  // but trim the fixture trade-proposed entries by description prefix would be brittle.
}

afterEach(() => cleanupFixtures());

// Inert filler: cost-0, base-form, unique National-Dex mons used to pad a
// roster up to the league's roster band minimum so the OTHER validators
// (point cap / mega / dup-dex) are the thing under test, not the band floor.
// (Before the roster band feature these tests ran on tiny rosters; now every
// post-trade roster must hold >= effMin mons.)
let fillerDex = 9990000;
function padRoster(teamId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const name = `${PFX}pad-${teamId}-${i}`;
    const dex = fillerDex++;
    ensurePokemon(name, { tier: 0, dex });
    db.insert(schema.rosters).values({
      teamId, pokemonName: name, tier: 0, costAtDraft: 0,
      isTeraCaptain: false, acquiredVia: 'draft',
    }).run();
  }
}

function seedTeams(leagueId: string, opts: {
  proposerMons: { name: string; cost: number; isCaptain?: boolean }[];
  recipientMons: { name: string; cost: number; isCaptain?: boolean }[];
  // Pad BOTH rosters with inert cost-0 fillers up to this size so the roster
  // band minimum is satisfied. Leave undefined to seed exactly the given mons.
  padTo?: number;
}) {
  const teamA = `${PFX}A`;
  const teamB = `${PFX}B`;
  db.insert(schema.teams).values([
    { id: teamA, leagueId, coachName: 'PA', teamName: 'Prop A', teamAbbrev: 'PA', teamColor: '#111111' },
    { id: teamB, leagueId, coachName: 'RB', teamName: 'Rec B', teamAbbrev: 'RB', teamColor: '#222222' },
  ]).run();
  for (const m of opts.proposerMons) {
    db.insert(schema.rosters).values({
      teamId: teamA, pokemonName: m.name, tier: m.cost, costAtDraft: m.cost,
      isTeraCaptain: m.isCaptain ?? false, acquiredVia: 'draft',
    }).run();
  }
  for (const m of opts.recipientMons) {
    db.insert(schema.rosters).values({
      teamId: teamB, pokemonName: m.name, tier: m.cost, costAtDraft: m.cost,
      isTeraCaptain: m.isCaptain ?? false, acquiredVia: 'draft',
    }).run();
  }
  if (opts.padTo != null) {
    padRoster(teamA, Math.max(0, opts.padTo - opts.proposerMons.length));
    padRoster(teamB, Math.max(0, opts.padTo - opts.recipientMons.length));
  }
  return { teamA, teamB };
}

function ensurePokemon(name: string, opts: { tier?: number; dex?: number | null; form?: 'base' | 'mega' | 'regional' | 'other' }) {
  db.insert(schema.pokemon).values({
    name, tier: opts.tier ?? 1,
    type1: 'Normal',
    hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100,
    nationalDexNumber: opts.dex ?? null,
    formCategory: opts.form ?? 'base',
  }).run();
}

describe('trade validation — combined roster legality (multi-Pokemon)', () => {
  if (!host) {
    test.skip('no regular-phase league with open deadline — skipping', () => {});
    return;
  }

  test('valid equal-count multi-mon swap is accepted', async () => {
    ensurePokemon(`${PFX}p1`, { tier: 5, dex: 9001 });
    ensurePokemon(`${PFX}p2`, { tier: 4, dex: 9002 });
    ensurePokemon(`${PFX}r1`, { tier: 5, dex: 9003 });
    ensurePokemon(`${PFX}r2`, { tier: 4, dex: 9004 });
    const { teamA, teamB } = seedTeams(host.id, {
      proposerMons: [{ name: `${PFX}p1`, cost: 5 }, { name: `${PFX}p2`, cost: 4 }],
      recipientMons: [{ name: `${PFX}r1`, cost: 5 }, { name: `${PFX}r2`, cost: 4 }],
      padTo: HOST_ROSTER,
    });
    const { status, json } = await propose(host.id, {
      proposerId: teamA, recipientId: teamB,
      offering: [`${PFX}p1`, `${PFX}p2`], requesting: [`${PFX}r1`, `${PFX}r2`],
    });
    expect(status).toBe(200);
    expect(json.id).toBeDefined();
  });

  test('rejects when post-trade roster would exceed point cap', async () => {
    const cap = db.select().from(schema.seasons).where(eq(schema.seasons.id, host.seasonId)).get()?.pointCap ?? 110;
    ensurePokemon(`${PFX}cheap`, { tier: 1, dex: 9101 });
    ensurePokemon(`${PFX}huge`, { tier: cap + 50, dex: 9102 });
    const fillers: { name: string; cost: number }[] = [];
    for (let i = 0; i < 5; i++) { ensurePokemon(`${PFX}f${i}`, { tier: 20, dex: 9200 + i }); fillers.push({ name: `${PFX}f${i}`, cost: 20 }); }
    const { teamA, teamB } = seedTeams(host.id, {
      proposerMons: [{ name: `${PFX}cheap`, cost: 1 }, ...fillers],   // 1 + 100 = 101
      recipientMons: [{ name: `${PFX}huge`, cost: cap + 50 }],
      padTo: HOST_ROSTER,
    });
    const { status, json } = await propose(host.id, {
      proposerId: teamA, recipientId: teamB,
      offering: [`${PFX}cheap`], requesting: [`${PFX}huge`],
    });
    expect(status).toBe(400);
    expect(json.code).toBe('TRADE_INVALID');
    expect(json.error).toMatch(/point cap/i);
  });

  test('rejects when post-trade roster would have 2 megas', async () => {
    ensurePokemon(`${PFX}mega1`, { tier: 10, dex: 9301, form: 'mega' });
    ensurePokemon(`${PFX}mega2`, { tier: 10, dex: 9302, form: 'mega' });
    ensurePokemon(`${PFX}plain`, { tier: 10, dex: 9303, form: 'base' });
    const { teamA, teamB } = seedTeams(host.id, {
      proposerMons: [{ name: `${PFX}mega1`, cost: 10 }, { name: `${PFX}plain`, cost: 10 }],
      recipientMons: [{ name: `${PFX}mega2`, cost: 10 }],
      padTo: HOST_ROSTER,
    });
    const { status, json } = await propose(host.id, {
      proposerId: teamA, recipientId: teamB,
      offering: [`${PFX}plain`], requesting: [`${PFX}mega2`],
    });
    expect(status).toBe(400);
    expect(json.code).toBe('TRADE_INVALID');
    expect(json.error).toMatch(/mega/i);
  });

  test('rejects when post-trade roster would have a duplicate National Dex number', async () => {
    ensurePokemon(`${PFX}dexA`, { tier: 8, dex: 9400 });
    ensurePokemon(`${PFX}dexA_alt`, { tier: 8, dex: 9400 }); // same dex#
    ensurePokemon(`${PFX}give`, { tier: 8, dex: 9401 });
    const { teamA, teamB } = seedTeams(host.id, {
      proposerMons: [{ name: `${PFX}dexA`, cost: 8 }, { name: `${PFX}give`, cost: 8 }],
      recipientMons: [{ name: `${PFX}dexA_alt`, cost: 8 }],
      padTo: HOST_ROSTER,
    });
    const { status, json } = await propose(host.id, {
      proposerId: teamA, recipientId: teamB,
      offering: [`${PFX}give`], requesting: [`${PFX}dexA_alt`],
    });
    expect(status).toBe(400);
    expect(json.code).toBe('TRADE_INVALID');
    expect(json.error).toMatch(/dex/i);
  });

  // Uneven (N-for-M) trades are now ALLOWED as long as BOTH post-trade rosters
  // stay within the league roster band [minRosterSize, maxRosterSize]. We set a
  // band of 9–11 on the host for this test (restored afterward).
  test('accepts uneven (2-for-1) trade when both rosters stay within the band', async () => {
    const saved = db.select().from(schema.leagues).where(eq(schema.leagues.id, host.id)).get()!;
    try {
      db.update(schema.leagues)
        .set({ minRosterSize: 9, maxRosterSize: 11 })
        .where(eq(schema.leagues.id, host.id)).run();
      ensurePokemon(`${PFX}o1`, { tier: 5, dex: 9501 });
      ensurePokemon(`${PFX}o2`, { tier: 5, dex: 9502 });
      ensurePokemon(`${PFX}q1`, { tier: 5, dex: 9503 });
      // Both start at 10. Proposer gives 2 / gets 1 → 9 (>= min 9). Recipient
      // gives 1 / gets 2 → 11 (<= max 11).
      const { teamA, teamB } = seedTeams(host.id, {
        proposerMons: [{ name: `${PFX}o1`, cost: 5 }, { name: `${PFX}o2`, cost: 5 }],
        recipientMons: [{ name: `${PFX}q1`, cost: 5 }],
        padTo: 10,
      });
      const { status, json } = await propose(host.id, {
        proposerId: teamA, recipientId: teamB,
        offering: [`${PFX}o1`, `${PFX}o2`], requesting: [`${PFX}q1`],
      });
      expect(status).toBe(200);
      expect(json.id).toBeDefined();
    } finally {
      db.update(schema.leagues)
        .set({ minRosterSize: saved.minRosterSize, maxRosterSize: saved.maxRosterSize })
        .where(eq(schema.leagues.id, host.id)).run();
    }
  });

  // The roster band floor is enforced: an uneven trade that would push a side
  // below minRosterSize is rejected.
  test('rejects trade that would drop a roster below the band minimum', async () => {
    const saved = db.select().from(schema.leagues).where(eq(schema.leagues.id, host.id)).get()!;
    try {
      db.update(schema.leagues)
        .set({ minRosterSize: 10, maxRosterSize: 12 })
        .where(eq(schema.leagues.id, host.id)).run();
      ensurePokemon(`${PFX}o1`, { tier: 5, dex: 9501 });
      ensurePokemon(`${PFX}o2`, { tier: 5, dex: 9502 });
      ensurePokemon(`${PFX}q1`, { tier: 5, dex: 9503 });
      // Proposer at 10 gives 2 / gets 1 → 9 (< min 10) → rejected.
      const { teamA, teamB } = seedTeams(host.id, {
        proposerMons: [{ name: `${PFX}o1`, cost: 5 }, { name: `${PFX}o2`, cost: 5 }],
        recipientMons: [{ name: `${PFX}q1`, cost: 5 }],
        padTo: 10,
      });
      const { status, json } = await propose(host.id, {
        proposerId: teamA, recipientId: teamB,
        offering: [`${PFX}o1`, `${PFX}o2`], requesting: [`${PFX}q1`],
      });
      expect(status).toBe(400);
      expect(json.code).toBe('TRADE_INVALID');
      expect(json.error).toMatch(/min 10/i);
    } finally {
      db.update(schema.leagues)
        .set({ minRosterSize: saved.minRosterSize, maxRosterSize: saved.maxRosterSize })
        .where(eq(schema.leagues.id, host.id)).run();
    }
  });
});

describe('trade validation — captain markup point-cap accounting', () => {
  if (!host) {
    test.skip('no regular-phase league with open deadline — skipping', () => {});
    return;
  }

  // TRADE-CAP-CAPTAIN (FIXED): validateProposedTrade now applies effectiveCost()
  // for RETAINED tera-captains when summing the post-trade roster (only the
  // TRADED mons lose captain status). A roster that was only "legal" because raw
  // cost ignored the +markup is correctly rejected.
  test('rejects trade that fits raw cost but exceeds cap once retained-captain markup is applied', async () => {
    const cap = db.select().from(schema.seasons).where(eq(schema.seasons.id, host.seasonId)).get()?.pointCap ?? 110;
    ensurePokemon(`${PFX}capn1`, { tier: 9, dex: 9601 });
    ensurePokemon(`${PFX}capn2`, { tier: 9, dex: 9602 });
    ensurePokemon(`${PFX}swapout`, { tier: 1, dex: 9603 });
    ensurePokemon(`${PFX}swapin`, { tier: 1, dex: 9604 });
    const remaining = cap - 9 - 9 - 1; // raw roster total lands exactly at cap
    const fillers: { name: string; cost: number }[] = [];
    if (remaining > 0) { ensurePokemon(`${PFX}fill`, { tier: remaining, dex: 9605 }); fillers.push({ name: `${PFX}fill`, cost: remaining }); }
    const { teamA, teamB } = seedTeams(host.id, {
      proposerMons: [
        { name: `${PFX}capn1`, cost: 9, isCaptain: true },
        { name: `${PFX}capn2`, cost: 9, isCaptain: true },
        { name: `${PFX}swapout`, cost: 1 },
        ...fillers,
      ],
      recipientMons: [{ name: `${PFX}swapin`, cost: 1 }],
      padTo: HOST_ROSTER,
    });
    const { status, json } = await propose(host.id, {
      proposerId: teamA, recipientId: teamB,
      offering: [`${PFX}swapout`], requesting: [`${PFX}swapin`],
    });
    // Desired behavior: reject because effective total (cap + markup) exceeds cap.
    expect(status).toBe(400);
    expect(json.code).toBe('TRADE_INVALID');
  });
});

describe('trade deadline + phase enforcement at propose time', () => {
  test('rejects propose when league phase is not regular', async () => {
    // Pick a non-regular league whose season is NOT archived (an archived
    // season short-circuits to a 409 season_archived before the phase gate).
    const leagues = db.select().from(schema.leagues).all();
    let nonReg: typeof leagues[number] | undefined;
    for (const l of leagues) {
      if (l.phase === 'regular') continue;
      const s = db.select().from(schema.seasons).where(eq(schema.seasons.id, l.seasonId)).get();
      if (s && !(s as any).archived) { nonReg = l; break; }
    }
    if (!nonReg) { expect(true).toBe(true); return; }
    ensurePokemon(`${PFX}x1`, { tier: 5, dex: 9701 });
    ensurePokemon(`${PFX}x2`, { tier: 5, dex: 9702 });
    const { teamA, teamB } = seedTeams(nonReg.id, {
      proposerMons: [{ name: `${PFX}x1`, cost: 5 }],
      recipientMons: [{ name: `${PFX}x2`, cost: 5 }],
    });
    const { status, json } = await propose(nonReg.id, {
      proposerId: teamA, recipientId: teamB,
      offering: [`${PFX}x1`], requesting: [`${PFX}x2`],
    });
    expect(status).toBe(409);
    expect(json.code).toBe('TRADE_WRONG_PHASE');
  });

  test('rejects propose when trade deadline has passed (currentWeek >= deadline)', async () => {
    if (!host) { expect(true).toBe(true); return; }
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, host.id)).get()!;
    const savedWeek = league.currentWeek;
    try {
      db.update(schema.leagues)
        .set({ currentWeek: Math.max(league.tradeDeadlineWeek, 1) })
        .where(eq(schema.leagues.id, host.id)).run();
      ensurePokemon(`${PFX}d1`, { tier: 5, dex: 9801 });
      ensurePokemon(`${PFX}d2`, { tier: 5, dex: 9802 });
      const { teamA, teamB } = seedTeams(host.id, {
        proposerMons: [{ name: `${PFX}d1`, cost: 5 }],
        recipientMons: [{ name: `${PFX}d2`, cost: 5 }],
      });
      const { status, json } = await propose(host.id, {
        proposerId: teamA, recipientId: teamB,
        offering: [`${PFX}d1`], requesting: [`${PFX}d2`],
      });
      expect(status).toBe(400);
      expect(json.code).toBe('TRADE_DEADLINE_PASSED');
    } finally {
      db.update(schema.leagues).set({ currentWeek: savedWeek }).where(eq(schema.leagues.id, host.id)).run();
    }
  });
});
