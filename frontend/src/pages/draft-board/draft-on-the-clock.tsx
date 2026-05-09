import { cn } from '@/lib/utils';
import { TeamCoachStack } from '@/components/team-coach-stack';
import { useLeague } from '@/lib/league-context';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Badge } from '@/components/ui/badge';
import { Timer, Pause, ListOrdered, Sparkles, ArrowRight, AlertTriangle } from 'lucide-react';
import type { Player } from '@/lib/types';
import type { DraftPickEntry } from './types';

interface DraftOnTheClockProps {
  pick: DraftPickEntry;
  player: Player;
  timerSeconds: number;
  timerDuration: number;
  isUserTurn: boolean;
  totalPicks: number;
  timerPaused?: boolean;
  /** Whether we should show timer-related affordances (admin can disable) */
  timerEnabled?: boolean;
  /** Top of the user's queue, shown inline when relevant */
  topQueuedName?: string | null;
  /** Quick action: draft top of queue (when it's user's turn) */
  onDraftFromQueue?: () => void;
  /** Whether auto-draft is on (changes the waiting message) */
  autoDraftQueueEnabled?: boolean;
}

/**
 * "On the clock" hero strip — docks at the TOP of the pool when a draft is active.
 *
 * Two visual modes:
 *   - Your turn: high-contrast, urgent, primary action front-and-center
 *   - Waiting: quieter pink-accented, surfaces auto-pick context
 */
export function DraftOnTheClock({
  pick,
  player,
  timerSeconds,
  timerDuration,
  isUserTurn,
  totalPicks,
  timerPaused,
  timerEnabled = true,
  topQueuedName,
  onDraftFromQueue,
  autoDraftQueueEnabled,
}: DraftOnTheClockProps) {
  const league = useLeague();
  const urgency = timerSeconds > timerDuration * 0.6 ? 'calm'
    : timerSeconds > timerDuration * 0.3 ? 'warning'
    : 'critical';

  const timerWidth = timerEnabled
    ? Math.max(0, (timerSeconds / Math.max(timerSeconds, timerDuration)) * 100)
    : 0;

  return (
    <div
      className={cn(
        'relative overflow-hidden border-b',
        isUserTurn
          ? urgency === 'calm'
            ? 'border-neon/40 bg-gradient-to-r from-neon/[0.08] via-neon/[0.04] to-transparent'
            : urgency === 'warning'
            ? 'border-draw/40 bg-gradient-to-r from-draw/[0.10] via-draw/[0.04] to-transparent'
            : 'border-loss/50 bg-gradient-to-r from-loss/[0.14] via-loss/[0.06] to-transparent'
          : 'border-border-default bg-surface-overlay/15',
      )}
    >
      {/* Timer progress line — thin, animated */}
      {timerEnabled && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-surface-overlay/40">
          <div
            className={cn(
              'h-full transition-all duration-1000 ease-linear',
              isUserTurn && urgency === 'calm' && 'bg-neon',
              isUserTurn && urgency === 'warning' && 'bg-draw',
              isUserTurn && urgency === 'critical' && 'bg-loss',
              !isUserTurn && 'bg-pink/60',
              timerPaused && 'opacity-50',
            )}
            style={{ width: `${timerWidth}%` }}
          />
        </div>
      )}

      <div className="px-3 py-2 flex items-center gap-3 flex-wrap">
        {/* Drafter identity */}
        <div className="flex items-center gap-2 min-w-0">
          <TeamCoachStack
            team={{
              leagueId: league.id,
              teamId: player.id,
              teamAbbrev: player.teamAbbrev,
              teamColor: player.teamColor,
              logoPath: player.logoPath,
              owner: player.owner,
            }}
            size="md"
            side="right"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={cn(
                'text-sm font-heading font-bold truncate',
                isUserTurn ? 'text-text-primary' : 'text-text-secondary',
              )}>
                {player.teamAbbrev}
              </span>
              {isUserTurn && (
                <Badge className={cn(
                  'text-[10px] font-bold px-1.5 py-0 h-4 font-mono uppercase tracking-wider',
                  urgency === 'critical'
                    ? 'bg-loss/20 text-loss border-loss/40 animate-pulse'
                    : 'bg-neon/15 text-neon border-neon/30',
                )}>
                  Your pick
                </Badge>
              )}
            </div>
            <div className="text-[10px] font-mono text-text-muted">
              R{pick.round} · P{pick.pick} · pick #{pick.overallPick}/{totalPicks}
            </div>
          </div>
        </div>

        {/* Big timer — when urgency is critical we add a secondary
            (non-color) signal: an AlertTriangle + the visible word "CRITICAL"
            so users who can't distinguish the loss-red colour still see the
            urgency. */}
        {timerEnabled && (
          <div
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border font-mono tabular-nums',
              isUserTurn
                ? urgency === 'calm' ? 'text-neon border-neon/40 bg-neon/[0.06]'
                : urgency === 'warning' ? 'text-draw border-draw/40 bg-draw/[0.06]'
                : 'text-loss border-loss/40 bg-loss/[0.10] animate-pulse'
                : 'text-pink/80 border-pink/30 bg-pink/[0.04]',
              timerPaused && 'animate-pulse',
            )}
            aria-label={
              isUserTurn && urgency === 'critical'
                ? `Critical: ${timerSeconds} seconds left to pick`
                : undefined
            }
          >
            {timerPaused ? <Pause size={14} aria-hidden /> : <Timer size={14} aria-hidden />}
            <span className="text-lg font-bold leading-none">
              {Math.floor(timerSeconds / 60)}:{String(timerSeconds % 60).padStart(2, '0')}
            </span>
            {isUserTurn && urgency === 'critical' && (
              <span className="flex items-center gap-1 ml-1 pl-1.5 border-l border-loss/40 text-[9px] uppercase tracking-widest font-bold">
                <AlertTriangle size={10} aria-hidden />
                Critical
              </span>
            )}
          </div>
        )}

        {/* Top-of-queue context */}
        {isUserTurn ? (
          topQueuedName && (
            <div className="hidden md:flex items-center gap-1.5 pl-2 border-l border-border-subtle text-[11px] text-text-muted">
              <ListOrdered size={11} className="text-pink shrink-0" />
              <span>queue:</span>
              <PokemonSprite name={topQueuedName} size="xs" />
              <span className="text-text-primary truncate max-w-[120px]">{topQueuedName}</span>
            </div>
          )
        ) : (
          <div className="hidden md:flex items-center gap-1.5 pl-2 border-l border-border-subtle text-[11px] text-text-muted">
            {autoDraftQueueEnabled ? (
              <>
                <Sparkles size={10} className="text-pink shrink-0" />
                <span>spectating · auto-pick on</span>
              </>
            ) : (
              <span>spectating</span>
            )}
            {urgency === 'critical' && (
              <span className="flex items-center gap-1 text-loss font-mono">
                <AlertTriangle size={11} />likely to skip
              </span>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* Primary action — only when it's user's turn and we have something queued */}
        {isUserTurn && topQueuedName && onDraftFromQueue && (
          <button
            onClick={onDraftFromQueue}
            className={cn(
              'group h-8 px-3 rounded-md font-bold text-[11px] flex items-center gap-1.5 transition-all',
              'bg-neon text-surface hover:bg-neon/90 hover:shadow-[0_0_18px_rgba(34,211,238,0.45)]',
              urgency === 'critical' && 'animate-pulse',
            )}
            title="Draft top of queue"
          >
            <Sparkles size={12} />
            Draft #1
            <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>
    </div>
  );
}
