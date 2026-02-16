import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TeamLogo } from '@/components/team-logo';
import {
  Play, Pause, RotateCcw, User, Timer, Trophy, Plus,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { generateSnakeSlots } from './use-draft-state';
import type { DraftState, DraftAction } from './types';

interface DraftControlBarProps {
  state: DraftState;
  dispatch: (action: DraftAction) => void;
  isDemoComplete: boolean;
  draftOrder: { id: string; teamAbbrev: string; teamColor: string; name: string }[];
}

export function DraftControlBar({
  state,
  dispatch,
  isDemoComplete,
  draftOrder,
}: DraftControlBarProps) {
  const { isAdmin } = useAuth();

  // Pre-start: show configuration
  if (!state.demoStarted) {
    return (
      <div className="mt-3 rounded-lg border border-border-default bg-surface-raised px-4 py-3">
        <div className="flex items-center gap-4">
          {/* Your team selector */}
          <div className="flex items-center gap-2">
            <User size={13} className="text-text-muted" />
            <Select
              value={state.userTeamId ?? 'none'}
              onValueChange={v => dispatch({ type: 'SET_USER_TEAM', teamId: v === 'none' ? null : v })}
            >
              <SelectTrigger className="h-7 w-[160px] text-xs bg-surface-overlay border-border-default">
                <SelectValue placeholder="Pick your team..." />
              </SelectTrigger>
              <SelectContent>
                {draftOrder.map((p, i) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono text-text-muted w-3">{i + 1}</span>
                      <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
                      {p.teamAbbrev} — {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-px h-6 bg-border-subtle" />

          {/* Timer duration — editable for admin/dev, read-only for others */}
          <div className="flex items-center gap-1.5">
            <Timer size={13} className="text-text-muted" />
            {isAdmin ? (
              <>
                <NumberInput
                  value={state.timerDuration}
                  onChange={v => dispatch({ type: 'SET_TIMER_DURATION', duration: v })}
                  min={10}
                  max={300}
                  step={5}
                  className="w-[68px] h-7 text-xs"
                />
                <span className="text-[10px] text-text-muted">sec/pick</span>
              </>
            ) : (
              <span className="text-[10px] text-text-muted">{state.timerDuration}s per pick</span>
            )}
          </div>

          {/* Start button */}
          <Button
            onClick={() => {
              if (!state.userTeamId) return;
              const teamIds = draftOrder.map(p => p.id);
              const snakeOrder = generateSnakeSlots(teamIds, 10);
              dispatch({
                type: 'DEMO_START',
                snakeOrder,
                userTeamId: state.userTeamId,
                timerDuration: state.timerDuration || 30,
                pointCap: 110,
              });
            }}
            disabled={!state.userTeamId}
            className={cn(
              'ml-auto h-8 px-4 text-xs font-bold gap-1.5',
              'bg-neon/10 text-neon border border-neon/30 hover:bg-neon/20',
              'disabled:opacity-30',
            )}
          >
            <Play size={14} />
            Start Draft
          </Button>
        </div>
      </div>
    );
  }

  // In-progress / completed
  const progress = state.snakeOrder.length > 0
    ? (state.currentPickIndex / state.snakeOrder.length) * 100
    : 0;

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
        {/* Your team */}
        <div className="flex items-center gap-2">
          <User size={13} className="text-text-muted" />
          {state.userTeamId && (() => {
            const p = draftOrder.find(t => t.id === state.userTeamId);
            return p ? (
              <span className="flex items-center gap-1.5 text-xs">
                <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
                <span className="text-text-primary font-medium">{p.teamAbbrev}</span>
              </span>
            ) : null;
          })()}
        </div>

        <div className="w-px h-6 bg-border-subtle" />

        {/* Pick counter */}
        <div className="text-xs text-text-muted font-mono tabular-nums">
          Pick <span className="text-text-primary">{Math.min(state.currentPickIndex + 1, state.snakeOrder.length)}</span>
          <span className="text-text-muted"> / {state.snakeOrder.length}</span>
        </div>

        {isDemoComplete && (
          <>
            <div className="w-px h-6 bg-border-subtle" />
            <div className="flex items-center gap-1.5 text-xs">
              <Trophy size={13} className="text-win" />
              <span className="text-win font-medium">Draft Complete!</span>
            </div>
          </>
        )}

        {/* Admin timer controls — only during active draft */}
        {isAdmin && !isDemoComplete && (
          <>
            <div className="w-px h-6 bg-border-subtle" />

            {/* Pause / Resume */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch({ type: state.timerPaused ? 'RESUME_TIMER' : 'PAUSE_TIMER' })}
              className={cn(
                'h-7 px-2 text-xs gap-1',
                state.timerPaused
                  ? 'text-draw hover:text-draw'
                  : 'text-text-muted hover:text-neon',
              )}
            >
              {state.timerPaused ? (
                <>
                  <Play size={12} />
                  Resume
                </>
              ) : (
                <>
                  <Pause size={12} />
                  Pause
                </>
              )}
            </Button>

            {/* Add time buttons */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch({ type: 'ADD_TIME', seconds: 15 })}
              className="h-7 px-2 text-xs text-text-muted hover:text-neon gap-0.5"
            >
              <Plus size={10} />
              15s
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch({ type: 'ADD_TIME', seconds: 30 })}
              className="h-7 px-2 text-xs text-text-muted hover:text-neon gap-0.5"
            >
              <Plus size={10} />
              30s
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch({ type: 'ADD_TIME', seconds: 60 })}
              className="h-7 px-2 text-xs text-text-muted hover:text-neon gap-0.5"
            >
              <Plus size={10} />
              60s
            </Button>

            {state.timerPaused && (
              <span className="text-[10px] font-mono text-draw animate-pulse">PAUSED</span>
            )}
          </>
        )}

        {/* Reset */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dispatch({ type: 'DEMO_RESET' })}
          className="ml-auto h-7 px-3 text-xs text-text-muted hover:text-neon gap-1.5"
        >
          <RotateCcw size={12} />
          Reset
        </Button>
      </div>
    </div>
  );
}
