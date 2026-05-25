/**
 * SHO-2 regression: W/L is decided by the winner flag, NOT the KO differential.
 *
 * A Showdown forfeit/timeout at full health emits an equal KO score (e.g. 2-2)
 * but a real `|win|` winner. Standings must credit the win to that team — never
 * read it back off `home_score > away_score` (which would score the forfeit as
 * a tie). The fix: matches.winner_team_id (set from |win| / forfeit survivor),
 * which computeStandings prefers over score comparison.
 *
 * Writes a small fixture to the shared dev DB under unique ids; cleans up after.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { computeStandings } from '../src/lib/standings';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

const tag = `sho2-${Date.now()}`;
const leagueId = `${tag}-lg`;
const A = `${tag}-A`; // forfeit winner (full health, 2 KOs)
const B = `${tag}-B`; // forfeited (also 2 KOs)
const C = `${tag}-C`; // decisive winner by score, no explicit flag (legacy/sim path)
const D = `${tag}-D`;
let seasonId: number;

beforeAll(() => {
  const season = db.insert(schema.seasons).values({
    seasonNumber: 8500 + (Date.now() % 1000), pointCap: 110, teraCaptainSlots: 2, archived: false,
  }).returning().get();
  seasonId = season.id;

  db.insert(schema.leagues).values({
    id: leagueId, name: 'SHO2 Fixture', color: '#abcdef', seasonId,
    phase: 'regular', currentWeek: 2, draftOrder: JSON.stringify([A, B, C, D]),
  }).run();

  for (const [id, name] of [[A, 'Alpha'], [B, 'Bravo'], [C, 'Charlie'], [D, 'Delta']] as const) {
    db.insert(schema.teams).values({ id, leagueId, coachName: name, teamName: name, teamAbbrev: name.slice(0, 3) }).run();
  }

  // Week 1: A beats B by FORFEIT logged 2-2. Winner flag = A (the survivor).
  db.insert(schema.matches).values({
    id: `${tag}-w1`, leagueId, week: 1, phase: 'regular',
    homeTeamId: A, awayTeamId: B, homeScore: 2, awayScore: 2,
    forfeitedBy: 'away', winnerTeamId: A, status: 'completed',
  }).run();

  // Week 1: C beats D 6-3 with NO explicit winner flag → score-comparison
  // fallback must still credit C (covers legacy / sim rows).
  db.insert(schema.matches).values({
    id: `${tag}-w1b`, leagueId, week: 1, phase: 'regular',
    homeTeamId: C, awayTeamId: D, homeScore: 6, awayScore: 3,
    winnerTeamId: null, status: 'completed',
  }).run();
});

afterAll(() => {
  try {
    db.delete(schema.matches).where(eq(schema.matches.leagueId, leagueId)).run();
    db.delete(schema.teams).where(eq(schema.teams.leagueId, leagueId)).run();
    db.delete(schema.leagues).where(eq(schema.leagues.id, leagueId)).run();
    db.delete(schema.seasons).where(eq(schema.seasons.id, seasonId)).run();
  } catch { /* DB closed during suite teardown */ }
});

describe('SHO-2 — forfeit winner flag decides W/L', () => {
  test('a 2-2 forfeit credits the winner-flagged team a W and the other an L (not a tie)', () => {
    const standings = computeStandings(leagueId);
    const a = standings.find(r => r.id === A)!;
    const b = standings.find(r => r.id === B)!;

    expect(a.wins).toBe(1);
    expect(a.losses).toBe(0);
    expect(b.wins).toBe(0);
    expect(b.losses).toBe(1);

    // PF/PA still reflect the raw KO totals (the 2-2 score is preserved).
    expect(a.kills).toBe(2);
    expect(a.deaths).toBe(2);
  });

  test('score-comparison fallback still works when winner_team_id is null', () => {
    const standings = computeStandings(leagueId);
    const c = standings.find(r => r.id === C)!;
    const d = standings.find(r => r.id === D)!;
    expect(c.wins).toBe(1);
    expect(c.losses).toBe(0);
    expect(d.wins).toBe(0);
    expect(d.losses).toBe(1);
  });

  test('the forfeit winner is seeded above the forfeit loser', () => {
    const standings = computeStandings(leagueId);
    const idxA = standings.findIndex(r => r.id === A);
    const idxB = standings.findIndex(r => r.id === B);
    expect(idxA).toBeLessThan(idxB);
  });
});
