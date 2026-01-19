import type { LeagueSeason, Match } from '@/lib/types';
import { rawMatches } from './schedule-data';
import { matchDetailMap } from './match-details';

export const currentSeason: LeagueSeason = {
  id: 's10',
  seasonNumber: 10,
  phase: 'regular',
  currentWeek: 9,
  totalWeeks: 11,
};

/** All matches (re-exported from schedule-data for backwards compat) */
export const allMatches = rawMatches;

/** Get matches for a specific team (with pokemonKD attached) */
export function getTeamMatches(teamId: string): Match[] {
  return allMatches
    .filter(m => m.homePlayer === teamId || m.awayPlayer === teamId)
    .sort((a, b) => a.week - b.week)
    .map(enrichMatch);
}

/** Get matches for a specific week (with pokemonKD attached) */
export function getWeekMatches(week: number): Match[] {
  return allMatches
    .filter(m => m.week === week)
    .map(enrichMatch);
}

/** Attach pokemonKD to a match from generated detail data */
function enrichMatch(match: Match): Match {
  const detail = matchDetailMap.get(match.id);
  if (!detail) return match;
  return { ...match, pokemonKD: detail };
}

// Convenience re-exports for standings page
export const recentMatches = getWeekMatches(currentSeason.currentWeek);
export const upcomingMatches = getWeekMatches(currentSeason.currentWeek + 1);
