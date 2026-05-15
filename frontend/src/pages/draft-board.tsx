import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { preloadSprites } from '@/components/pokemon-sprite';
import { Badge } from '@/components/ui/badge';
import {
  LayoutGrid, Table, History, Radio, Wifi, Loader2, Monitor, ScrollText,
  Volume2, VolumeX, FlaskConical, Zap,
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
import { DraftCompleteSummary } from './draft-board/draft-complete-summary';
import { SegmentedToggle } from './draft-board/segmented-toggle';
import { TIER_LIST } from '@/data/tier-list';
import { getTierEntry } from '@/data/tier-list';
import { playCry } from '@/lib/pokemon';
import type { DraftSource, DraftView } from './draft-board/types';

interface DraftBoardPageProps {
  /**
   * Initial draft source. Defaults to 'server' for the standard /league/.../draft
   * route. The /draft/practice route mounts this page with 'simulator' so it
   * runs the client-side AI engine instead of connecting to the WS.
   */
  source?: DraftSource;
}

export function DraftBoardPage({ source = 'server' }: DraftBoardPageProps = {}) {
  const { user } = useAuth();
  const { muted, toggleMuted, hintShown, markHintShown } = useDraftMute();
  const {
    state, dispatch,
    league, players,
    ownershipMap, filteredPool, poolByTier,
    currentPick, teamRosters, teamPoints,
    rosterLookup, playerLookup, isUserTurn, isDraftComplete,
    draftOrder, handleUserPick, wsConnected, presence, userBudgetRemaining,
    userMaxAffordableCost, userConflictRoster,
    draftTimerEnabled, draftDemoVisible,
    displayTimerSeconds,
  } = useDraftState({ source });

  const isPractice = source === 'simulator';

  // One-time "sound on — click to mute" chip. Auto-dismisses after 5s and
  // records the flag so it never resurfaces.
  const [hintVisible, setHintVisible] = useState(false);

  // Captain gate is open while every team has finished drafting (server source +
  // isDraftComplete) but the league is still in phase=draft (= some team
  // hasn't locked captains yet). Once the last team locks, the backend flips
  // phase → regular and a fresh /api/leagues fetch closes the gate.
  const captainGateOpen = state.source === 'server'
    && isDraftComplete
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

  // True whenever a draft is on the clock (running). Was previously called
  // `isLiveMode` and conflated "the draft is happening" with "we're connected
  // to live". Renamed so its meaning is unambiguous post-refactor.
  const isDraftRunning = state.view === 'active' && state.status === 'running';

  const handleCardClick = useCallback((name: string) => {
    // During an active draft, show popover for free agents (for drafting or queueing).
    // Open the popover even if the pick has a conflict so the user can read why.
    if (isDraftRunning && !ownershipMap.has(name)) {
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
  }, [dispatch, isDraftRunning, isUserTurn, ownershipMap, userBudgetRemaining]);

  const handleCardHoverStart = useCallback((name: string, rect: DOMRect) => {
    cardRectsRef.current.set(name, rect);
    if (!confirmPopover) {
      setHoverInfo({ name, rect });
    }
  }, [confirmPopover]);

  const handleCardHoverEnd = useCallback(() => {
    setHoverInfo(null);
  }, []);

  const handleQueueAdd = useCallback((name: string) => {
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

  // Play Pokemon cry on EVERY broadcast pick (server or simulator). All
  // connected clients hear the cry on every pick. Per-user mute toggle
  // controls audibility. Also auto-expands the pick log so the celebration
  // sequence is always seen.
  const prevPickCountRef = useRef(state.allPicks.length);
  useEffect(() => {
    const prev = prevPickCountRef.current;
    prevPickCountRef.current = state.allPicks.length;
    if (isDraftRunning && state.allPicks.length > prev && state.allPicks.length > 0) {
      const lastPick = state.allPicks[state.allPicks.length - 1];
      setPickLogExpanded(true);
      if (lastPick.pokemonName && !muted) {
        playCry(lastPick.pokemonName, 0.15);
        if (!hintShown) {
          setHintVisible(true);
          markHintShown();
        }
      }
    }
  }, [state.allPicks.length, isDraftRunning, muted, hintShown, markHintShown]);

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
    if (prev.length > 0 && isDraftRunning) {
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
  }, [state.draftQueue, ownershipMap, isDraftRunning, playerLookup]);

  const handleConfirmDraft = useCallback((name: string) => {
    handleUserPick(name);
    setConfirmPopover(null);
  }, [handleUserPick]);

  const handleViewDetails = useCallback((name: string) => {
    setConfirmPopover(null);
    dispatch({ type: 'SET_DETAIL', name });
  }, [dispatch]);

  const popoverBudgetAfter = confirmPopover
    ? (() => {
        const tierEntry = getTierEntry(confirmPopover.name);
        if (tierEntry && userBudgetRemaining != null) return userBudgetRemaining - tierEntry.tier;
        return undefined;
      })()
    : undefined;

  // Mobile warning for active draft participants
  if (isMobile && isDraftRunning && state.userTeamId && !isDraftComplete) {
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

  // Post-draft summary surface — replaces the running layout once status === 'complete'.
  if (state.view === 'active' && state.status === 'complete') {
    return (
      <UserAccentScope user={user} className="contents">
        <div className="flex flex-col h-full overflow-hidden">
          <DraftCompleteSummary
            picks={state.allPicks}
            draftOrder={draftOrder}
            teamRosters={teamRosters}
            teamPoints={teamPoints}
            pointCap={state.pointCap}
            players={players}
            userTeamId={state.userTeamId}
            leagueId={league.id}
            teraCaptainSlots={league.season?.teraCaptainSlots ?? 2}
            showCaptainGate={!!captainGateOpen}
            onBackToHistory={() => dispatch({ type: 'SET_VIEW', view: 'history' })}
          />
        </div>
      </UserAccentScope>
    );
  }

  const showFooter = state.view === 'active';

  // Pulse-glow on the draft room body when it's THIS user's turn — peripheral
  // signal to remove "did I miss my turn?" anxiety. Color = user accent.
  const showOnTheClockGlow = isDraftRunning && isUserTurn && !isDraftComplete;

  // Top-bar segmented toggle: History vs Live. Demo (simulator) is reachable
  // via /draft/practice instead of being a peer toggle.
  const viewToggleValue: DraftView = state.view;

  return (
    <UserAccentScope user={user} className="contents">
    <div className={cn(
      'flex flex-col h-full overflow-hidden',
      showOnTheClockGlow && 'pulse-glow',
    )}>
      {/* Top bar: title + view + connection — always compact */}
      <div className="flex items-center justify-between gap-3 pb-1.5 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-mono font-bold tracking-tight uppercase">
            <span className="text-draw">Draft</span>
            <span className="text-text-primary ml-1">Board</span>
            {isPractice && (
              <span className="ml-2 text-[10px] font-mono uppercase tracking-widest text-pink/80 align-middle">
                Practice
              </span>
            )}
          </h1>
          <Link
            to="/rules"
            className="hidden md:inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-pink transition-colors"
          >
            <ScrollText size={11} />
            Rules
          </Link>
          {/* Practice link — gated by admin draftDemoVisible setting. Hidden when
              we're already on the practice route. */}
          {!isPractice && draftDemoVisible && (
            <Link
              to={`/league/${league.id}/draft/practice`}
              className="hidden md:inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-pink transition-colors"
              title="Open the client-side practice draft"
            >
              <FlaskConical size={11} />
              Practice
            </Link>
          )}
          {/* Practice route exposes only the active view (simulator); we hide
              the History/Live toggle so users don't accidentally land in
              read-only history while testing. */}
          {!isPractice && (
            <SegmentedToggle
              value={viewToggleValue}
              onChange={view => dispatch({ type: 'SET_VIEW', view, source: 'server' })}
              options={[
                { value: 'history' as const, label: 'History', icon: <History size={13} />, activeClass: 'bg-neon/10 text-neon' },
                { value: 'active' as const, label: 'Live', icon: <Radio size={13} />, activeClass: 'bg-win/10 text-win' },
              ]}
            />
          )}
          {isPractice && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1.5 px-2 py-0.5 font-mono text-pink border-pink/30 bg-pink/10"
            >
              <Zap size={10} />
              Simulator
            </Badge>
          )}
          {!isPractice && state.view === 'active' && state.source === 'server' && (
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
          {isDraftRunning && state.allPicks.length > 0 && !isDraftComplete && (
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

          {isDraftRunning && (
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
          place to actually pick captains; we just nudge them there.
          Only shown during running (not complete — the summary surface owns it then). */}
      {captainGateOpen && !isDraftComplete && (
        <DraftCaptainGate
          players={players}
          userTeamId={state.userTeamId}
          leagueId={league.id}
          teraCaptainSlots={league.season?.teraCaptainSlots ?? 2}
        />
      )}

      {/* Pick log — collapsible, only when toggled */}
      {pickLogExpanded && isDraftRunning && state.allPicks.length > 0 && !isDraftComplete && (
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
          {isDraftRunning && currentPick && !isDraftComplete && (() => {
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
              showTierBadges={isDraftRunning}
              userMaxAffordableCost={isDraftRunning ? userMaxAffordableCost : undefined}
              userConflictRoster={isDraftRunning ? userConflictRoster : undefined}
              pointCap={state.pointCap}
              draftQueue={isDraftRunning ? state.draftQueue : undefined}
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
                showTierBadges={isDraftRunning}
                userMaxAffordableCost={isDraftRunning ? userMaxAffordableCost : undefined}
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
                isDraftComplete={isDraftComplete}
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
          isLiveMode={isDraftRunning}
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
        userConflictRoster={isDraftRunning ? userConflictRoster : undefined}
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

/** /draft/practice route entry — same page, simulator source. */
export function DraftPracticePage() {
  return <DraftBoardPage source="simulator" />;
}
