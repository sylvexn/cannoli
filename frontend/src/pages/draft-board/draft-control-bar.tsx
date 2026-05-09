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
import { useLeague } from '@/lib/league-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { generateSnakeSlots } from './use-draft-state';
import { DraftAdminOverrides } from './draft-admin-overrides';
import type { DraftState, DraftAction } from './types';
import type { DraftPresenceData } from './use-draft-websocket';

interface DraftControlBarProps {
  state: DraftState;
  dispatch: (action: DraftAction) => void;
  isDraftComplete: boolean;
  draftOrder: { id: string; teamAbbrev: string; teamColor: string; name: string; logoPath?: string | null }[];
  presence?: DraftPresenceData;
  timerEnabled?: boolean;
}

/**
 * Draft control bar — handles two phases:
 *   1. Pre-start: team selector, timer config, Start button (with hover panel + force-start dialog).
 *   2. In-progress / completed: thin "chrome" — progress + counter + presence + admin timer controls + reset.
 *
 * On-the-clock identity, your-turn affordance, and the prominent timer have been moved to
 * `DraftOnTheClock` (the hero strip docked above the pool).
 */
export function DraftControlBar({
  state,
  dispatch,
  isDraftComplete,
  draftOrder,
  presence,
  timerEnabled = true,
}: DraftControlBarProps) {
  const isServer = state.source === 'server';
  const isConfiguring = state.status === 'configuring' || state.status === 'idle';
  const { isAdmin } = useAuth();
  const league = useLeague();
  const [shiftHeld, setShiftHeld] = useState(false);
  const [forceStartOpen, setForceStartOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const hoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => setShiftHeld(e.shiftKey);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  const connectedTeamIds = new Set(presence?.players.map(p => p.teamId) ?? []);
  const allConnected = draftOrder.every(p => connectedTeamIds.has(p.id));
  const disconnectedTeams = draftOrder.filter(p => !connectedTeamIds.has(p.id));

  const adminSpecs = presence?.spectators.filter(s => s.role === 'dev' || s.role === 'admin') ?? [];
  const viewerSpecs = presence?.spectators.filter(s => s.role !== 'dev' && s.role !== 'admin') ?? [];

  const startLiveDraft = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    try {
      // Backend persists state and we let the WS broadcast bring everyone (including us)
      // back into 'running' via LIVE_SYNC. Do NOT dispatch DRAFT_START here — that
      // would silently flip source to 'simulator' and run client-side AI for the
      // other teams (the "single sided on mock" bug).
      await api.startDraft(league.id, state.timerDuration || 120);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start draft');
    } finally {
      setStarting(false);
    }
  }, [starting, league.id, state.timerDuration]);

  const startSimulatorDraft = useCallback(() => {
    if (!state.userTeamId) return;
    const teamIds = draftOrder.map(p => p.id);
    const snakeOrder = generateSnakeSlots(teamIds, 10);
    dispatch({
      type: 'DRAFT_START',
      snakeOrder,
      userTeamId: state.userTeamId,
      timerDuration: state.timerDuration || 30,
      pointCap: 110,
    });
  }, [state.userTeamId, state.timerDuration, draftOrder, dispatch]);

  const handleStartClick = useCallback((e: React.MouseEvent) => {
    if (isServer) {
      // Admin-only on the backend; show the connection panel before forcing.
      if (!isAdmin) {
        toast.error('Only admins can start a live draft');
        return;
      }
      if (e.shiftKey && !allConnected) {
        setForceStartOpen(true);
        return;
      }
      void startLiveDraft();
      return;
    }
    // Simulator path
    if (!state.userTeamId) return;
    if (e.shiftKey && !allConnected) {
      setForceStartOpen(true);
      return;
    }
    startSimulatorDraft();
  }, [isServer, state.userTeamId, isAdmin, allConnected, startLiveDraft, startSimulatorDraft]);

  const handleForceStart = useCallback(() => {
    if (isServer) {
      void startLiveDraft();
    } else {
      startSimulatorDraft();
    }
    setForceStartOpen(false);
  }, [isServer, startLiveDraft, startSimulatorDraft]);

  // ─── Pre-start configuration ──────────────────────────────────────────────
  if (isConfiguring) {
    return (
      <>
        <div className="px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <User size={13} className="text-text-muted" />
              <Select
                value={state.userTeamId}
                onValueChange={(v: string | null) => dispatch({ type: 'SET_USER_TEAM', teamId: v })}
              >
                <SelectTrigger className="h-7 w-[160px] text-xs bg-surface-overlay border-border-default">
                  <SelectValue placeholder="Pick your team..." />
                </SelectTrigger>
                <SelectContent>
                  {draftOrder.map((p, i) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-text-muted w-3">{i + 1}</span>
                        <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" logoPath={p.logoPath} />
                        {p.teamAbbrev} — {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-px h-6 bg-border-subtle" />

            {timerEnabled && (
              <div className="flex items-center gap-1.5">
                <Timer size={13} className="text-text-muted" />
                {/* Simulator/practice: anyone can set timer; live: admin-only */}
                {(isAdmin || !isServer) ? (
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
            )}

            {isServer && presence && (
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

            <div className="flex-1" />

            <div
              className="relative"
              ref={hoverRef}
              onMouseEnter={() => setHoverOpen(true)}
              onMouseLeave={() => setHoverOpen(false)}
            >
              <Button
                ref={buttonRef}
                onClick={handleStartClick}
                disabled={
                  starting
                  || (isServer ? !isAdmin : !state.userTeamId)
                }
                className={cn(
                  'h-8 px-4 text-xs font-bold gap-1.5 transition-all',
                  shiftHeld && !allConnected
                    ? 'bg-loss/20 text-loss border border-loss/40 hover:bg-loss/30'
                    : 'bg-neon/10 text-neon border border-neon/30 hover:bg-neon/20',
                  'disabled:opacity-30',
                )}
                title={
                  isServer && !isAdmin
                    ? 'Only admins can start a live draft'
                    : undefined
                }
              >
                {shiftHeld && !allConnected ? (
                  <>
                    <AlertTriangle size={14} />
                    Force Start
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    {starting ? 'Starting…' : 'Start Draft'}
                  </>
                )}
              </Button>

              {hoverOpen && isServer && presence && (
                <div className="absolute right-0 bottom-full mb-2 w-[220px] z-50 rounded-lg border border-border-default bg-surface-raised shadow-lg overflow-hidden">
                  <div className="px-3 py-1.5 border-b border-border-subtle bg-surface-overlay/30">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-muted">
                      Connection Status
                    </span>
                  </div>
                  <div className="px-2 py-1.5 space-y-0.5">
                    {draftOrder.map(p => {
                      const online = connectedTeamIds.has(p.id);
                      return (
                        <div key={p.id} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-surface-overlay/30">
                          <Circle
                            size={6}
                            className={cn('shrink-0', online ? 'fill-win text-win' : 'fill-loss text-loss')}
                          />
                          <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" logoPath={p.logoPath} />
                          <span className={cn('text-[11px] flex-1 truncate', online ? 'text-text-primary' : 'text-text-muted')}>
                            {p.teamAbbrev}
                          </span>
                          <span className={cn('text-[9px] font-mono', online ? 'text-win/70' : 'text-loss/70')}>
                            {online ? 'on' : 'off'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
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
                  <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" logoPath={p.logoPath} />
                  <span className="text-text-primary">{p.teamAbbrev}</span>
                  <span className="text-text-muted">— {p.name}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-text-muted">
              Force-started drafts with missing players will use auto-pick for disconnected teams.
              This session will be cleaned up if not completed.
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

  // ─── In-progress / completed: chrome only (timer/OTC live in DraftOnTheClock hero) ──
  const progress = state.snakeOrder.length > 0
    ? (state.currentPickIndex / state.snakeOrder.length) * 100
    : 0;

  return (
    <div className="px-3 py-1.5">
      {/* Draft progress (thin line) */}
      <div className="h-0.5 w-full rounded-full bg-surface-overlay overflow-hidden mb-1.5">
        <div
          className="h-full rounded-full bg-pink transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-3 text-[10px] font-mono text-text-muted flex-wrap">
        <span>
          <span className="text-text-primary">
            {Math.min(state.currentPickIndex + (isDraftComplete ? 0 : 1), state.snakeOrder.length)}
          </span>
          <span className="text-text-muted/40">/{state.snakeOrder.length}</span> picks
        </span>

        {isDraftComplete && (
          <>
            <div className="w-px h-3 bg-border-subtle" />
            <span className="flex items-center gap-1 text-win">
              <Trophy size={11} />
              Complete
            </span>
          </>
        )}

        {isServer && presence && !isDraftComplete && (
          <>
            <div className="w-px h-3 bg-border-subtle" />
            <span className="flex items-center gap-1">
              <Circle size={5} className="fill-win text-win" />
              {connectedTeamIds.size}/{draftOrder.length} online
            </span>
            {(adminSpecs.length > 0 || viewerSpecs.length > 0) && (
              <span className="flex items-center gap-1 text-text-muted/70">
                <Eye size={9} />
                {adminSpecs.length + viewerSpecs.length} spec
              </span>
            )}
          </>
        )}

        <div className="flex-1" />

        {/* Admin timer chrome (hidden when timer disabled or draft complete).
            Suppressed in simulator/practice mode — practice has no playback
            controls (no pause/step/speed); the user just runs the draft to
            completion or hits Reset. */}
        {isAdmin && isServer && !isDraftComplete && timerEnabled && (
          <>
            <button
              onClick={() => dispatch({ type: state.timerPaused ? 'RESUME_TIMER' : 'PAUSE_TIMER' })}
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                state.timerPaused
                  ? 'text-draw hover:bg-draw/10'
                  : 'text-text-muted hover:text-neon hover:bg-neon/5',
              )}
            >
              {state.timerPaused ? <Play size={10} /> : <Pause size={10} />}
              {state.timerPaused ? 'resume' : 'pause'}
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

        {/* Staff overrides — server source only, while draft is active */}
        {isAdmin && isServer && !isDraftComplete && (
          <DraftAdminOverrides
            draftOrder={draftOrder}
            draftedNames={new Set(state.allPicks.map(p => p.pokemonName))}
            canUndo={state.allPicks.length > 0}
          />
        )}

        <button
          onClick={() => dispatch({ type: 'DRAFT_RESET' })}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-text-muted hover:text-neon transition-colors"
        >
          <RotateCcw size={10} />
          reset
        </button>
      </div>
    </div>
  );
}
