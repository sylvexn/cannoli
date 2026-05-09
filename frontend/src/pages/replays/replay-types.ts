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
 * URL of the in-site replay embed served from the cannoli-ps-client image
 * (showdown/cannoli-replay-embed.html). The embed page reads `?match=<id>`,
 * fetches the log via /replay/data/<id>.json (proxied to cannoli-backend
 * by showdown/nginx.conf), and renders with the upstream PS Battle player.
 *
 * Centralised here so the viewer panel + the stream cockpit reuse the
 * same URL shape; if we ever fold the embed under a different path
 * (e.g. /replays/embed) this is the only spot to change.
 */
export function replayEmbedUrl(matchId: string): string {
  const raw = (import.meta.env.VITE_SHOWDOWN_URL as string | undefined) || 'https://sim.cannoli.live';
  // Strip any trailing slash and the dev-only `?~~host:port` server-prefix
  // suffix (see .env). PS uses that suffix to tell its SPA which game
  // server to talk to; for our embed page (a normal HTML file) we just
  // need scheme + host.
  let base = raw.replace(/\/$/, '');
  const q = base.indexOf('?');
  if (q !== -1) base = base.slice(0, q);
  return `${base}/replay/embed.html?match=${encodeURIComponent(matchId)}`;
}
