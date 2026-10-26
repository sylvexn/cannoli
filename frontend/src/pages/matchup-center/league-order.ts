import type { League } from '@/lib/types';

/** Phase priority used when picking a default "your team" — drafting > regular >
 *  playoffs > predraft > offseason. Higher = more urgent / interesting. */
const PHASE_PRIORITY: Record<string, number> = {
  draft: 5,
  regular: 4,
  playoffs: 3,
  predraft: 2,
  offseason: 1,
};

/** Active leagues first (archived seasons last), then by phase priority. Stable. */
export function sortLeaguesByActivity(leagues: League[]): League[] {
  const rank = (l: League) => (l.season.archived ? -1 : PHASE_PRIORITY[l.season.phase] ?? 0);
  return [...leagues].sort((a, b) => rank(b) - rank(a));
}

/** Leagues where the user owns a team come first (most active first); the rest keep their order. */
export function orderLeaguesForUser(
  leagues: League[],
  teamsByLeague: Record<string, { userId?: string | number | null }[]>,
  userId: string | undefined,
): League[] {
  if (!userId) return leagues;
  const mine = (l: League) => (teamsByLeague[l.id] ?? []).some(t => t.userId != null && String(t.userId) === userId);
  const own = sortLeaguesByActivity(leagues.filter(mine));
  return [...own, ...leagues.filter(l => !mine(l))];
}
