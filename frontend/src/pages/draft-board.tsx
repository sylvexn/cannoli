import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { preloadSprites } from '@/components/pokemon-sprite';
import { Monitor, LayoutGrid, Table } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { UserAccentScope } from '@/components/user-accent-scope';
import { useDraftState } from './draft-board/use-draft-state';
import { useDraftMute } from './draft-board/use-draft-mute';
import { DraftFilterBar } from './draft-board/draft-filter-bar';
import { DraftPoolWithRail } from './draft-board/draft-pool-with-rail';
import { DraftPoolTable } from './draft-board/draft-pool-table';
import { PokemonDetailSheet } from './draft-board/pokemon-detail-sheet';
import { DraftControlBar } from './draft-board/draft-control-bar';
import { OnTheClockBar, formatClock } from './draft-board/room/on-the-clock-bar';
import { WarRoomBoard } from './draft-board/room/war-room-board';
import { PoolPalette } from './draft-board/room/pool-palette';
import { PaletteSide } from './draft-board/room/palette-side';
import { usePaletteOpen } from './draft-board/room/use-palette-open';
import { RoomModeStrip } from './draft-board/room/room-mode-strip';
import { useRoomMode } from './draft-board/room/use-room-mode';
import { DraftLobby } from './draft-board/room/draft-lobby';
import { useAppData } from '@/lib/app-data-context';
import { DraftPokemonPopover, type PokemonPopoverMode } from './draft-board/draft-pokemon-popover';
import { DraftCaptainGate } from './draft-board/draft-captain-gate';
import { DraftCompleteSummary } from './draft-board/draft-complete-summary';
import { DraftTopBar, ClusterButton, ClusterDensity } from './draft-board/draft-top-bar';
import type { CardDensity } from './draft-board/pokemon-compact-card';
import { getTierList, getTierEntry, getBanned } from '@/data/tier-list';
import type { DraftSource } from './draft-board/types';

const DENSITY_STORAGE_KEY = 'draft.density';
const DENSITY_SIZES: Record<CardDensity, string> = {
  compact: '64px',
  comfortable: '88px',
  detailed: '108px',
};

function readStoredDensity(): CardDensity {
  if (typeof window === 'undefined') return 'comfortable';
  const raw = window.localStorage.getItem(DENSITY_STORAGE_KEY);
  return raw === 'compact' || raw === 'detailed' ? raw : 'comfortable';
}

