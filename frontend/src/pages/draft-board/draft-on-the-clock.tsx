import { cn } from '@/lib/utils';
import { TeamLogo } from '@/components/team-logo';
import { Badge } from '@/components/ui/badge';
import { Timer, Zap } from 'lucide-react';
import type { Player } from '@/lib/types';
import type { DraftPickEntry } from './types';

interface DraftOnTheClockProps {
  pick: DraftPickEntry;
  player: Player;
  timerSeconds: number;
  timerDuration: number;
  isUserTurn: boolean;
  totalPicks: number;
}

export function DraftOnTheClock({
  pick,
  player,
  timerSeconds,
  timerDuration,
  isUserTurn,
  totalPicks,
}: DraftOnTheClockProps) {
  const urgency = timerSeconds > timerDuration * 0.6 ? 'calm'
    : timerSeconds > timerDuration * 0.3 ? 'warning'
    : 'critical';

  return (
    <div
      className={cn(
        'relative rounded-lg border mb-3 px-4 py-3 overflow-hidden',
        'transition-all duration-300',
        urgency === 'calm' && 'border-border-default',
        urgency === 'warning' && 'border-draw/40',
        urgency === 'critical' && 'border-loss/40',
        isUserTurn && 'border-neon/50 shadow-glow-sm',
      )}
    >
      {/* Team color gradient background */}
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{ background: `linear-gradient(135deg, ${player.teamColor}, transparent 60%)` }}
      />

      <div className="relative flex items-center gap-4">
        {/* Team info */}
        <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-heading font-bold text-text-primary truncate">
              {player.name}'s {player.teamName}
            </span>
            {isUserTurn && (
              <Badge className="bg-neon/20 text-neon border-neon/30 text-[10px] font-bold animate-pulse">
                <Zap size={10} className="mr-0.5" />
                YOUR PICK
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-text-muted font-mono">
              Round {pick.round}, Pick {pick.pick}
            </span>
            <span className="text-[11px] text-text-muted">·</span>
            <span className="text-[11px] text-text-muted font-mono">
              Overall #{pick.overallPick} of {totalPicks}
            </span>
          </div>
        </div>

        {/* Timer */}
        <div className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-md',
          'border font-mono tabular-nums text-lg font-bold',
          urgency === 'calm' && 'border-border-subtle text-neon',
          urgency === 'warning' && 'border-draw/30 text-draw bg-draw/5',
          urgency === 'critical' && 'border-loss/30 text-loss bg-loss/5 animate-pulse',
        )}>
          <Timer size={16} />
          <span>
            {Math.floor(timerSeconds / 60)}:{String(timerSeconds % 60).padStart(2, '0')}
          </span>
        </div>
      </div>

      {/* Timer progress bar */}
      <div className="mt-2 h-1 w-full rounded-full bg-surface-overlay overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-1000 ease-linear',
            urgency === 'calm' && 'bg-neon',
            urgency === 'warning' && 'bg-draw',
            urgency === 'critical' && 'bg-loss',
          )}
          style={{ width: `${(timerSeconds / timerDuration) * 100}%` }}
        />
      </div>
    </div>
  );
}
