/**
 * Scheduled (future-week) trade application.
 *
 * The bug: `effective_week` used to be a LABEL only — approving a trade during
 * week 6 "for week 7" stamped the ledger W7 but moved the Pokemon immediately,
 * so a team's week-6 roster changed mid-week (reported in-app 2026-07-24).
 *
 * The contract now under test:
 *   1. approve with no explicit week   → defaults to currentWeek + 1
 *   2. a future effective week         → rosters UNCHANGED, applied_at NULL
 *   3. league reaches that week        → applyDueTransactions() runs the swap
 *   4. the sweep is idempotent         → a second call is a no-op
 *   5. explicit effectiveWeek = now    → applies immediately (admin escape hatch)
 *   6. a scheduled trade that went illegal → cancelled, not silently applied
 *
 * Fixtures use a unique id prefix and are torn down explicitly (the route's
 * internal tx()/SAVEPOINT does not compose with a test-held BEGIN across an
 * await), mirroring tests/trade-validation.test.ts.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { db, schema } from '../src/db';
import { eq, and, like, inArray } from 'drizzle-orm';
import { tradeRoutes } from '../src/routes/trades';
import { applyDueTransactions, resolveEffectiveWeek } from '../src/lib/scheduled-transactions';

const PFX = 'tsched-';
const STAFF = { id: '1', username: 'tester', role: 'admin' as const };

function makeApp() {
  return new Elysia()
    .derive(() => ({ user: STAFF, sessionToken: 'test-session' }))
    .use(tradeRoutes);
}

async function post(path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await makeApp().handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }));
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** A regular-phase league with at least two weeks of trading room left. */
function pickHostLeague() {
  const rows = db.select().from(schema.leagues).where(eq(schema.leagues.phase, 'regular')).all();
  for (const l of rows) {
    if (l.tradeDeadlineWeek <= 0 || l.currentWeek + 1 < l.tradeDeadlineWeek) return l;
  }
  return null;
}

const host = pickHostLeague();
const HOST_ROSTER = host?.rosterSize ?? 10;
const START_WEEK = host?.currentWeek ?? 1;

function cleanupFixtures() {
  const teamIds = db.select().from(schema.teams).where(like(schema.teams.id, `${PFX}%`)).all().map(t => t.id);
  if (teamIds.length) {
    db.delete(schema.trades).where(inArray(schema.trades.proposerId, teamIds)).run();
    db.delete(schema.transactions).where(inArray(schema.transactions.teamId, teamIds)).run();
    db.delete(schema.tradeBlockListings).where(inArray(schema.tradeBlockListings.teamId, teamIds)).run();
    db.delete(schema.rosters).where(inArray(schema.rosters.teamId, teamIds)).run();
  }
  db.delete(schema.teams).where(like(schema.teams.id, `${PFX}%`)).run();
  db.delete(schema.pokemon).where(like(schema.pokemon.name, `${PFX}%`)).run();
  // Always restore the league's week pointer — tests move it forward.
  if (host) {
    db.update(schema.leagues).set({ currentWeek: START_WEEK }).where(eq(schema.leagues.id, host.id)).run();
  }
}

afterEach(() => cleanupFixtures());

let fillerDex = 9970000;
function ensurePokemon(name: string, tier: number) {
  db.insert(schema.pokemon).values({
    name, tier, type1: 'Normal',
    hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100,
    nationalDexNumber: fillerDex++, formCategory: 'base',
  }).run();
}

/** Two teams, one tradeable cost-1 mon each, padded to the roster band floor. */
function seedTeams(leagueId: string) {
  const teamA = `${PFX}A`;
  const teamB = `${PFX}B`;
  db.insert(schema.teams).values([
    { id: teamA, leagueId, coachName: 'PA', teamName: 'Prop A', teamAbbrev: 'PA', teamColor: '#111111' },
    { id: teamB, leagueId, coachName: 'RB', teamName: 'Rec B', teamAbbrev: 'RB', teamColor: '#222222' },
  ]).run();
  for (const [team, mon] of [[teamA, `${PFX}mon-a`], [teamB, `${PFX}mon-b`]] as const) {
    ensurePokemon(mon, 1);
    db.insert(schema.rosters).values({
      teamId: team, pokemonName: mon, tier: 1, costAtDraft: 1,
      isTeraCaptain: false, acquiredVia: 'draft',
    }).run();
    for (let i = 1; i < HOST_ROSTER; i++) {
      const pad = `${PFX}pad-${team}-${i}`;
      ensurePokemon(pad, 0);
      db.insert(schema.rosters).values({
        teamId: team, pokemonName: pad, tier: 0, costAtDraft: 0,
        isTeraCaptain: false, acquiredVia: 'draft',
      }).run();
    }
  }
  return { teamA, teamB, monA: `${PFX}mon-a`, monB: `${PFX}mon-b` };
}

/** Propose + counterparty-accept so the trade is ready for admin approval. */
async function proposeAndAccept(leagueId: string, teamA: string, teamB: string, monA: string, monB: string) {
  const proposed = await post(`/api/leagues/${leagueId}/trades/propose`, {
    proposerId: teamA, recipientId: teamB, offering: [monA], requesting: [monB],
  });
  expect(proposed.status).toBe(200);
  const accepted = await post(`/api/trades/${proposed.json.id}/respond`, { action: 'accept' });
  expect(accepted.status).toBe(200);
  return Number(proposed.json.id);
}

