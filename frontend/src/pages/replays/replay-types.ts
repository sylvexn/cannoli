import type { ApiMatch, ApiTeam } from '@/lib/api';
import type { League } from '@/lib/types';

export interface ReplayEntry {
  match: ApiMatch;
  league: League;
  homeTeam: ApiTeam | undefined;
  awayTeam: ApiTeam | undefined;
}

export type TimeFilter = 'this-week' | 'last-week' | 'playoffs' | 'my-matches' | 'all';

export const TIME_FILTERS: { id: TimeFilter; label: string }[] = [
  { id: 'this-week', label: 'This Week' },
  { id: 'last-week', label: 'Last Week' },
  // Playoff fixtures live at weeks past the regular schedule, so no week-based
  // bucket ever catches them — they need their own chip.
  { id: 'playoffs', label: 'Playoffs' },
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
  // Playoff fixtures sit at weeks PAST the regular schedule and currentWeek
  // stops advancing once the regular season ends, so `week < currentWeek` would
  // hide their badges forever. A visible score is the real "this one's in the
  // books" signal — the results-reveal gate nulls the ones still withheld.
  if (entry.match.phase === 'playoffs') return entry.match.homeScore != null;
  return entry.match.week < season.currentWeek;
}

/**
 * Base origin (scheme + host[:port]) the embed is served from, derived from
 * VITE_SHOWDOWN_URL. Strips any trailing slash and the dev-only `?~~host:port`
 * server-prefix suffix (see .env) — PS uses that suffix to tell its SPA which
 * game server to talk to; for our embed page (a normal HTML file) we just
 * need scheme + host.
 */
function showdownBase(): string {
  const raw = (import.meta.env.VITE_SHOWDOWN_URL as string | undefined) || 'https://sim.cannoli.live';
  let base = raw.replace(/\/$/, '');
  const q = base.indexOf('?');
  if (q !== -1) base = base.slice(0, q);
  return base;
}

/**
 * Origin (`scheme://host[:port]`) the embed iframe is served from. Used to
 * validate inbound postMessage events from the embed's log bridge and to
 * target outbound seek/play commands.
 */
export function showdownOrigin(): string {
  try {
    return new URL(showdownBase()).origin;
  } catch {
    return '*';
  }
}

/**
 * URL of the in-site replay embed served from the cannoli-ps-client image
 * (showdown/cannoli-replay-embed.html). The embed page reads `?match=<id>`,
 * fetches the log via /replay/data/<id>.json (proxied to cannoli-backend
 * by showdown/nginx.conf), and renders with the upstream PS Battle player.
 *
 * With `externalLog: true` the embed drops its built-in 540px log sidebar and
 * mirrors the battle log out via postMessage, so the Cannoli site can render
 * its own play-by-play panel beside the (now full-width) battle stage. The
 * default (no flag) keeps the self-contained PS layout for any caller that
 * just wants a drop-in iframe.
 *
 * Centralised here so the viewer panel + the stream cockpit reuse the
 * same URL shape; if we ever fold the embed under a different path
 * (e.g. /replays/embed) this is the only spot to change.
 */
export function replayEmbedUrl(matchId: string, opts?: { externalLog?: boolean }): string {
  let url = `${showdownBase()}/replay/embed.html?match=${encodeURIComponent(matchId)}`;
  if (opts?.externalLog) url += '&log=ext';
  return url;
}
