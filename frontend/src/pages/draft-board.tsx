import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { preloadSprites } from '@/components/pokemon-sprite';
import { Badge } from '@/components/ui/badge';
import {
  LayoutGrid, Table, Zap, History, Radio, Wifi, Loader2, Monitor, ScrollText,
  Volume2, VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { UserAccentScope } from '@/components/user-accent-scope';
import { useDraftState } from './draft-board/use-draft-state';
import { useDraftMute } from './draft-board/use-draft-mute';
import { DraftFilterBar } from './draft-board/draft-filter-bar';
import { DraftPoolWithRail } from './draft-board/draft-pool-with-rail';
import { DraftTeamSidebar } from './draft-board/draft-team-sidebar';
import { DraftPoolTable } from './draft-board/draft-pool-table';
import { PokemonHoverCard } from './draft-board/pokemon-hover-card';
import { PokemonDetailSheet } from './draft-board/pokemon-detail-sheet';
import { DraftControlBar } from './draft-board/draft-control-bar';
import { DraftOnTheClock } from './draft-board/draft-on-the-clock';
import { DraftPickLog } from './draft-board/draft-pick-log';
import { DraftConfirmPopover } from './draft-board/draft-confirm-popover';
import { DraftCaptainGate } from './draft-board/draft-captain-gate';
import { TIER_LIST } from '@/data/tier-list';
import { getTierEntry } from '@/data/tier-list';
import { playCry } from '@/lib/pokemon';

/** Simple segmented toggle button group */
function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode; activeClass?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border-default overflow-hidden">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors',
            value === opt.value
              ? opt.activeClass ?? 'bg-surface-overlay text-text-primary'
              : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function DraftBoardPage() {
  const { user } = useAuth();
  const { muted, toggleMuted, hintShown, markHintShown } = useDraftMute();
  const {
    state, dispatch,
    league, players,
    ownershipMap, filteredPool, poolByTier,
    currentPick, teamRosters, teamPoints,
    rosterLookup, playerLookup, isUserTurn, isDemoComplete,
    draftOrder, handleUserPick, wsConnected, presence, userBudgetRemaining,
    userMaxAffordableCost, userConflictRoster,
    draftTimerEnabled, draftDemoVisible,
    displayTimerSeconds,
  } = useDraftState();

  // One-time "sound on — click to mute" chip. Auto-dismisses after 5s and
  // records the flag so it never resurfaces.
  const [hintVisible, setHintVisible] = useState(false);

  // Captain gate is open while every team has finished drafting (live mode +
  // isDemoComplete) but the league is still in phase=draft (= some team
  // hasn't locked captains yet). Once the last team locks, the backend flips
  // phase → regular and a fresh /api/leagues fetch closes the gate.
  const captainGateOpen = state.mode === 'live'
    && isDemoComplete
    && league.season?.phase === 'draft'
    && players.length > 0
    && !players.every(p => p.captainsLocked);

  // Mobile viewport detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{ name: string; rect: DOMRect } | null>(null);
  const [pickLogExpanded, setPickLogExpanded] = useState(false);

  // Quick-draft confirmation popover state
  const [confirmPopover, setConfirmPopover] = useState<{ name: string; rect: DOMRect } | null>(null);

  // Track card rects for popover positioning
  const cardRectsRef = useRef<Map<string, DOMRect>>(new Map());

  // Preload sprites for all visible Pokemon in the current filtered pool
  useEffect(() => {
    preloadSprites(filteredPool.map(e => e.name));
  }, [filteredPool]);

  const isLiveMode = (state.mode === 'demo' || state.mode === 'live') && state.demoStarted;

  const handleCardClick = useCallback((name: string) => {
    // During draft, show popover for free agents (for drafting or queueing).
    // Open the popover even if the pick has a conflict so the user can read why.
    if (isLiveMode && !ownershipMap.has(name)) {
      const tierEntry = getTierEntry(name);
      const fitsRawBudget = tierEntry && userBudgetRemaining != null && tierEntry.tier <= userBudgetRemaining;
      if (fitsRawBudget || !isUserTurn) {
        const rect = cardRectsRef.current.get(name);
        if (rect) {
          setConfirmPopover({ name, rect });
          setHoverInfo(null);
          return;
        }
      }
    }
    // Otherwise open the detail sheet
    dispatch({ type: 'SET_DETAIL', name });
  }, [dispatch, isLiveMode, isUserTurn, ownershipMap, userBudgetRemaining]);

  const handleCardHoverStart = useCallback((name: string, rect: DOMRect) => {
    // Store rect for later popover positioning
    cardRectsRef.current.set(name, rect);
    // Don't show hover while popover is open
    if (!confirmPopover) {
      setHoverInfo({ name, rect });
    }
  }, [confirmPopover]);

  const handleCardHoverEnd = useCallback(() => {
    setHoverInfo(null);
  }, []);

  const handleQueueAdd = useCallback((name: string) => {
    // Block queueing Pokemon that wouldn't fit even ignoring conflicts.
    // We compare to userMaxAffordableCost so a t10 mon with 8pt headroom (because
    // 2pt is reserved for the remaining slot) is also blocked.
    const cap = userMaxAffordableCost ?? userBudgetRemaining;
    if (cap != null) {
      const entry = TIER_LIST.find(e => e.name === name);
      if (entry && entry.tier > cap) {
        toast.error(`Can't queue ${name} — costs ${entry.tier}pt, only ${cap}pt available after reserving for remaining picks`);
        return;
      }
    }
    dispatch({ type: 'QUEUE_ADD', name });
    toast.info(`${name} added to queue`);
  }, [dispatch, userBudgetRemaining, userMaxAffordableCost]);

  const handleQueueRemove = useCallback((name: string) => {
    dispatch({ type: 'QUEUE_REMOVE', name });
    toast.info(`${name} removed from queue`);
  }, [dispatch]);

  const handleDraftFromQueue = useCallback(() => {
    if (!isUserTurn || state.draftQueue.length === 0) return;
    const name = state.draftQueue[0];
    if (!ownershipMap.has(name)) {
      handleUserPick(name);
    }
  }, [isUserTurn, state.draftQueue, ownershipMap, handleUserPick]);

  // Play Pokemon cry on EVERY broadcast pick (demo or live). All connected
  // clients hear the cry on every pick — moved out of the per-user gate so the
  // draft feels live and shared. Per-user mute toggle controls audibility.
  // Also auto-expands the pick log so the celebration sequence (sprite scale,
  // type-color glow, tier badge slide) is always seen — collapsed log meant
  // celebrations were silently invisible. Users can manually re-collapse.
  const prevPickCountRef = useRef(state.allPicks.length);
  useEffect(() => {
    const prev = prevPickCountRef.current;
    prevPickCountRef.current = state.allPicks.length;
    if (isLiveMode && state.allPicks.length > prev && state.allPicks.length > 0) {
      const lastPick = state.allPicks[state.allPicks.length - 1];
      // Make sure the pick log is open so the celebration is visible. The
      // DraftPickLog uses mount as its "freshly landed" trigger, so we want
      // it mounted before the pick state propagates further.
      setPickLogExpanded(true);
      if (lastPick.pokemonName && !muted) {
        playCry(lastPick.pokemonName, 0.15);
        // Surface the one-time hint the first time a cry actually plays.
        if (!hintShown) {
          setHintVisible(true);
          markHintShown();
        }
      }
    }
  }, [state.allPicks.length, isLiveMode, muted, hintShown, markHintShown]);

  // Auto-dismiss the hint chip after 5s.
  useEffect(() => {
    if (!hintVisible) return;
    const t = setTimeout(() => setHintVisible(false), 5000);
    return () => clearTimeout(t);
  }, [hintVisible]);

  // Toast when a queued Pokemon gets drafted by someone else
  const prevQueueRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevQueueRef.current;
    if (prev.length > 0 && isLiveMode) {
      for (const name of prev) {
        if (!state.draftQueue.includes(name) && ownershipMap.has(name)) {
          const owner = ownershipMap.get(name);
          const player = owner ? playerLookup.get(owner.teamId) : undefined;
          const teamName = player?.teamAbbrev ?? 'someone';
          toast.warning(`${name} was drafted by ${teamName}`, { description: 'Removed from your queue' });
        }
      }
    }
    prevQueueRef.current = state.draftQueue;
  }, [state.draftQueue, ownershipMap, isLiveMode, playerLookup]);

  const handleConfirmDraft = useCallback((name: string) => {
    handleUserPick(name);
    setConfirmPopover(null);
  }, [handleUserPick]);

  const handleViewDetails = useCallback((name: string) => {
    setConfirmPopover(null);
    dispatch({ type: 'SET_DETAIL', name });
  }, [dispatch]);

  // Compute budget after pick for popover
  const popoverBudgetAfter = confirmPopover
    ? (() => {
        const tierEntry = getTierEntry(confirmPopover.name);
        if (tierEntry && userBudgetRemaining != null) return userBudgetRemaining - tierEntry.tier;
        return undefined;
      })()
    : undefined;

  // Mobile warning for active draft participants
  if (isMobile && isLiveMode && state.userTeamId && !isDemoComplete) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 px-6 text-center">
        <Monitor size={40} className="text-text-muted" />
        <h2 className="text-lg font-mono font-bold text-text-primary uppercase">Desktop Required</h2>
        <p className="text-sm text-text-muted max-w-sm">
          Draft participation requires a desktop browser. You can spectate from mobile.
        </p>
      </div>
    );
  }

  const showFooter = state.mode === 'demo' || state.mode === 'live';

  // Pulse-glow on the draft room body when it's THIS user's turn — peripheral
  // signal to remove "did I miss my turn?" anxiety. Color = user accent.
  const showOnTheClockGlow = isLiveMode && isUserTurn && !isDemoComplete;

  return (
    <UserAccentScope user={user} className="contents">
    <div className={cn(
      'flex flex-col h-full overflow-hidden',
      showOnTheClockGlow && 'pulse-glow',
    )}>
      {/* Top bar: title + mode + view toggle — always compact */}
      <div className="flex items-center justify-between gap-3 pb-1.5 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-mono font-bold tracking-tight uppercase">
            <span className="text-draw">Draft</span>
            <span className="text-text-primary ml-1">Board</span>
          </h1>
          <Link
            to="/rules"
            className="hidden md:inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-pink transition-colors"
          >
            <ScrollText size={11} />
            Rules
          </Link>
          <SegmentedToggle
            value={state.mode}
            onChange={mode => dispatch({ type: 'SET_MODE', mode })}
            options={[
              { value: 'season', label: 'Season', icon: <History size={13} />, activeClass: 'bg-neon/10 text-neon' },
              ...(draftDemoVisible ? [{ value: 'demo' as const, label: 'Demo', icon: <Zap size={13} />, activeClass: 'bg-pink/10 text-pink' }] : []),
              { value: 'live', label: 'Live', icon: <Radio size={13} />, activeClass: 'bg-win/10 text-win' },
            ]}
          />
          {state.mode === 'live' && (
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] gap-1.5 px-2 py-0.5 font-mono',
                wsConnected
                  ? 'text-win border-win/30 bg-win/10'
                  : 'text-draw border-draw/30 bg-draw/10',
              )}
            >
              {wsConnected ? (
                <>
                  <Wifi size={10} />
                  Connected
                </>
              ) : (
                <>
                  <Loader2 size={10} className="animate-spin" />
                  Connecting...
                </>
              )}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Recent picks toggle (inline badge) */}
          {isLiveMode && state.allPicks.length > 0 && !isDemoComplete && (
            <button
              onClick={() => setPickLogExpanded(!pickLogExpanded)}
              className={cn(
                'text-[10px] font-mono px-2 py-0.5 rounded border transition-colors',
                pickLogExpanded
                  ? 'text-neon border-neon/30 bg-neon/5'
                  : 'text-text-muted border-border-subtle hover:text-text-secondary',
              )}
            >
              {state.allPicks.length} picks
            </button>
          )}

          {/* Cry mute toggle — always visible during live/demo so spectators
              can pre-mute before the first pick fires. */}
          {isLiveMode && (
            <div className="relative">
              <button
                onClick={toggleMuted}
                title={muted ? 'Cries muted — click to unmute' : 'Cries on — click to mute'}
                aria-label={muted ? 'Unmute pick cries' : 'Mute pick cries'}
                aria-pressed={muted}
                className={cn(
                  'h-6 w-6 inline-flex items-center justify-center rounded border transition-colors',
                  muted
                    ? 'text-text-muted border-border-subtle hover:text-text-secondary'
                    : 'text-neon border-neon/30 bg-neon/5 hover:bg-neon/10',
                )}
              >
                {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>
              {hintVisible && (
                <div
                  role="status"
                  className={cn(
                    'absolute right-0 top-full mt-1.5 z-50 whitespace-nowrap',
                    'flex items-center gap-1.5 px-2 py-1 rounded-md border',
                    'border-neon/30 bg-surface-raised text-[10px] font-mono text-text-secondary',
                    'shadow-[0_0_10px_rgba(34,211,238,0.15)]',
                    'animate-in fade-in slide-in-from-top-1 duration-200',
                  )}
                >
                  <Volume2 size={10} className="text-neon shrink-0" />
                  Sound on — click to mute
                </div>
              )}
            </div>
          )}
          <SegmentedToggle
            value={state.viewMode}
            onChange={mode => dispatch({ type: 'SET_VIEW_MODE', mode })}
            options={[
              { value: 'grid', label: 'Grid', icon: <LayoutGrid size={13} /> },
              { value: 'table', label: 'Table', icon: <Table size={13} /> },
            ]}
          />
        </div>
      </div>

      {/* Captain gate — surfaces between draft completion and league
          advancing to regular play. The user's team profile is the canonical
          place to actually pick captains; we just nudge them there. */}
      {captainGateOpen && (
        <DraftCaptainGate
          players={players}
          userTeamId={state.userTeamId}
          leagueId={league.id}
          teraCaptainSlots={league.season?.teraCaptainSlots ?? 2}
        />
      )}

      {/* Pick log — collapsible, only when toggled */}
      {pickLogExpanded && isLiveMode && state.allPicks.length > 0 && !isDemoComplete && (
        <DraftPickLog
          picks={state.allPicks}
          playerLookup={playerLookup}
        />
      )}

      {/* Filter bar */}
      <div className="shrink-0">
        <DraftFilterBar
          filters={state.filters}
          onUpdate={filters => dispatch({ type: 'UPDATE_FILTERS', filters })}
          totalCount={TIER_LIST.length}
          filteredCount={filteredPool.length}
        />
      </div>

      {/* Main content: pool + sidebar — fills remaining space */}
      <div className="flex flex-1 mt-1.5 min-h-0 gap-0">
        {/* Pool column: hero + pool + chrome bar stacked (chrome doesn't extend under sidebar) */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* OTC hero — docks above the pool when a draft is active */}
          {isLiveMode && currentPick && !isDemoComplete && (() => {
            const drafter = playerLookup.get(currentPick.playerId);
            if (!drafter) return null;
            return (
              <div className="shrink-0 mb-1.5 rounded-lg border border-border-default bg-surface-raised overflow-hidden">
                <DraftOnTheClock
                  pick={currentPick}
                  player={drafter}
                  timerSeconds={displayTimerSeconds}
                  timerDuration={state.timerDuration}
                  isUserTurn={isUserTurn}
                  totalPicks={state.snakeOrder.length}
                  timerPaused={state.timerPaused}
                  timerEnabled={draftTimerEnabled}
                  topQueuedName={state.draftQueue[0] ?? null}
                  onDraftFromQueue={handleDraftFromQueue}
                  autoDraftQueueEnabled={state.autoDraftQueue}
                />
              </div>
            );
          })()}

          {/* Pool area */}
          {state.viewMode === 'grid' ? (
            <DraftPoolWithRail
              poolByTier={poolByTier}
              ownershipMap={ownershipMap}
              playerLookup={playerLookup}
              rosterLookup={rosterLookup}
              selectedTeamId={state.selectedTeamId}
              isUserPickable={isUserTurn}
              showTierBadges={isLiveMode}
              userMaxAffordableCost={isLiveMode ? userMaxAffordableCost : undefined}
              userConflictRoster={isLiveMode ? userConflictRoster : undefined}
              pointCap={state.pointCap}
              draftQueue={isLiveMode ? state.draftQueue : undefined}
              onCardClick={handleCardClick}
              onCardHoverStart={handleCardHoverStart}
              onCardHoverEnd={handleCardHoverEnd}
            />
          ) : (
            <div className="flex-1 overflow-y-auto rounded-lg border border-border-default bg-surface-raised/50 min-w-0 min-h-0">
              <DraftPoolTable
                pool={filteredPool}
                ownershipMap={ownershipMap}
                playerLookup={playerLookup}
                rosterLookup={rosterLookup}
                selectedTeamId={state.selectedTeamId}
                showTierBadges={isLiveMode}
                userMaxAffordableCost={isLiveMode ? userMaxAffordableCost : undefined}
                onRowClick={handleCardClick}
              />
            </div>
          )}

          {/* Slim chrome bar at the bottom — progress + presence + admin + reset */}
          {showFooter && (
            <div className="shrink-0 mt-1.5 rounded-lg border border-border-default bg-surface-raised overflow-hidden">
              <DraftControlBar
                state={state}
                dispatch={dispatch}
                isDemoComplete={isDemoComplete}
                draftOrder={draftOrder}
                presence={presence}
                wsConnected={wsConnected}
                timerEnabled={draftTimerEnabled}
              />
            </div>
          )}
        </div>

        {/* Team sidebar — always visible, scrolls internally */}
        <DraftTeamSidebar
          teamOrder={draftOrder}
          teamRosters={teamRosters}
          teamPoints={teamPoints}
          selectedTeamId={state.selectedTeamId}
          onSelectTeam={id => dispatch({ type: 'SELECT_TEAM', teamId: id })}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(c => !c)}
          currentDrafterId={currentPick?.playerId ?? null}
          isLiveMode={isLiveMode}
          userTeamId={state.userTeamId}
          pointCap={state.pointCap}
          draftQueue={state.draftQueue}
          onQueueRemove={handleQueueRemove}
          autoDraftQueue={state.autoDraftQueue}
          onToggleAutoDraft={() => dispatch({ type: 'TOGGLE_AUTO_DRAFT_QUEUE' })}
          onDraftFromQueue={handleDraftFromQueue}
          isUserTurn={isUserTurn}
          presence={presence}
        />
      </div>

      {/* Hover card (hide when confirm popover is showing) */}
      {hoverInfo && !confirmPopover && (
        <PokemonHoverCard
          name={hoverInfo.name}
          rect={hoverInfo.rect}
          rosterLookup={rosterLookup}
          ownershipMap={ownershipMap}
          playerLookup={playerLookup}
          onMouseEnter={() => {}}
          onMouseLeave={handleCardHoverEnd}
        />
      )}

      {/* Quick-draft confirmation popover */}
      <DraftConfirmPopover
        name={confirmPopover?.name ?? null}
        anchorRect={confirmPopover?.rect ?? null}
        budgetAfter={popoverBudgetAfter}
        onConfirm={handleConfirmDraft}
        onViewDetails={handleViewDetails}
        onQueue={handleQueueAdd}
        onClose={() => setConfirmPopover(null)}
        rosterLookup={rosterLookup}
        isQueued={confirmPopover ? state.draftQueue.includes(confirmPopover.name) : false}
        queueFull={state.draftQueue.length >= 3}
        isUserTurn={isUserTurn}
        userConflictRoster={isLiveMode ? userConflictRoster : undefined}
        pointCap={state.pointCap}
      />

      {/* Detail sheet */}
      <PokemonDetailSheet
        name={state.detailPokemon}
        onClose={() => dispatch({ type: 'SET_DETAIL', name: null })}
        rosterLookup={rosterLookup}
        ownershipMap={ownershipMap}
        playerLookup={playerLookup}
        canDraft={isUserTurn && !!state.detailPokemon && !ownershipMap.has(state.detailPokemon)}
        onDraft={handleUserPick}
      />
    </div>
    </UserAccentScope>
  );
}