const ownerOf = (mon: string) =>
  db.select().from(schema.rosters).where(eq(schema.rosters.pokemonName, mon)).get()?.teamId;

const tradeRow = (id: number) =>
  db.select().from(schema.trades).where(eq(schema.trades.id, id)).get();

const setWeek = (leagueId: string, week: number) =>
  db.update(schema.leagues).set({ currentWeek: week }).where(eq(schema.leagues.id, leagueId)).run();

describe('resolveEffectiveWeek', () => {
  const league = { currentWeek: 6, totalWeeks: 11 } as any;

  test('defaults to the week after the current one', () => {
    expect(resolveEffectiveWeek({ league, fallbackWeek: 6 })).toBe(7);
  });

  test('honours an explicit future week', () => {
    expect(resolveEffectiveWeek({ requested: 9, league, fallbackWeek: 6 })).toBe(9);
  });

  test('clamps a past week up to the current one — never rewrites history', () => {
    expect(resolveEffectiveWeek({ requested: 2, league, fallbackWeek: 6 })).toBe(6);
    expect(resolveEffectiveWeek({ requested: -5, league, fallbackWeek: 6 })).toBe(6);
  });

  test('clamps past the end of the season', () => {
    expect(resolveEffectiveWeek({ requested: 99, league, fallbackWeek: 6 })).toBe(11);
  });
});

describe('scheduled trade application', () => {
  if (!host) {
    test.skip('no regular-phase league with two weeks of trading room — skipping', () => {});
    return;
  }

  test('approval defaults to next week and does NOT touch rosters yet', async () => {
    const { teamA, teamB, monA, monB } = seedTeams(host.id);
    const tradeId = await proposeAndAccept(host.id, teamA, teamB, monA, monB);

    const { status, json } = await post(`/api/trades/${tradeId}/approve`);
    expect(status).toBe(200);
    expect(json.effectiveWeek).toBe(START_WEEK + 1);
    expect(json.scheduled).toBe(true);

    // The reported bug: this used to already be swapped.
    expect(ownerOf(monA)).toBe(teamA);
    expect(ownerOf(monB)).toBe(teamB);

    const row = tradeRow(tradeId)!;
    expect(row.status).toBe('accepted');
    expect(row.appliedAt).toBeNull();

    // …and no ledger row exists yet either.
    const ledger = db.select().from(schema.transactions)
      .where(and(eq(schema.transactions.teamId, teamA), eq(schema.transactions.type, 'trade'))).all();
    expect(ledger.length).toBe(0);
  });

  test('the swap runs once the league reaches the effective week, and only once', async () => {
    const { teamA, teamB, monA, monB } = seedTeams(host.id);
    const tradeId = await proposeAndAccept(host.id, teamA, teamB, monA, monB);
    await post(`/api/trades/${tradeId}/approve`);

    // Still the old week → nothing due.
    expect(applyDueTransactions(host.id)).toBe(0);
    expect(ownerOf(monA)).toBe(teamA);

    setWeek(host.id, START_WEEK + 1);
    expect(applyDueTransactions(host.id)).toBe(1);

    expect(ownerOf(monA)).toBe(teamB);
    expect(ownerOf(monB)).toBe(teamA);
    expect(tradeRow(tradeId)!.appliedAt).not.toBeNull();

    // Ledger stamped with the effective week, not the approval week.
    const ledger = db.select().from(schema.transactions)
      .where(and(eq(schema.transactions.teamId, teamA), eq(schema.transactions.type, 'trade'))).all();
    expect(ledger.length).toBe(1);
    expect(ledger[0].week).toBe(START_WEEK + 1);

    // Idempotent: a second sweep must not double-apply.
    expect(applyDueTransactions(host.id)).toBe(0);
    expect(ownerOf(monA)).toBe(teamB);
  });

  test('an explicit current week still applies immediately (admin escape hatch)', async () => {
    const { teamA, teamB, monA, monB } = seedTeams(host.id);
    const tradeId = await proposeAndAccept(host.id, teamA, teamB, monA, monB);

    const { json } = await post(`/api/trades/${tradeId}/approve`, { effectiveWeek: START_WEEK });
    expect(json.scheduled).toBe(false);
    expect(ownerOf(monA)).toBe(teamB);
    expect(tradeRow(tradeId)!.appliedAt).not.toBeNull();
  });

  test('a scheduled trade whose Pokemon moved away is cancelled, not applied', async () => {
    const { teamA, teamB, monA, monB } = seedTeams(host.id);
    const tradeId = await proposeAndAccept(host.id, teamA, teamB, monA, monB);
    await post(`/api/trades/${tradeId}/approve`);

    // Something else takes monA off teamA before the week arrives.
    const outsider = `${PFX}C`;
    db.insert(schema.teams).values({
      id: outsider, leagueId: host.id, coachName: 'CC', teamName: 'Out C', teamAbbrev: 'CC', teamColor: '#333333',
    }).run();
    db.update(schema.rosters).set({ teamId: outsider })
      .where(and(eq(schema.rosters.teamId, teamA), eq(schema.rosters.pokemonName, monA))).run();

    setWeek(host.id, START_WEEK + 1);
    expect(applyDueTransactions(host.id)).toBe(0);

    const row = tradeRow(tradeId)!;
    expect(row.status).toBe('rejected');
    expect(row.rejectReason).toContain('Auto-apply failed');
    expect(row.appliedAt).toBeNull();
    // monB never left teamB.
    expect(ownerOf(monB)).toBe(teamB);
  });
});
