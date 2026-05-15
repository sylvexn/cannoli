/**
 * Integration test for Fix 1: standings.ts now requires status='completed'
 * on the match — disputed matches with scores filled in must NOT count
 * toward W/L records (or H2H wins inside a tied bucket).
 *
 * Inserts fixtures into the seeded dev DB inside a transaction and ROLLBACKs
 * at the end so the dev DB is unchanged. Skips cleanly if no league/season
 * is present.
 */
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { computeStandings } from '../src/lib/standings';

const PFX = 'tfix1-';

function pickHostLeague(): { leagueId: string } | null {
  const row = db.select().from(schema.leagues).limit(1).all()[0];
  if (!row) return null;
  return { leagueId: row.id };
}

describe('standings: disputed matches not counted (Fix 1)', () => {
  const host = pickHostLeague();
  if (!host) {
    test.skip('no seeded league available — skipping integration test', () => {});
    return;
  }

  test('disputed match with scores does not contribute to W/L', () => {
    // BEGIN
    sqlite.exec('BEGIN');
    try {
      // Insert two fixture teams scoped to the host league. We avoid touching
      // existing teams' records — both fixture teams have unique IDs and only
      // play each other (matches restricted to (homeTeamId, awayTeamId) of
      // these two), so the disputed-not-counted assertion is purely about
      // these new rows.
      const teamA = `${PFX}aa`;
      const teamB = `${PFX}bb`;
      db.insert(schema.teams).values([
        {
          id: teamA, leagueId: host.leagueId, coachName: 'Test A',
          teamName: 'Test Alpha', teamAbbrev: 'TA', teamColor: '#111111',
        },
        {
          id: teamB, leagueId: host.leagueId, coachName: 'Test B',
          teamName: 'Test Beta', teamAbbrev: 'TB', teamColor: '#222222',
        },
      ]).run();

      // Three matches between teamA and teamB:
      //  1. Completed — A wins 4-1
      //  2. Disputed (scores filled) — should NOT count under Fix 1
      //  3. NULL-scored scheduled — should NOT count
      const m1 = `${PFX}m1`;
      const m2 = `${PFX}m2`;
      const m3 = `${PFX}m3`;
      db.insert(schema.matches).values([
        {
          id: m1, leagueId: host.leagueId, week: 90,
          homeTeamId: teamA, awayTeamId: teamB,
          homeScore: 4, awayScore: 1,
          status: 'completed', phase: 'regular',
        },
        {
          id: m2, leagueId: host.leagueId, week: 91,
          homeTeamId: teamA, awayTeamId: teamB,
          homeScore: 0, awayScore: 5, // would be huge B win if counted
          status: 'disputed', phase: 'regular',
        },
        {
          id: m3, leagueId: host.leagueId, week: 92,
          homeTeamId: teamA, awayTeamId: teamB,
          homeScore: null, awayScore: null,
          status: 'scheduled', phase: 'regular',
        },
      ]).run();

      const standings = computeStandings(host.leagueId);
      const a = standings.find(r => r.id === teamA);
      const b = standings.find(r => r.id === teamB);

      expect(a).toBeDefined();
      expect(b).toBeDefined();

      // Only the completed match counts: A is 1-0, B is 0-1.
      expect(a!.wins).toBe(1);
      expect(a!.losses).toBe(0);
      expect(b!.wins).toBe(0);
      expect(b!.losses).toBe(1);

      // A's PF/PA reflects only the completed match (4 / 1).
      expect(a!.kills).toBe(4);
      expect(a!.deaths).toBe(1);
      expect(b!.kills).toBe(1);
      expect(b!.deaths).toBe(4);
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });
});

// Avoid unused-import warnings if drizzle's sql tag becomes unused on edits.
void sql;
