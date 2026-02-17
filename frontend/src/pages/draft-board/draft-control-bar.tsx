import { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TeamLogo } from '@/components/team-logo';
import {
  Play, Pause, RotateCcw, User, Timer, Trophy, AlertTriangle,
  Circle, Eye,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { generateSnakeSlots } from './use-draft-state';
import type { DraftState, DraftAction } from './types';
import type { DraftPresenceData } from './use-draft-websocket';

interface DraftControlBarProps {
  state: DraftState;
  dispatch: (action: DraftAction) => void;
  isDemoComplete: boolean;
  draftOrder: { id: string; teamAbbrev: string; teamColor: string; name: string }[];
  presence?: DraftPresenceData;
  wsConnected?: boolean;
}

export function DraftControlBar({
  state,
  dispatch,
  isDemoComplete,
  draftOrder,
  presence,
  wsConnected,
}: DraftControlBarProps) {
  const { isAdmin } = useAuth();
  const [shiftHeld, setShiftHeld] = useState(false);
  const [forceStartOpen, setForceStartOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const hoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Global shift tracking
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => setShiftHeld(e.shiftKey);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  // Track connected team IDs
  const connectedTeamIds = new Set(presence?.players.map(p => p.teamId) ?? []);
  const allConnected = draftOrder.every(p => connectedTeamIds.has(p.id));
  const disconnectedTeams = draftOrder.filter(p => !connectedTeamIds.has(p.id));

  // Spectators: group dev+admin as "admins", rest as spectators
  const adminSpecs = presence?.spectators.filter(s => s.role === 'dev' || s.role === 'admin') ?? [];
  const viewerSpecs = presence?.spectators.filter(s => s.role !== 'dev' && s.role !== 'admin') ?? [];

  const handleStartClick = useCallback((e: React.MouseEvent) => {
    if (!state.userTeamId) return;

    if (e.shiftKey && !allConnected) {
      setForceStartOpen(true);
      return;
    }

    const teamIds = draftOrder.map(p => p.id);
    const snakeOrder = generateSnakeSlots(teamIds, 10);
    dispatch({
      type: 'DEMO_START',
      snakeOrder,
      userTeamId: state.userTeamId,
      timerDuration: state.timerDuration || 30,
      pointCap: 110,
    });
  }, [state.userTeamId, state.timerDuration, draftOrder, dispatch, allConnected]);

  const handleForceStart = useCallback(() => {
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
    setForceStartOpen(false);
  }, [state.userTeamId, state.timerDuration, draftOrder, dispatch]);

  // Pre-start: show configuration
  if (!state.demoStarted) {
    return (
      <>
        <div className="mt-3 rounded-lg border border-border-default bg-surface-raised px-4 py-2.5">
          <div className="flex items-center gap-3">
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

            {/* Timer duration */}
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
                  <span className="text-[10px] text-text-muted">s/pick</span>
                </>
              ) : (
                <span className="text-[10px] text-text-muted">{state.timerDuration}s per pick</span>
              )}
            </div>

            {/* Connected count badge */}
            {state.mode === 'live' && presence && (
              <>
                <div className="w-px h-6 bg-border-subtle" />
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] gap-1 px-2 py-0.5',
                    allConnected
                      ? 'text-win border-win/30 bg-win/10'
                      : 'text-draw border-draw/30 bg-draw/10',
                  )}
                >
                  <Circle size={6} className={allConnected ? 'fill-win text-win' : 'fill-draw text-draw'} />
                  {connectedTeamIds.size}/{draftOrder.length} online
                </Badge>
              </>
            )}

            {/* Spacer pushes button right */}
            <div className="flex-1" />

            {/* Start button with hover panel */}
            <div
              className="relative"
              ref={hoverRef}
              onMouseEnter={() => setHoverOpen(true)}
              onMouseLeave={() => setHoverOpen(false)}
            >
              <Button
                ref={buttonRef}
                onClick={handleStartClick}
                disabled={!state.userTeamId}
                className={cn(
                  'h-8 px-4 text-xs font-bold gap-1.5 transition-all',
                  shiftHeld && !allConnected
                    ? 'bg-loss/20 text-loss border border-loss/40 hover:bg-loss/30'
                    : 'bg-neon/10 text-neon border border-neon/30 hover:bg-neon/20',
                  'disabled:opacity-30',
                )}
              >
                {shiftHeld && !allConnected ? (
                  <>
                    <AlertTriangle size={14} />
                    Force Start
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    Start Draft
                  </>
                )}
              </Button>

              {/* Connection status hover panel */}
              {hoverOpen && state.mode === 'live' && presence && (
                <div className="absolute right-0 bottom-full mb-2 w-[220px] z-50 rounded-lg border border-border-default bg-surface-raised shadow-lg overflow-hidden">
                  {/* Header */}
                  <div className="px-3 py-1.5 border-b border-border-subtle bg-surface-overlay/30">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-muted">
                      Connection Status
                    </span>
                  </div>

                  {/* Player list */}
                  <div className="px-2 py-1.5 space-y-0.5">
                    {draftOrder.map(p => {
                      const online = connectedTeamIds.has(p.id);
                      return (
                        <div key={p.id} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-surface-overlay/30">
                          <Circle
                            size={6}
                            className={cn(
                              'shrink-0',
                              online ? 'fill-win text-win' : 'fill-loss text-loss',
                            )}
                          />
                          <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
                          <span className={cn(
                            'text-[11px] flex-1 truncate',
                            online ? 'text-text-primary' : 'text-text-muted',
                          )}>
                            {p.teamAbbrev}
                          </span>
                          <span className={cn(
                            'text-[9px] font-mono',
                            online ? 'text-win/70' : 'text-loss/70',
                          )}>
                            {online ? 'on' : 'off'}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Admins + Spectators footer */}
                  {(adminSpecs.length > 0 || viewerSpecs.length > 0) && (
                    <div className="px-3 py-1.5 border-t border-border-subtle bg-surface-overlay/20 flex items-center gap-2 text-[9px] text-text-muted">
                      {adminSpecs.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Circle size={5} className="fill-neon text-neon" />
                          {adminSpecs.length} admin{adminSpecs.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {viewerSpecs.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Eye size={9} />
                          {viewerSpecs.length} spectator{viewerSpecs.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Force Start Confirmation Dialog */}
        <Dialog open={forceStartOpen} onOpenChange={setForceStartOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-loss" />
                Force Start Draft
              </DialogTitle>
              <DialogDescription>
                {disconnectedTeams.length} player{disconnectedTeams.length !== 1 ? 's' : ''} not connected:
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1 py-2">
              {disconnectedTeams.map(p => (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <Circle size={6} className="fill-loss text-loss" />
                  <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
                  <span className="text-text-primary">{p.teamAbbrev}</span>
                  <span className="text-text-muted">— {p.name}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-text-muted">
              Force-started drafts with missing players will use auto-pick for disconnected teams. This session will be cleaned up if not completed.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setForceStartOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={handleForceStart}
                className="gap-1.5"
              >
                <AlertTriangle size={14} />
                Force Start
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // In-progress / completed
  const progress = state.snakeOrder.length > 0
    ? (state.currentPickIndex / state.snakeOrder.length) * 100
    : 0;

  return (
    <div className="mt-2 rounded-lg border border-border-default bg-surface-raised px-3 py-2">
      {/* Progress bar */}
      <div className="h-0.5 w-full rounded-full bg-surface-overlay overflow-hidden mb-2">
        <div
          className="h-full rounded-full bg-pink transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-2">
        {/* Your team */}
        <div className="flex items-center gap-1.5">
          {state.userTeamId && (() => {
            const p = draftOrder.find(t => t.id === state.userTeamId);
            return p ? (
              <span className="flex items-center gap-1 text-xs">
                <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
                <span className="text-text-primary font-medium">{p.teamAbbrev}</span>
              </span>
            ) : null;
          })()}
        </div>

        <div className="w-px h-5 bg-border-subtle" />

        {/* Pick counter */}
        <span className="text-[11px] text-text-muted font-mono tabular-nums">
          {Math.min(state.currentPickIndex + 1, state.snakeOrder.length)}<span className="text-text-muted/50">/{state.snakeOrder.length}</span>
        </span>

        {isDemoComplete && (
          <>
            <div className="w-px h-5 bg-border-subtle" />
            <div className="flex items-center gap-1 text-xs">
              <Trophy size={12} className="text-win" />
              <span className="text-win font-medium">Complete</span>
            </div>
          </>
        )}

        {/* Online count (live mode, during draft) */}
        {state.mode === 'live' && presence && !isDemoComplete && (
          <>
            <div className="w-px h-5 bg-border-subtle" />
            <span className="text-[10px] text-text-muted font-mono">
              <Circle size={5} className="inline fill-win text-win mr-0.5 -mt-px" />
              {connectedTeamIds.size}/{draftOrder.length}
            </span>
            {(adminSpecs.length > 0 || viewerSpecs.length > 0) && (
              <span className="text-[9px] text-text-muted/60 flex items-center gap-0.5">
                <Eye size={8} />
                {adminSpecs.length + viewerSpecs.length}
              </span>
            )}
          </>
        )}

        {/* Admin timer controls */}
        {isAdmin && !isDemoComplete && (
          <>
            <div className="w-px h-5 bg-border-subtle" />

            <button
              onClick={() => dispatch({ type: state.timerPaused ? 'RESUME_TIMER' : 'PAUSE_TIMER' })}
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors',
                state.timerPaused
                  ? 'text-draw hover:bg-draw/10'
                  : 'text-text-muted hover:text-neon hover:bg-neon/5',
              )}
            >
              {state.timerPaused ? <Play size={10} /> : <Pause size={10} />}
              {state.timerPaused ? 'Resume' : 'Pause'}
            </button>

            <div className="flex items-center rounded border border-border-subtle overflow-hidden">
              {[15, 30, 60].map(s => (
                <button
                  key={s}
                  onClick={() => dispatch({ type: 'ADD_TIME', seconds: s })}
                  className="px-1.5 py-0.5 text-[10px] font-mono text-text-muted hover:text-neon hover:bg-neon/5 transition-colors border-r border-border-subtle last:border-r-0"
                >
                  +{s}s
                </button>
              ))}
            </div>

            {state.timerPaused && (
              <span className="text-[9px] font-mono text-draw animate-pulse">PAUSED</span>
            )}
          </>
        )}

        {/* Reset */}
        <button
          onClick={() => dispatch({ type: 'DEMO_RESET' })}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-text-muted hover:text-neon transition-colors"
        >
          <RotateCcw size={10} />
          Reset
        </button>
      </div>
    </div>
  );
}
