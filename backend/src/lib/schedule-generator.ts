/**
 * Round-robin schedule generator.
 *
 * Each team plays every other team exactly once. Home/away assignment uses a
 * Berger-table style construction so home counts are balanced — for n teams
 * over n-1 rounds every team gets either ⌊(n-1)/2⌋ or ⌈(n-1)/2⌉ home games
 * (i.e. spread ≤ 1).
 *
 * For an odd team count we add a phantom "__BYE__" entry; pairings that
 * include it are emitted as bye-week fixtures (one team sits out per round)
 * which the persistence layer writes to the `bye_weeks` table instead of
 * silently dropping.
 */

import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { tx } from './tx';

const BYE_SENTINEL = '__BYE__';

interface MatchFixture {
  week: number;
  homeTeamId: string;
  awayTeamId: string;
}

interface ByeFixture {
  week: number;
  teamId: string;
}

export interface ScheduleFixtures {
  matches: MatchFixture[];
  byes: ByeFixture[];
}

/**
 * Generate a balanced round-robin schedule for N teams over N-1 weeks (or N
 * weeks with a single bye per team, when N is odd).
 *
 * Algorithm: classic Berger / circle method, with home/away decided by a
 * parity rule that produces a 1-game home spread:
 *   - In each round, the pivot team plays the team currently at slot 0 of
 *     the rotating wheel; the pivot is home iff the round index is odd.
 *   - Other pairs are formed symmetrically across the wheel; within the round
 *     the team at slot (r+i) is home iff i is odd.
 */
export function generateRoundRobin(teamIds: string[]): ScheduleFixtures {
  const teams = [...teamIds];
  const odd = teams.length % 2 !== 0;
  if (odd) teams.push(BYE_SENTINEL);

  const n = teams.length;
  const m = n - 1;
  const rounds = m;

  const matches: MatchFixture[] = [];
  const byes: ByeFixture[] = [];

  for (let r = 0; r < rounds; r++) {
    const week = r + 1;

    // Pivot pairing — pivot at index m, partner rotates through 0..m-1.
    const pivot = teams[m];
    const partner = teams[r];
    const pivotHome = r % 2 === 1;
    pushPair(matches, byes, week, pivotHome ? pivot : partner, pivotHome ? partner : pivot);

    for (let i = 1; i < n / 2; i++) {
      const aIdx = (r + i) % m;
      const bIdx = (r - i + m) % m;
      const a = teams[aIdx];
      const b = teams[bIdx];
      // Within a round, alternate home/away by i parity. Combined with the
      // pivot rule above this gives a 1-game home spread across all teams.
      const aHome = i % 2 === 1;
      pushPair(matches, byes, week, aHome ? a : b, aHome ? b : a);
    }
  }

  return { matches, byes };
}

function pushPair(matches: MatchFixture[], byes: ByeFixture[], week: number, home: string, away: string) {
  if (home === BYE_SENTINEL) {
    byes.push({ week, teamId: away });
    return;
  }
  if (away === BYE_SENTINEL) {
    byes.push({ week, teamId: home });
    return;
  }
  matches.push({ week, homeTeamId: home, awayTeamId: away });
}

/**
 * Generate and persist a schedule for a league.
 * Clears existing matches and bye rows, then writes new ones from the round-robin.
 */
export function generateLeagueSchedule(leagueId: string): { success: boolean; matchCount: number; byeCount: number; error?: string } {
  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) return { success: false, matchCount: 0, byeCount: 0, error: 'League not found' };

  const teams = db.select().from(schema.teams)
    .where(eq(schema.teams.leagueId, leagueId))
    .all();
  if (teams.length < 2) return { success: false, matchCount: 0, byeCount: 0, error: 'Need at least 2 teams' };

  const teamIds = teams.map(t => t.id);
  const { matches: fixtures, byes } = generateRoundRobin(teamIds);

  return tx(() => {
    // Clear existing regular-season matches + byes for this league
    db.delete(schema.matches)
      .where(eq(schema.matches.leagueId, leagueId))
      .run();
    db.delete(schema.byeWeeks)
      .where(eq(schema.byeWeeks.leagueId, leagueId))
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

    for (const b of byes) {
      db.insert(schema.byeWeeks).values({
        leagueId,
        week: b.week,
        teamId: b.teamId,
      }).run();
    }

    // Update THIS league's total weeks to match the generated schedule.
    const allWeeks = [
      ...fixtures.map(f => f.week),
      ...byes.map(b => b.week),
    ];
    const totalWeeks = allWeeks.length ? Math.max(...allWeeks) : 0;
    db.update(schema.leagues)
      .set({ totalWeeks })
      .where(eq(schema.leagues.id, leagueId))
      .run();

    return { success: true, matchCount: fixtures.length, byeCount: byes.length };
  });
}
