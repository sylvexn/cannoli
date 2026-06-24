import { useState } from 'react';
import { useParams, useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Link2, Maximize2, Minimize2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ReplayPlayer } from './replays/replay-player';

/**
 * Optional context handed in via router `state` when navigating from a match
 * row (archive schedule/bracket/team, live schedule, profiles). Lets the
 * header show real team/league labels without a round-trip. Absent on direct
 * links / refreshes / shared URLs — the embed itself still shows full player
 * names and the battle, so a missing header is only cosmetic.
 */
interface ReplayWatchState {
  homeLabel?: string;
  awayLabel?: string;
  week?: number;
  playoffRound?: string | null;
  leagueName?: string;
  leagueColor?: string;
}

/**
 * Full-page in-app replay viewer (`/replay/:matchId`). Iframes the self-hosted
 * Pokemon Showdown embed (sim.cannoli.live/replay/embed.html), which fetches
 * the stored battle log from the backend by match id and plays it with the
 * real PS battle player. Works for ANY match with a log — archived (S9/S10)
 * or live (S11 onward) — so every "watch replay" link in the app routes here
 * instead of the dead public replay.pokemonshowdown.com URLs.
 */
export function ReplayWatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [theater, setTheater] = useState(false);

  // Deep link: /replay/:id?t=N opens the replay seeked to turn N.
  const turnParam = Number(searchParams.get('t'));
  const initialTurn = Number.isFinite(turnParam) && turnParam > 0 ? turnParam : undefined;

  const state = (location.state ?? {}) as ReplayWatchState;
  const hasMatchup = !!(state.homeLabel && state.awayLabel);
  const weekLabel = state.playoffRound
    ? state.playoffRound.toUpperCase()
    : state.week != null ? `W${state.week}` : null;

  if (!matchId) {
    return (
      <div className="text-text-muted py-20 text-center text-sm">
        No replay selected.{' '}
        <Link to="/replays" className="text-neon hover:underline">Browse the gallery</Link>.
      </div>
    );
  }

  function copyShareLink() {
    const url = `${window.location.origin}/replay/${encodeURIComponent(matchId!)}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success('Replay link copied'),
      () => toast.error('Could not copy'),
    );
  }

  return (
    <div className={cn('flex flex-col h-full', theater && 'fixed inset-0 z-[60] bg-surface p-4')}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/replays'))}
            className="flex items-center gap-1 text-text-muted hover:text-neon transition-colors text-xs shrink-0"
            title="Back"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <span className="text-border-default">|</span>
          <Play size={13} className="text-neon shrink-0" />
          <h1 className="font-mono text-sm font-bold uppercase tracking-widest truncate">
            {hasMatchup ? (
              <span className="text-text-primary">
                {state.homeLabel} <span className="text-text-muted">vs</span> {state.awayLabel}
              </span>
            ) : (
              <><span className="text-neon">Match</span>{' '}<span className="text-text-primary">Replay</span></>
            )}
          </h1>
          {weekLabel && <span className="text-[10px] text-text-muted shrink-0">{weekLabel}</span>}
          {state.leagueName && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
              style={{ color: state.leagueColor, backgroundColor: `${state.leagueColor ?? '#888'}15` }}
            >
              {state.leagueName.replace(' League', '')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={copyShareLink}
            className="p-1 text-text-muted hover:text-neon transition-colors"
            title="Copy share link"
          >
            <Link2 size={14} />
          </button>
          <button
            onClick={() => setTheater(t => !t)}
            className="p-1 text-text-muted hover:text-neon transition-colors"
            title={theater ? 'Exit theater mode' : 'Theater mode'}
          >
            {theater ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      <ReplayPlayer matchId={matchId} initialTurn={initialTurn} className="flex-1 min-h-0" />
    </div>
  );
}
