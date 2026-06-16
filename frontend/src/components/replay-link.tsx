import { Link } from 'react-router-dom';
import type { ReactNode, MouseEvent } from 'react';

/**
 * Optional display context passed to the in-app replay viewer via router
 * state, so its header can label the match without a round-trip. Purely
 * cosmetic — the viewer falls back gracefully when absent (direct/shared links).
 */
export interface ReplayLinkContext {
  homeLabel?: string;
  awayLabel?: string;
  week?: number;
  playoffRound?: string | null;
  leagueName?: string;
  leagueColor?: string;
}

/**
 * Links a match to the in-app replay viewer (`/replay/:matchId`) instead of
 * the external replay.pokemonshowdown.com URL. The viewer iframes the
 * self-hosted PS embed, which plays the stored battle log by match id — so
 * this works for every match with a log (archived S9/S10 and live S11 onward),
 * whereas the old external links 404 (those battles ran on the private server).
 *
 * Use this anywhere a match row wants a "watch replay" affordance.
 */
export function ReplayLink({
  matchId,
  context,
  className,
  title,
  children,
  stopPropagation = true,
}: {
  matchId: string;
  context?: ReplayLinkContext;
  className?: string;
  title?: string;
  children: ReactNode;
  /** Stop click propagation so a clickable parent row doesn't also fire. */
  stopPropagation?: boolean;
}) {
  return (
    <Link
      to={`/replay/${encodeURIComponent(matchId)}`}
      state={context}
      title={title ?? 'Watch replay'}
      className={className}
      onClick={stopPropagation ? (e: MouseEvent) => e.stopPropagation() : undefined}
    >
      {children}
    </Link>
  );
}
