/**
 * Shared arena-state helpers extracted from backend/src/routes/arena.ts.
 *
 * These functions were previously module-private in arena.ts. Extracting them
 * lets the notifications route call getCurrentMatchReminder() without importing
 * the whole arena route tree (which has WS state / broadcast deps).
 *
 * arena.ts re-imports and re-exports them so its behavior is unchanged.
 */
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { getLeague } from './queries';

// ─── Team resolution ─────────────────────────────────────────────────────────

export function getUserTeam(userId: number): { teamId: string; leagueId: string } | null {
  const team = db.select().from(schema.teams)
    .where(eq(schema.teams.userId, userId))
    .get();
  return team ? { teamId: team.id, leagueId: team.leagueId } : null;
}

// ─── Playable-match window ────────────────────────────────────────────────────

/**
 * How many weeks ahead of the current week a coach may battle early. Past
 * (overdue) and current-week fixtures are always playable — this only caps the
 * forward window so coaches can't, on day one, play a late-season match with a
 * roster that trades will reshape before then.
 */
export const BATTLE_LOOKAHEAD_WEEKS = 2;

/**
 * All of a team's playable matches, sorted by week. "Playable" = regular phase,
 * not yet completed, and within the battle window: any current/overdue fixture,
 * plus up to BATTLE_LOOKAHEAD_WEEKS ahead (and any in-progress battle, never
 * hidden).
 */
export function getPlayableMatches(teamId: string, leagueId: string) {
  const league = getLeague(leagueId);
  if (!league) return [];
  if (league.phase !== 'regular') return [];

  const maxWeek = league.currentWeek + BATTLE_LOOKAHEAD_WEEKS;
  return db.select().from(schema.matches).where(
    eq(schema.matches.leagueId, leagueId),
  ).all().filter(m => {
    if (m.homeTeamId !== teamId && m.awayTeamId !== teamId) return false;
    if (m.status === 'in_progress') return true; // never hide a live battle
    if (m.status !== 'scheduled' && m.status !== 'ready') return false;
    return m.week <= maxWeek;
  }).sort((a, b) => a.week - b.week);
}

/** The team's fixture for the league's current week, if still playable. */
export function getCurrentMatch(teamId: string, leagueId: string) {
  const league = getLeague(leagueId);
  if (!league || league.phase !== 'regular') return null;
  return getPlayableMatches(teamId, leagueId).find(m => m.week === league.currentWeek) ?? null;
}

// ─── Match reminder ───────────────────────────────────────────────────────────

export interface MatchReminder {
  matchId: string;
  opponent: string | null;
  week: number;
  link: string;
  createdAt: string;
}

/**
 * Return a reminder for the user's current-week unplayed match, or null if:
 *   - the user has no team
 *   - the league is not in regular phase
 *   - the current-week match is already played / in-progress
 */
export function getCurrentMatchReminder(userId: number): MatchReminder | null {
  const team = getUserTeam(userId);
  if (!team) return null;

  const match = getCurrentMatch(team.teamId, team.leagueId);
  if (!match) return null;

  // Don't show a reminder for in-progress or completed matches.
  if (match.status === 'in_progress' || match.status === 'completed' || match.status === 'disputed') {
    return null;
  }

  const opponentId = match.homeTeamId === team.teamId ? match.awayTeamId : match.homeTeamId;
  let opponent: string | null = null;
  if (opponentId) {
    const opTeam = db.select({ teamName: schema.teams.teamName })
      .from(schema.teams)
      .where(eq(schema.teams.id, opponentId))
      .get();
    opponent = opTeam?.teamName ?? null;
  }

  return {
    matchId: match.id,
    opponent,
    week: match.week,
    link: '/showdown?tab=arena',
    // Use match id as a synthetic createdAt anchor so sort order is stable.
    // Matches don't have a createdAt; use a fixed sentinel near epoch-0 so
    // this item sorts to the bottom (oldest) among notification items.
    createdAt: '2000-01-01T00:00:00.000Z',
  };
}
