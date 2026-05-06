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
