import type { ApiMatch, ApiTeam } from '@/lib/api';
import type { League } from '@/lib/types';

export interface ReplayEntry {
  match: ApiMatch;
  league: League;
  homeTeam: ApiTeam | undefined;
  awayTeam: ApiTeam | undefined;
}

export type TimeFilter = 'this-week' | 'last-week' | 'my-matches' | 'all';

export const TIME_FILTERS: { id: TimeFilter; label: string }[] = [
  { id: 'this-week', label: 'This Week' },
  { id: 'last-week', label: 'Last Week' },
  { id: 'my-matches', label: 'My Matches' },
  { id: 'all', label: 'All-Time' },
];

/**
 * Spoiler gate. Per-replay rule:
 *   - Archived seasons reveal everything (matches are historical).
 *   - Otherwise the entry's week must be strictly behind the league's
 *     currentWeek before MVP/sweep/tera badges show — those flags spoil
 *     the outcome for streams of the active week.
 *
 * If we can't determine a season status (free-play replays etc.), default
 * to revealed since the spoiler concern is league-week broadcasts only.
 */
export function isReplayWeekEnded(entry: ReplayEntry) {
  const season = entry.league.season;
  if (!season) return true;
  if (season.archived) return true;
  return entry.match.week < season.currentWeek;
}

/**
 * Check if a replay URL can be safely iframed.
 * Includes both relative `/replay…` paths (legacy) and the configured PS
 * sim host (which sets `frame-ancestors 'self' https://cannoli.live` per
 * showdown/nginx.conf).
 */
export function isLocalReplay(url: string) {
  if (url.startsWith('/replays/') || url.startsWith('/replay')) return true;
  const psUrl = (import.meta.env.VITE_SHOWDOWN_URL as string | undefined) || 'https://sim.cannoli.live';
  try {
    const psHost = new URL(psUrl).host;
    const u = new URL(url);
    return u.host === psHost;
  } catch {
    return false;
  }
}
