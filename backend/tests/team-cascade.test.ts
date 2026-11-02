/**
 * deleteTeamCascade on a team with match history, ready-log rows (both teams')
 * and FA requests — used to violate FKs (match_ready_log -> matches, fa_requests -> teams).
 */
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { tx } from '../src/lib/tx';
import { deleteTeamCascade } from '../src/lib/team-cascade';

describe('deleteTeamCascade', () => {
  test('deletes a team with matches, both-team ready logs and FA requests', () => {
    const tag = `tc-${Date.now()}`;
    const seasonId = db.insert(schema.seasons).values({ seasonNumber: 989, archived: false }).returning().get().id;
    const leagueId = `${tag}-l`;
    const [t1, t2] = [`${tag}-1`, `${tag}-2`];
    const matchId = `${tag}-m`;
    try {
      db.insert(schema.leagues).values({ id: leagueId, name: tag, color: '#111', seasonId, phase: 'regular' }).run();
      db.insert(schema.teams).values([
        { id: t1, leagueId, coachName: 'A', teamName: 'A', teamAbbrev: 'A', teamColor: '#111111' },
        { id: t2, leagueId, coachName: 'B', teamName: 'B', teamAbbrev: 'B', teamColor: '#222222' },
      ]).run();
      db.insert(schema.matches).values({ id: matchId, leagueId, week: 1, homeTeamId: t1, awayTeamId: t2 }).run();
      db.insert(schema.matchReadyLog).values([
        { matchId, teamId: t1, event: 'ready' },
        { matchId, teamId: t2, event: 'ready' },
      ]).run();
      db.insert(schema.faRequests).values({
        leagueId, teamId: t1, week: 1, status: 'pending', requestType: 'pickup', pickups: '[]', drops: '[]',
      } as any).run();

      tx(() => deleteTeamCascade(t1, leagueId));

      expect(db.select().from(schema.teams).where(eq(schema.teams.id, t1)).get()).toBeUndefined();
      expect(db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()).toBeUndefined();
      expect(db.select().from(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, matchId)).all()).toHaveLength(0);
      expect(db.select().from(schema.teams).where(eq(schema.teams.id, t2)).get()).toBeDefined();
    } finally {
      db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, matchId)).run();
      db.delete(schema.faRequests).where(eq(schema.faRequests.leagueId, leagueId)).run();
      db.delete(schema.matches).where(eq(schema.matches.id, matchId)).run();
      db.delete(schema.teams).where(eq(schema.teams.leagueId, leagueId)).run();
      db.delete(schema.leagues).where(eq(schema.leagues.id, leagueId)).run();
      db.delete(schema.seasons).where(eq(schema.seasons.id, seasonId)).run();
    }
  });
});
