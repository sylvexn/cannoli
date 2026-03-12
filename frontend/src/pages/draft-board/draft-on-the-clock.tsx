import { cn } from '@/lib/utils';
import { TeamLogo } from '@/components/team-logo';
import { Badge } from '@/components/ui/badge';
import { Timer, Pause, Zap } from 'lucide-react';
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
}

export function DraftOnTheClock({
  pick,
  player,
  timerSeconds,
  timerDuration,
  isUserTurn,
  totalPicks,
  timerPaused,
}: DraftOnTheClockProps) {
  const urgency = timerSeconds > timerDuration * 0.6 ? 'calm'
    : timerSeconds > timerDuration * 0.3 ? 'warning'
    : 'critical';

  return (
    <div
      className={cn(
        'relative px-3 py-1.5 overflow-hidden border-b border-border-subtle',
        isUserTurn && urgency === 'calm' && 'bg-neon/[0.04]',
        isUserTurn && urgency === 'warning' && 'bg-draw/[0.04]',
        isUserTurn && urgency === 'critical' && 'bg-loss/[0.06]',
        !isUserTurn && 'bg-surface-overlay/20',
      )}
    >
      {/* Timer progress bar — thin line at top */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-surface-overlay/30">
        <div
          className={cn(
            'h-full transition-all duration-1000 ease-linear',
            urgency === 'calm' && 'bg-neon',
            urgency === 'warning' && 'bg-draw',
            urgency === 'critical' && 'bg-loss',
          )}
          style={{ width: `${(timerSeconds / Math.max(timerSeconds, timerDuration)) * 100}%` }}
        />
      </div>

      <div className="flex items-center gap-3">
        {/* Team info — compact */}
        <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
        <span className="text-xs font-medium text-text-primary truncate">
          {player.teamAbbrev}
        </span>

        {isUserTurn && (
          <Badge className="bg-neon/20 text-neon border-neon/30 text-[9px] font-bold px-1.5 py-0 h-4 animate-pulse">
            <Zap size={8} className="mr-0.5" />
            YOUR PICK
          </Badge>
        )}

        <span className="text-[10px] text-text-muted font-mono">
          R{pick.round} P{pick.pick} · #{pick.overallPick}/{totalPicks}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Timer — right aligned, prominent */}
        <div className={cn(
          'flex items-center gap-1.5 px-2 py-0.5 rounded',
          'font-mono tabular-nums text-sm font-bold',
          timerPaused
            ? 'text-draw'
            : urgency === 'calm' ? 'text-neon'
            : urgency === 'warning' ? 'text-draw'
            : 'text-loss animate-pulse',
        )}>
          {timerPaused ? (
            <Pause size={12} />
          ) : (
            <Timer size={12} />
          )}
          <span className={timerPaused ? 'animate-pulse' : ''}>
            {Math.floor(timerSeconds / 60)}:{String(timerSeconds % 60).padStart(2, '0')}
          </span>
        </div>
      </div>
    </div>
  );
}
