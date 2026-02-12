import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TeamLogo } from '@/components/team-logo';
import {
  SkipBack, ChevronLeft, Play, Pause, ChevronRight, SkipForward,
  User,
} from 'lucide-react';
import { useLeagueData } from '@/lib/league-data-context';
import type { DraftState, DraftAction } from './types';

interface DraftControlBarProps {
  state: DraftState;
  dispatch: (action: DraftAction) => void;
}

export function DraftControlBar({
  state,
  dispatch,
}: DraftControlBarProps) {
  const { players } = useLeagueData();
  const progress = (state.currentPickIndex / state.allPicks.length) * 100;
  const isDone = state.currentPickIndex >= state.allPicks.length;

  return (
    <div className="mt-3 rounded-lg border border-border-default bg-surface-raised px-4 py-3">
      {/* Progress bar */}
      <div className="h-1 w-full rounded-full bg-surface-overlay overflow-hidden mb-3">
        <div
          className="h-full rounded-full bg-pink transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-3">
        {/* User team selector */}
        <div className="flex items-center gap-2">
          <User size={13} className="text-text-muted" />
          <Select
            value={state.userTeamId ?? 'none'}
            onValueChange={v => dispatch({ type: 'SET_USER_TEAM', teamId: v === 'none' ? null : v })}
          >
            <SelectTrigger className="h-7 w-[140px] text-xs bg-surface-overlay border-border-default">
              <SelectValue placeholder="Pick a team..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">Auto (watch)</SelectItem>
              {players.map(p => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  <span className="flex items-center gap-1.5">
                    <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
                    {p.teamAbbrev} — {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-px h-6 bg-border-subtle" />

        {/* Transport controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: 'RESET_LIVE' })}
            className="h-7 w-7 p-0 text-text-muted hover:text-neon"
            title="Reset to start"
          >
            <SkipBack size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: 'STEP_BACK' })}
            disabled={state.currentPickIndex === 0}
            className="h-7 w-7 p-0 text-text-muted hover:text-neon disabled:opacity-30"
            title="Previous pick"
          >
            <ChevronLeft size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: state.isPlaying ? 'PAUSE' : 'PLAY' })}
            disabled={isDone}
            className={cn(
              'h-8 w-8 p-0 rounded-full',
              state.isPlaying
                ? 'bg-pink/10 text-pink hover:bg-pink/20'
                : 'bg-neon/10 text-neon hover:bg-neon/20',
              'disabled:opacity-30',
            )}
            title={state.isPlaying ? 'Pause' : 'Play'}
          >
            {state.isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: 'STEP_FORWARD' })}
            disabled={isDone}
            className="h-7 w-7 p-0 text-text-muted hover:text-neon disabled:opacity-30"
            title="Next pick"
          >
            <ChevronRight size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: 'SET_PICK_INDEX', index: state.allPicks.length })}
            disabled={isDone}
            className="h-7 w-7 p-0 text-text-muted hover:text-neon disabled:opacity-30"
            title="Skip to end"
          >
            <SkipForward size={14} />
          </Button>
        </div>

        <div className="w-px h-6 bg-border-subtle" />

        {/* Pick counter */}
        <div className="text-xs text-text-muted font-mono tabular-nums">
          Pick <span className="text-text-primary">{Math.min(state.currentPickIndex + 1, state.allPicks.length)}</span>
          <span className="text-text-muted"> / {state.allPicks.length}</span>
        </div>

        {/* Speed selector */}
        <div className="ml-auto flex rounded-lg border border-border-default overflow-hidden">
          {([1, 2, 5] as const).map(s => (
            <button
              key={s}
              onClick={() => dispatch({ type: 'SET_SPEED', speed: s })}
              className={cn(
                'text-[10px] font-medium h-6 px-2.5 transition-colors',
                state.speed === s
                  ? 'bg-neon/10 text-neon'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
              )}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
