/**
 * Integration test for Fix 3: dismiss-warnings now fires runAutoAwards when
 * it flips disputed → completed.
 *
 * NOTE on scope: rather than wiring up the full Elysia route handler in a
 * test (which requires building a fake Request, auth, etc.), this test
 * verifies the contract the dismiss-warnings handler now meets — namely,
 * that calling `runAutoAwards(leagueId, { trigger: 'match', matchId })` on
 * a now-completed match correctly mints the per-match auto pins (Flawless
 * here). Combined with the Fix 3 source-level review (`backend/src/routes/
 * matches.ts` lines 289-308), this covers the regression: pre-fix, the
 * status flip was not followed by an auto-award call, so per-match pins
 * for matches dismissed-not-deleted were silently dropped.
 *
 * Uses BEGIN/ROLLBACK to keep the dev DB unchanged.
 */
import { describe, expect, test } from 'bun:test';
import { eq, and } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { runAutoAwards } from '../src/lib/pins/auto-award';

const PFX = 'tfix3-';

function pickHost(): { leagueId: string; seasonId: number; userId: number } | null {
  const league = db.select().from(schema.leagues).limit(1).all()[0];
  if (!league) return null;
  const user = db.select().from(schema.users).limit(1).all()[0];
  if (!user) return null;
  return { leagueId: league.id, seasonId: league.seasonId, userId: user.id };
}

describe('dismiss-warnings → runAutoAwards (Fix 3)', () => {
  const host = pickHost();
  if (!host) {
    test.skip('no seeded league/user available — skipping integration test', () => {});
    return;
  }

  test('flipping disputed→completed and calling runAutoAwards mints Flawless', () => {
    sqlite.exec('BEGIN');
    try {
      const teamA = `${PFX}aa`;
      const teamB = `${PFX}bb`;
      // Two fixture teams; team A is owned by a real user so a Flawless pin
      // can be created. team B has no userId — won't receive pins (and won't
      // win this match anyway).
      db.insert(schema.teams).values([
        {
          id: teamA, leagueId: host.leagueId, userId: host.userId,
          coachName: 'Test Aa', teamName: 'Test Aa', teamAbbrev: 'AA',
          teamColor: '#aaaaaa',
        },
        {
          id: teamB, leagueId: host.leagueId, userId: null,
          coachName: 'Test Bb', teamName: 'Test Bb', teamAbbrev: 'BB',
          teamColor: '#bbbbbb',
        },
      ]).run();

      // Insert a "disputed" match with full scores already set (a dominant A
      // win). Per Fix 3, the route handler will flip status='completed' and
      // call runAutoAwards. We mirror that here.
      const matchId = `${PFX}m1`;
      db.insert(schema.matches).values({
        id: matchId, leagueId: host.leagueId, week: 95,
        homeTeamId: teamA, awayTeamId: teamB,
        homeScore: 6, awayScore: 0,
        status: 'disputed', phase: 'regular',
      }).run();

      // Per-pokemon rows for the winning team (zero deaths → Flawless).
      // matchPokemon for the loser isn't required for Flawless detection
      // but we add a token row for symmetry / shape.
      db.insert(schema.matchPokemon).values([
        { matchId, teamId: teamA, pokemonName: 'Dragapult', kills: 6, deaths: 0 },
        { matchId, teamId: teamA, pokemonName: 'Garchomp', kills: 0, deaths: 0 },
        { matchId, teamId: teamB, pokemonName: 'Pikachu', kills: 0, deaths: 6 },
      ]).run();

      // === simulate the post-Fix-3 dismiss-warnings code path ===
      // 1. flip status disputed → completed (the handler does this in tx)
      db.update(schema.matches)
        .set({ status: 'completed', warnings: null })
        .where(eq(schema.matches.id, matchId))
        .run();
      // 2. call runAutoAwards — the line added by Fix 3
      const summary = runAutoAwards(host.leagueId, { trigger: 'match', matchId });

      // Flawless should have been awarded to host.userId (team A's owner)
      const awardedFlawless = summary.awarded.find(a => a.pinDefId === 'flawless');
      expect(awardedFlawless).toBeDefined();
      expect(awardedFlawless!.userId).toBe(host.userId);

      // And the row landed in pins.
      const pin = db.select().from(schema.pins)
        .where(and(
          eq(schema.pins.userId, host.userId),
          eq(schema.pins.pinDefId, 'flawless'),
          eq(schema.pins.seasonId, host.seasonId),
        ))
        .get();
      expect(pin).toBeDefined();
      expect(pin!.awardedBy).toBeNull(); // auto-award sets awardedBy = NULL
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });
});