import { withViewTransition } from '@/lib/view-transition';

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
    league, format, players,
    ownershipMap, filteredPool, poolByTier, matchReasons,
    currentPick, teamRosters, teamPoints,
    rosterLookup, playerLookup, isUserTurn, isDraftComplete,
    draftOrder, handleUserPick, wsConnected: realWsConnected, presence, userBudgetRemaining,
    userMaxAffordableCost, selfAffordCap, userConflictRoster,
    currentDrafterMaxAffordableCost, currentDrafterConflictRoster,
    draftTimerEnabled, draftDemoVisible,
    displayTimerSeconds,
    pickQueue, pickAnnouncement, autoPickCurrent,
  } = useDraftState({ source });
  const { refreshLeagues } = useAppData();
  const room = useRoomMode({ state, dispatch });
  // Dev state-jumper fixtures can fake a dropped socket / open captain gate.
  const wsConnected = room.flags.wsConnected ?? realWsConnected;
  const strip = <RoomModeStrip room={room} onAutoPick={autoPickCurrent} />;

  const isPractice = source === 'simulator';

  // One-time "sound on — click to mute" chip. Auto-dismisses after 5s and
  // records the flag so it never resurfaces.
  const [hintVisible, setHintVisible] = useState(false);

  // Captain gate is open while every team has finished drafting (server source +
  // isDraftComplete) but the league is still in phase=draft (= some team
  // hasn't locked captains yet). Once the last team locks, the backend flips
  // phase → regular and a fresh /api/leagues fetch closes the gate.
  const captainGateOpen = room.flags.captainGateOpen ?? (state.source === 'server'
    && isDraftComplete
    && league.season?.phase === 'draft'
    && players.length > 0
    && !players.every(p => p.captainsLocked));

  // Mobile viewport detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Card density toggle — controls --card-size CSS var on the page root.
  const [density, setDensity] = useState<CardDensity>(() => readStoredDensity());
  useEffect(() => {
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
    } catch {
      // localStorage may be unavailable (private mode) — silently skip persistence.
    }
  }, [density]);

  // Unified pokemon popover state — replaces the old hover-card + confirm-popover
  // pair. `mode` decides what content to render (preview vs quick-draft vs
  // detail-summary); the same anchor + name flow through all variants so the
  // sprite morphs cleanly as the mode changes.
  const [popover, setPopover] = useState<{
    name: string;
    rect: DOMRect;
    mode: PokemonPopoverMode;
  } | null>(null);

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

  // Format-banned Pokemon appear (marked, undraftable) in both views when no
  // ownership/type/chip filter would exclude them; free-text matches by name.
  const bannedNames = useMemo(() => {
    const f = state.filters;
    if (f.ownership !== 'all' || f.types.length > 0 || f.searchChips.length > 0) return [];
    const q = f.search.trim().toLowerCase();
    return getBanned(format).filter(n => !q || n.toLowerCase().includes(q)).sort();
  }, [state.filters, format]);

  const handleCardClick = useCallback((name: string) => {
    // During an active draft, upgrade the popover into 'quick-draft' mode for
    // free agents (so the user can draft, queue, or read the conflict reason
    // inline). Open even if there's a conflict so the reason is readable.
    if (isDraftRunning && !ownershipMap.has(name)) {
      const tierEntry = getTierEntry(name, format);
      const fitsRawBudget = tierEntry && userBudgetRemaining != null && tierEntry.tier <= userBudgetRemaining;
      if (fitsRawBudget || !isUserTurn) {
        const rect = cardRectsRef.current.get(name) ?? popover?.rect;
        if (rect) {
          withViewTransition(() => setPopover({ name, rect, mode: 'quick-draft' }));
          return;
        }
      }
    }
    // Outside of an active draft (or for owned mons in any view) jump straight
    // to the detail sheet.
    withViewTransition(() => dispatch({ type: 'SET_DETAIL', name }));
  }, [dispatch, isDraftRunning, isUserTurn, ownershipMap, userBudgetRemaining, popover, format]);

  const handleCardHoverStart = useCallback((name: string, rect: DOMRect) => {
    cardRectsRef.current.set(name, rect);
    setHovered(name);
    setPopover(prev => {
      // Don't downgrade an active interactive popover (quick-draft / detail-summary)
      // back to a hover preview when the cursor drifts to a sibling card.
      if (prev && prev.mode !== 'preview') return prev;
      return { name, rect, mode: 'preview' };
    });
  }, []);

  const handleCardHoverEnd = useCallback(() => {
    setPopover(prev => (prev && prev.mode === 'preview' ? null : prev));
  }, []);

  const handleQueueAdd = useCallback((name: string) => {
    // Block queueing Pokemon that wouldn't fit even ignoring conflicts.
    // We compare to userMaxAffordableCost so a t10 mon with 8pt headroom (because
    // 2pt is reserved for the remaining slot) is also blocked.
    const cap = userMaxAffordableCost ?? userBudgetRemaining;
    if (cap != null) {
      const entry = getTierEntry(name, format);
      if (entry && entry.tier > cap) {
        toast.error(`Can't queue ${name} — costs ${entry.tier}pt, only ${cap}pt available after reserving for remaining picks`);
        return;
      }
    }
    dispatch({ type: 'QUEUE_ADD', name });
    toast.info(`${name} added to queue`);
  }, [dispatch, userBudgetRemaining, userMaxAffordableCost, format]);

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

  // Show the one-time mute hint on the first live pick.
  // Cry playback is owned by usePickAnimationQueue (fires on the landing phase).
  const prevPickCountRef = useRef(state.allPicks.length);
  useEffect(() => {
    const prev = prevPickCountRef.current;
    prevPickCountRef.current = state.allPicks.length;
    if (isDraftRunning && state.allPicks.length > prev && state.allPicks.length > 0) {
      // Show the mute hint the first time a cry is about to play (the queue
      // will play it shortly when the pick lands). Hint is independent of the
      // actual cry firing — it only nudges users toward the mute control.
      if (!muted && !hintShown) {
        setHintVisible(true);
        markHintShown();
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
    setPopover(null);
  }, [handleUserPick]);

  const handleViewDetails = useCallback((name: string) => {
    // Closing the popover and opening the sheet within a single view
    // transition lets the sprite morph from popover → sheet hero.
    withViewTransition(() => {
      setPopover(null);
      dispatch({ type: 'SET_DETAIL', name });
    });
  }, [dispatch]);

  const handlePopoverModeChange = useCallback((mode: PokemonPopoverMode) => {
    setPopover(prev => (prev ? { ...prev, mode } : prev));
  }, []);

  const handlePopoverClose = useCallback(() => setPopover(null), []);

  // Compute budget after pick for the popover when it's actionable.
  const popoverBudgetAfter = useMemo(() => {
    if (!popover || popover.mode === 'preview') return undefined;
    const tierEntry = getTierEntry(popover.name, format);
    if (tierEntry && userBudgetRemaining != null) return userBudgetRemaining - tierEntry.tier;
    return undefined;
  }, [popover, userBudgetRemaining, format]);

  const rosterSize = league.season?.rosterSize ?? 10;
  const showOnTheClockGlow = isDraftRunning && isUserTurn && !isDraftComplete;
  const [paletteOpen, setPaletteOpen] = usePaletteOpen(showOnTheClockGlow && currentPick ? currentPick.overallPick : null);

  // Cards unmount with the palette, so a lingering hover preview must go too.
  useEffect(() => {
    if (!paletteOpen) setPopover(prev => (prev && prev.mode === 'preview' ? null : prev));
  }, [paletteOpen]);

  // Hovered card = target of Q / Enter / the footer button; falls back to queue #1.
  const [hovered, setHovered] = useState<string | null>(null);
  const target = hovered && !ownershipMap.has(hovered) ? hovered : state.draftQueue[0] ?? null;
  const canDraft = isDraftRunning && isUserTurn && !!target;
  const handleDraftTarget = useCallback(() => { if (target) handleUserPick(target); }, [target, handleUserPick]);
  const handlePaletteQueue = useCallback(() => {
    if (!hovered || ownershipMap.has(hovered)) return;
    if (state.draftQueue.includes(hovered)) handleQueueRemove(hovered);
    else handleQueueAdd(hovered);
  }, [hovered, ownershipMap, state.draftQueue, handleQueueAdd, handleQueueRemove]);

  const userRoster = state.userTeamId ? teamRosters.get(state.userTeamId) ?? [] : [];
  const userPointsLeft = state.pointCap - (state.userTeamId ? teamPoints.get(state.userTeamId) ?? 0 : 0);
  const handleOpenPokemon = useCallback((name: string) => dispatch({ type: 'SET_DETAIL', name }), [dispatch]);

  // Mobile warning for active draft participants
  if (isMobile && isDraftRunning && state.userTeamId && !isDraftComplete) {
    return (
      <>{strip}<div className="flex flex-col items-center justify-center h-64 gap-4 px-6 text-center">
        <Monitor size={40} className="text-text-muted" />
        <h2 className="text-lg font-mono font-bold text-text-primary uppercase">Desktop Required</h2>
        <p className="text-sm text-text-muted max-w-sm">
          Draft participation requires a desktop browser. You can spectate from mobile.
        </p>
      </div></>
    );
  }

  // Post-draft summary surface — replaces the running layout once status === 'complete'.
  if (state.view === 'active' && state.status === 'complete') {
    return (
      <UserAccentScope user={user} className="contents">
        <div className="flex flex-col h-full overflow-hidden">
          {strip}
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
  // Lobby = before the first pick: reducer 'configuring' (server not_started,
  // rehearsal setup, or the lobby fixture), or a server-source pre-draft league
  // that hasn't hydrated a draft yet.
  const phase = league.season?.phase;
  const showLobby = (state.view === 'active' && state.status === 'configuring')
    || (state.source === 'server' && state.status === 'idle' && state.allPicks.length === 0
      && (phase === 'predraft' || phase === 'draft'));
  const drafter = currentPick ? playerLookup.get(currentPick.playerId) : undefined;
  const showClock = isDraftRunning && !!currentPick && !!drafter && !isDraftComplete;
  const drafterRoster = drafter ? teamRosters.get(drafter.id) ?? [] : [];
  const clockText = draftTimerEnabled && showClock ? formatClock(displayTimerSeconds) : null;
  const hasTeam = isDraftRunning && !!state.userTeamId && playerLookup.has(state.userTeamId);
  const draftLabel = target
    ? `Draft ${target}${state.draftQueue[0] === target && hovered !== target ? ' (queue #1)' : ''}`
    : 'Draft';

  return (
    <UserAccentScope user={user} className="contents">
    <div
      className={cn('flex flex-col h-full overflow-hidden', showOnTheClockGlow && 'pulse-glow')}
      style={{ ['--card-size' as never]: DENSITY_SIZES[density] }}
    >
      {strip}
      <span className="sr-only" aria-live="polite">{pickAnnouncement}</span>

      <DraftTopBar
        state={state}
        dispatch={dispatch}
        isPractice={isPractice}
        draftDemoVisible={draftDemoVisible}
        isDraftRunning={isDraftRunning}
        leagueId={league.id}
        wsConnected={wsConnected}
        showPoolButton={!showClock}
        onOpenPool={() => setPaletteOpen(true)}
        muted={muted}
        onToggleMuted={toggleMuted}
        hintVisible={hintVisible}
      />

      {/* Captain gate — nudges to the team profile between draft end and league advance. */}
      {captainGateOpen && !isDraftComplete && (
        <DraftCaptainGate
          players={players}
          userTeamId={state.userTeamId}
          leagueId={league.id}
          teraCaptainSlots={league.season?.teraCaptainSlots ?? 2}
        />
      )}

      {showClock && currentPick && drafter && (
        <OnTheClockBar
          pick={currentPick}
          player={drafter}
          timerSeconds={displayTimerSeconds}
          timerDuration={state.timerDuration}
          timerEnabled={draftTimerEnabled}
          timerPaused={state.timerPaused}
          isUserTurn={isUserTurn}
          totalPicks={state.snakeOrder.length}
          pointsLeft={state.pointCap - (teamPoints.get(drafter.id) ?? 0)}
          slotsLeft={Math.max(0, rosterSize - drafterRoster.length)}
          topQueuedName={state.draftQueue[0] ?? null}
          onDraftFromQueue={handleDraftFromQueue}
          onOpenPool={() => setPaletteOpen(true)}
        />
      )}

      {showLobby ? (
        <DraftLobby
          teams={players}
          draftOrder={league.draftOrder ?? null}
          draftOrderLocked={league.draftOrderLocked}
          presence={presence}
          userTeamId={state.userTeamId}
          draftStarted={false}
          timerSeconds={state.timerDuration || undefined}
          onRehearse={room.rehearse}
          onOrderSaved={refreshLeagues}
        />
      ) : (
      <WarRoomBoard
        draftOrder={draftOrder}
        picks={state.allPicks}
        snakeOrder={state.snakeOrder}
        rosterSize={rosterSize}
        pointCap={state.pointCap}
        teamPoints={teamPoints}
        selectedTeamId={state.selectedTeamId}
        userTeamId={state.userTeamId}
        currentPick={showClock ? currentPick : null}
        landingPick={pickQueue.current?.overallPick ?? null}
        clockLabel={clockText}
        onSelectTeam={id => dispatch({ type: 'SELECT_TEAM', teamId: id })}
        onOpenPokemon={handleOpenPokemon}
      />
      )}

      {showFooter && (
        <div className="shrink-0 mt-1.5 rounded-lg border border-border-default bg-surface-raised overflow-hidden">
          <DraftControlBar
            state={state}
            dispatch={dispatch}
            isDraftComplete={isDraftComplete}
            draftOrder={draftOrder}
            presence={presence}
            timerEnabled={draftTimerEnabled}
          />
        </div>
      )}

      <PoolPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        blocked={(!!popover && popover.mode !== 'preview') || !!state.detailPokemon}
        clock={clockText}
        onQueueKey={hasTeam ? handlePaletteQueue : undefined}
        onDraft={hasTeam ? handleDraftTarget : undefined}
        canDraft={canDraft}
        draftLabel={draftLabel}
        filters={
          <DraftFilterBar
            filters={state.filters}
            onUpdate={filters => dispatch({ type: 'UPDATE_FILTERS', filters })}
            totalCount={getTierList(format).length}
            filteredCount={filteredPool.length}
            showAffordableToggle={hasTeam}
            affordCap={selfAffordCap}
            format={league.format ?? 'gen9natdex'}
          />
        }
        viewControls={
          <TooltipProvider delay={300}>
            <div className="flex items-center rounded-md border border-border-default bg-surface-raised overflow-hidden divide-x divide-border-subtle">
              <ClusterButton
                onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode: state.viewMode === 'grid' ? 'table' : 'grid' })}
                ariaLabel={state.viewMode === 'grid' ? 'Switch to table view' : 'Switch to shelf view'}
                tooltip={state.viewMode === 'grid' ? 'Switch to table view' : 'Switch to shelf view'}
              >
                {state.viewMode === 'grid' ? <LayoutGrid size={13} /> : <Table size={13} />}
              </ClusterButton>
              {state.viewMode === 'grid' && <ClusterDensity density={density} onChange={setDensity} />}
            </div>
          </TooltipProvider>
        }
        side={hasTeam ? (
          <PaletteSide
            pointCap={state.pointCap}
            pointsLeft={userPointsLeft}
            slotsLeft={Math.max(0, rosterSize - userRoster.length)}
            maxNow={userMaxAffordableCost}
            queue={state.draftQueue}
            autoDraft={state.autoDraftQueue}
            roster={userRoster}
            format={format}
            onQueueRemove={handleQueueRemove}
            onQueueReorder={queue => dispatch({ type: 'QUEUE_REORDER', queue })}
            onToggleAuto={() => dispatch({ type: 'TOGGLE_AUTO_DRAFT_QUEUE' })}
            onOpenPokemon={handleOpenPokemon}
          />
        ) : undefined}
      >
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
            drafterMaxAffordableCost={isDraftRunning ? currentDrafterMaxAffordableCost : undefined}
            drafterConflictRoster={isDraftRunning ? currentDrafterConflictRoster : undefined}
            pointCap={state.pointCap}
            draftQueue={isDraftRunning ? state.draftQueue : undefined}
            density={density}
            animatingPokemonName={null}
            format={format}
            matchReasons={matchReasons}
            bannedNames={bannedNames}
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
              drafterConflictRoster={isDraftRunning ? currentDrafterConflictRoster : undefined}
              drafterMaxAffordableCost={isDraftRunning ? currentDrafterMaxAffordableCost : undefined}
              pointCap={state.pointCap}
              matchReasons={matchReasons}
              bannedNames={bannedNames}
              onRowClick={handleCardClick}
            />
          </div>
        )}
      </PoolPalette>

      {/* Quick-draft / preview popover and detail sheet sit above the palette (z-60 / z-50). */}
      <DraftPokemonPopover
        name={popover?.name ?? null}
        anchorRect={popover?.rect ?? null}
        mode={popover?.mode ?? 'preview'}
        rosterLookup={rosterLookup}
        ownershipMap={ownershipMap}
        playerLookup={playerLookup}
        isUserTurn={isUserTurn}
        budgetAfter={popoverBudgetAfter}
        isQueued={popover ? state.draftQueue.includes(popover.name) : false}
        queueFull={state.draftQueue.length >= 3}
        userConflictRoster={isDraftRunning ? userConflictRoster : undefined}
        pointCap={state.pointCap}
        animatingPokemonName={null}
        format={format}
        onClose={handlePopoverClose}
        onModeChange={handlePopoverModeChange}
        onConfirmDraft={handleConfirmDraft}
        onQueueAdd={handleQueueAdd}
        onOpenDetailSheet={handleViewDetails}
      />

      <PokemonDetailSheet
        name={state.detailPokemon}
        onClose={() => dispatch({ type: 'SET_DETAIL', name: null })}
        rosterLookup={rosterLookup}
        ownershipMap={ownershipMap}
        playerLookup={playerLookup}
        canDraft={isUserTurn && !!state.detailPokemon && !ownershipMap.has(state.detailPokemon)}
        onDraft={handleUserPick}
        animatingPokemonName={null}
        format={format}
      />
    </div>
    </UserAccentScope>
  );
}

/** /draft/practice route entry — same page, simulator source. */
export function DraftPracticePage() {
  return <DraftBoardPage source="simulator" />;
}
