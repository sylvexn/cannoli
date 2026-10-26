/**
 * FA deadline vs the scheduled sweep.
 *
 * The bug (S11, 2026-08-04): pickups approved during the deadline week were
 * scheduled for deadline + 1, then the week-rollover sweep re-ran the deadline
 * gate against the NEW current week and auto-rejected all of them ("Free agent
 * deadline has passed (week 7, effective week 8)"). Trades in the same window
 * landed fine. The deadline gates when a coach acts, not when the move lands.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { applyDueTransactions } from '../src/lib/scheduled-transactions';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

const tag = `fasweep-${Date.now()}`;
const leagueId = `${tag}-lg`;
const teamId = `${tag}-T`;
const ROSTER = 4;
let seasonId: number;
let deadline: number;

const faRow = (id: number) => db.select().from(schema.faRequests).where(eq(schema.faRequests.id, id)).get()!;
const onRoster = (name: string) =>
  db.select().from(schema.rosters).where(eq(schema.rosters.pokemonName, name)).get()?.teamId;

beforeAll(() => {
  deadline = db.select().from(schema.siteSettings).get()?.faDeadlineWeek ?? 7;
  seasonId = db.insert(schema.seasons).values({
    seasonNumber: 8700 + (Date.now() % 1000), pointCap: 110, teraCaptainSlots: 2, archived: false,
  }).returning().get().id;
  db.insert(schema.leagues).values({
    id: leagueId, name: 'FA Sweep Fixture', color: '#abcdef', seasonId,
    phase: 'regular', currentWeek: deadline, rosterSize: ROSTER, draftOrder: JSON.stringify([teamId]),
  }).run();
  db.insert(schema.teams).values({ id: teamId, leagueId, coachName: 'FS', teamName: 'Sweep', teamAbbrev: 'FS' }).run();

  let dex = 9980000;
  const mon = (name: string) => db.insert(schema.pokemon).values({
    name, tier: 1, type1: 'Normal', hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100,
    nationalDexNumber: dex++, formCategory: 'base',
  }).run();
  for (let i = 0; i < ROSTER; i++) {
    mon(`${tag}-own${i}`);
    db.insert(schema.rosters).values({
      teamId, pokemonName: `${tag}-own${i}`, tier: 1, costAtDraft: 1, isTeraCaptain: false, acquiredVia: 'draft',
    }).run();
  }
  mon(`${tag}-fa`);
});

afterAll(() => {
  try {
    db.delete(schema.faRequests).where(eq(schema.faRequests.leagueId, leagueId)).run();
    db.delete(schema.transactions).where(eq(schema.transactions.leagueId, leagueId)).run();
    db.delete(schema.rosters).where(eq(schema.rosters.teamId, teamId)).run();
    db.delete(schema.teams).where(eq(schema.teams.id, teamId)).run();
    db.delete(schema.leagues).where(eq(schema.leagues.id, leagueId)).run();
    db.delete(schema.seasons).where(eq(schema.seasons.id, seasonId)).run();
    db.delete(schema.pokemon).where(like(schema.pokemon.name, `${tag}-%`)).run();
  } catch { /* DB closed during suite teardown */ }
});

describe('FA pickup approved in the deadline week', () => {
  test('lands at the rollover instead of being auto-rejected', () => {
    // Approved during the deadline week, scheduled for the week after.
    const id = db.insert(schema.faRequests).values({
      leagueId, week: deadline, teamId, status: 'approved', requestType: 'pickup',
      pickups: JSON.stringify([`${tag}-fa`]), drops: JSON.stringify([`${tag}-own0`]),
      requestedBy: 'coach', resolvedBy: 'admin', resolvedAt: new Date().toISOString(),
      effectiveWeek: deadline + 1,
    }).returning().get().id;

    db.update(schema.leagues).set({ currentWeek: deadline + 1 }).where(eq(schema.leagues.id, leagueId)).run();
    applyDueTransactions(leagueId);

    const row = faRow(id);
    expect(row.rejectReason ?? null).toBeNull();
    expect(row.status).toBe('approved');
    expect(row.appliedAt).not.toBeNull();
    expect(onRoster(`${tag}-fa`)).toBe(teamId);
    expect(onRoster(`${tag}-own0`)).toBeUndefined();
  });

  test('a request made after the deadline is still refused', () => {
    db.update(schema.leagues).set({ currentWeek: deadline + 1 }).where(eq(schema.leagues.id, leagueId)).run();
    const id = db.insert(schema.faRequests).values({
      leagueId, week: deadline + 1, teamId, status: 'approved', requestType: 'pickup',
      pickups: JSON.stringify([`${tag}-own0`]), drops: JSON.stringify([`${tag}-own1`]),
      requestedBy: 'coach', resolvedBy: 'admin', resolvedAt: new Date().toISOString(),
      effectiveWeek: deadline + 1,
    }).returning().get().id;
    applyDueTransactions(leagueId);
    expect(faRow(id).status).toBe('rejected');
    expect(faRow(id).rejectReason).toContain('deadline');
  });
});
