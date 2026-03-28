/**
 * Round-robin schedule generator.
 * Generates a balanced schedule where each team plays every other team exactly once.
 * Uses the "circle method" for even numbers of teams, with a bye week dummy for odd.
 */

import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { tx } from './tx';

interface MatchFixture {
  week: number;
  homeTeamId: string;
  awayTeamId: string;
}

/**
 * Generate a round-robin schedule for N teams over N-1 weeks (N even) or N weeks (N odd).
 * Each team plays every other team exactly once.
 */
export function generateRoundRobin(teamIds: string[]): MatchFixture[] {
  const teams = [...teamIds];

  // If odd number of teams, add a "BYE" placeholder
  if (teams.length % 2 !== 0) {
    teams.push('__BYE__');
  }

  const n = teams.length;
  const rounds = n - 1;
  const fixtures: MatchFixture[] = [];

  // Circle method: fix team[0], rotate the rest
  for (let round = 0; round < rounds; round++) {
    const week = round + 1;

    for (let i = 0; i < n / 2; i++) {
      const home = i === 0 ? teams[0] : teams[(round + i) % (n - 1) + 1];
      const away = teams[(round + (n - 1 - i)) % (n - 1) + 1];

      // Skip bye matchups
      if (home === '__BYE__' || away === '__BYE__') continue;

      // Alternate home/away across rounds for balance
      if (round % 2 === 0) {
        fixtures.push({ week, homeTeamId: home, awayTeamId: away });
      } else {
        fixtures.push({ week, homeTeamId: away, awayTeamId: home });
      }
    }
  }

  return fixtures;
}

/**
 * Generate and persist a schedule for a league.
 * Clears existing matches and creates new ones from the round-robin.
 */
export function generateLeagueSchedule(leagueId: string): { success: boolean; matchCount: number; error?: string } {
  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) return { success: false, matchCount: 0, error: 'League not found' };

  const teams = db.select().from(schema.teams)
    .where(eq(schema.teams.leagueId, leagueId))
    .all();
  if (teams.length < 2) return { success: false, matchCount: 0, error: 'Need at least 2 teams' };

  const teamIds = teams.map(t => t.id);
  const fixtures = generateRoundRobin(teamIds);

  return tx(() => {
    // Clear existing regular-season matches for this league
    db.delete(schema.matches)
      .where(eq(schema.matches.leagueId, leagueId))
      .run();

    // Insert new matches; populate deadline from THIS league's weekDates.
    // (weekDates moved off `seasons` so regenerating one league's schedule
    // no longer overwrites totalWeeks/weekDates for sibling leagues.)
    const weekDates: Record<string, string> = league.weekDates ? JSON.parse(league.weekDates) : {};

    const matchCountPerWeek = new Map<number, number>();
    for (const f of fixtures) {
      const matchNum = (matchCountPerWeek.get(f.week) ?? 0) + 1;
      matchCountPerWeek.set(f.week, matchNum);
      const matchId = `${leagueId}-w${f.week}m${matchNum}`;
      const deadlineDate = weekDates[String(f.week)];
      const deadline = deadlineDate ? new Date(deadlineDate + 'T23:59:59Z').toISOString() : null;
      db.insert(schema.matches).values({
        id: matchId,
        leagueId,
        week: f.week,
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
        phase: 'regular',
        deadline,
      }).run();
    }

    // Update THIS league's total weeks to match the generated schedule.
    const totalWeeks = Math.max(...fixtures.map(f => f.week));
    db.update(schema.leagues)
      .set({ totalWeeks })
      .where(eq(schema.leagues.id, leagueId))
      .run();

    return { success: true, matchCount: fixtures.length };
  });
}
