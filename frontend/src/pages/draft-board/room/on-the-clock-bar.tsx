import { cn } from '@/lib/utils';
import { Pause, ArrowRight, AlertTriangle, Search } from 'lucide-react';
import { TeamLink } from '@/components/team-link';
import { useLeague } from '@/lib/league-context';
import type { Player } from '@/lib/types';
import type { DraftPickEntry } from '../types';

interface OnTheClockBarProps {
  pick: DraftPickEntry;
  player: Player;
  timerSeconds: number;
  timerDuration: number;
  timerEnabled?: boolean;
  timerPaused?: boolean;
  isUserTurn: boolean;
  totalPicks: number;
  /** The on-the-clock team's remaining points / open roster slots. */
  pointsLeft: number;
  slotsLeft: number;
  topQueuedName: string | null;
  onDraftFromQueue: () => void;
  onOpenPool: () => void;
}

export function formatClock(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Thin on-the-clock strip above the board. Keeps the old hero's urgency
 *  colors (calm/warning/critical) on the user's turn; pink when spectating. */
export function OnTheClockBar({
  pick, player, timerSeconds, timerDuration, timerEnabled = true, timerPaused, isUserTurn,
  totalPicks, pointsLeft, slotsLeft, topQueuedName, onDraftFromQueue, onOpenPool,
}: OnTheClockBarProps) {
  const league = useLeague();
  const urgency = timerSeconds > timerDuration * 0.6 ? 'calm'
    : timerSeconds > timerDuration * 0.3 ? 'warning' : 'critical';
  const pct = timerEnabled ? Math.max(0, (timerSeconds / Math.max(timerSeconds, timerDuration)) * 100) : 0;

  const tone = !isUserTurn ? 'text-pink'
    : urgency === 'calm' ? 'text-neon' : urgency === 'warning' ? 'text-draw' : 'text-loss';
  const bar = !isUserTurn ? 'bg-pink/70'
    : urgency === 'calm' ? 'bg-neon' : urgency === 'warning' ? 'bg-draw' : 'bg-loss';

  return (
    <div
      key={`otc-${pick.overallPick}`}
      className={cn(
        'otc-shell relative shrink-0 mb-1.5 overflow-hidden rounded-lg border bg-surface-raised',
        isUserTurn ? 'otc-shell-user border-neon/40' : 'border-border-default',
        isUserTurn && urgency === 'warning' && 'border-draw/40',
        isUserTurn && urgency === 'critical' && 'border-loss/50',
      )}
    >
      {timerEnabled && (
        <div className="absolute top-0 inset-x-0 h-[2px] bg-surface-overlay/60">
          <div
            className={cn('h-full transition-all duration-1000 ease-linear', bar, timerPaused && 'opacity-50')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="flex items-center gap-3 px-3 py-2 flex-wrap">
        {timerEnabled && (
          <div
            className={cn('flex items-center gap-1.5 font-mono tabular-nums', tone, timerPaused && 'animate-pulse')}
            aria-label={isUserTurn && urgency === 'critical' ? `Critical: ${timerSeconds} seconds left to pick` : undefined}
          >
            {timerPaused && <Pause size={14} aria-hidden />}
            <span className="text-2xl font-bold leading-none">{formatClock(timerSeconds)}</span>
            {isUserTurn && urgency === 'critical' && (
              <span className="flex items-center gap-1 pl-1.5 border-l border-loss/40 text-[9px] uppercase tracking-widest font-bold animate-pulse">
                <AlertTriangle size={10} aria-hidden />
                Critical
              </span>
            )}
          </div>
        )}

        {timerPaused && (
          <span className="px-1.5 py-0.5 rounded border border-draw/40 bg-draw/10 text-[10px] font-mono font-bold uppercase tracking-widest text-draw">
            Paused
          </span>
        )}

        <div className="min-w-0">
          <div className={cn('text-sm font-heading font-bold truncate', tone)}>
            {isUserTurn ? (
              <>You're on the clock — <span className="font-mono">{player.teamAbbrev}</span></>
            ) : (
              <TeamLink
                team={{
                  leagueId: league.id, teamId: player.id, teamName: player.teamName,
                  teamAbbrev: player.teamAbbrev, teamColor: player.teamColor, logoPath: player.logoPath,
                }}
                showLogo={false}
                className="font-mono"
              >
                {player.teamAbbrev}
              </TeamLink>
            )}
            {!isUserTurn && <span className="ml-1">is on the clock</span>}
          </div>
          <div className="text-[10px] font-mono text-text-muted">
            R{pick.round} · P{pick.pick} · #{pick.overallPick}/{totalPicks} · {pointsLeft} pts left · {slotsLeft} slot{slotsLeft === 1 ? '' : 's'}
          </div>
        </div>

        <div className="flex-1" />

        {isUserTurn && topQueuedName && (
          <button
            type="button"
            onClick={onDraftFromQueue}
            title={`Draft ${topQueuedName} from queue`}
            className={cn(
              'group h-8 px-3 rounded-md font-bold text-[11px] flex items-center gap-1.5 transition-all',
              'bg-neon text-surface hover:bg-neon/90 hover:shadow-[0_0_18px_rgba(34,211,238,0.45)]',
              urgency === 'critical' && 'animate-pulse',
            )}
          >
            Draft #1 from queue
            <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}
        <button
          type="button"
          onClick={onOpenPool}
          className="h-8 px-2.5 rounded-md border border-border-default bg-surface-overlay/40 text-[11px] text-text-secondary hover:text-text-primary hover:border-border-default flex items-center gap-1.5 transition-colors"
        >
          <Search size={12} aria-hidden />
          Open pool
          <kbd className="ml-0.5 px-1 rounded border border-border-subtle bg-surface text-[9px] font-mono text-text-muted">P</kbd>
        </button>
      </div>
    </div>
  );
}
