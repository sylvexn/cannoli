import { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { preloadSprites } from '@/components/pokemon-sprite';
import { Badge } from '@/components/ui/badge';
import { LayoutGrid, Table, Zap, History, Radio, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDraftState } from './draft-board/use-draft-state';
import { DraftFilterBar } from './draft-board/draft-filter-bar';
import { DraftPoolGrid } from './draft-board/draft-pool-grid';
import { DraftTeamSidebar } from './draft-board/draft-team-sidebar';
import { DraftPoolTable } from './draft-board/draft-pool-table';
import { PokemonHoverCard } from './draft-board/pokemon-hover-card';
import { PokemonDetailSheet } from './draft-board/pokemon-detail-sheet';
import { DraftOnTheClock } from './draft-board/draft-on-the-clock';
import { DraftControlBar } from './draft-board/draft-control-bar';
import { DraftPickLog } from './draft-board/draft-pick-log';
import { DraftConfirmPopover } from './draft-board/draft-confirm-popover';
import { TIER_LIST } from '@/data/tier-list';
import { getTierEntry } from '@/data/tier-list';

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
  const {
    state, dispatch,
    ownershipMap, filteredPool, poolByTier,
    currentPick, teamRosters, teamPoints,
    rosterLookup, playerLookup, isUserTurn, isDemoComplete,
    draftOrder, handleUserPick, wsConnected, userBudgetRemaining,
  } = useDraftState();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{ name: string; rect: DOMRect } | null>(null);

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
    // During draft, show popover for free agents (for drafting or queueing)
    if (isLiveMode && !ownershipMap.has(name)) {
      const tierEntry = getTierEntry(name);
      const affordable = tierEntry && userBudgetRemaining != null && tierEntry.tier <= userBudgetRemaining;
      if (affordable || !isUserTurn) {
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
    dispatch({ type: 'QUEUE_ADD', name });
    toast.info(`${name} added to queue`);
  }, [dispatch]);

  const handleQueueRemove = useCallback((name: string) => {
    dispatch({ type: 'QUEUE_REMOVE', name });
  }, [dispatch]);

  const handleDraftFromQueue = useCallback(() => {
    if (!isUserTurn || state.draftQueue.length === 0) return;
    const name = state.draftQueue[0];
    if (!ownershipMap.has(name)) {
      handleUserPick(name);
    }
  }, [isUserTurn, state.draftQueue, ownershipMap, handleUserPick]);

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

  return (
    <div className="flex flex-col h-full">
      {/* Draft mode: on-the-clock banner */}
      {isLiveMode && currentPick && playerLookup.get(currentPick.playerId) && !isDemoComplete && (
        <DraftOnTheClock
          pick={currentPick}
          player={playerLookup.get(currentPick.playerId)!}
          timerSeconds={state.timerSeconds}
          timerDuration={state.timerDuration}
          isUserTurn={isUserTurn}
          totalPicks={state.snakeOrder.length}
          timerPaused={state.timerPaused}
        />
      )}

      {/* Draft mode: recent picks log */}
      {isLiveMode && state.allPicks.length > 0 && !isDemoComplete && (
        <DraftPickLog
          picks={state.allPicks}
          playerLookup={playerLookup}
        />
      )}

      {/* Page header */}
      <div className="flex items-center justify-between gap-4 pb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-mono font-bold tracking-tight uppercase">
            <span className="text-draw">Draft</span>
            <span className="text-text-primary ml-1">Board</span>
          </h1>
          <SegmentedToggle
            value={state.mode}
            onChange={mode => dispatch({ type: 'SET_MODE', mode })}
            options={[
              { value: 'season', label: 'Season', icon: <History size={13} />, activeClass: 'bg-neon/10 text-neon' },
              { value: 'demo', label: 'Demo', icon: <Zap size={13} />, activeClass: 'bg-pink/10 text-pink' },
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

        <SegmentedToggle
          value={state.viewMode}
          onChange={mode => dispatch({ type: 'SET_VIEW_MODE', mode })}
          options={[
            { value: 'grid', label: 'Grid', icon: <LayoutGrid size={13} /> },
            { value: 'table', label: 'Table', icon: <Table size={13} /> },
          ]}
        />
      </div>

      {/* Filter bar */}
      <DraftFilterBar
        filters={state.filters}
        onUpdate={filters => dispatch({ type: 'UPDATE_FILTERS', filters })}
        totalCount={TIER_LIST.length}
        filteredCount={filteredPool.length}
      />

      {/* Main content: pool + sidebar */}
      <div className="flex flex-1 mt-3 min-h-0 gap-0">
        {/* Pool area */}
        <div className="flex-1 overflow-y-auto rounded-lg border border-border-default bg-surface-raised/50 min-w-0">
          {state.viewMode === 'grid' ? (
            <DraftPoolGrid
              poolByTier={poolByTier}
              ownershipMap={ownershipMap}
              playerLookup={playerLookup}
              rosterLookup={rosterLookup}
              selectedTeamId={state.selectedTeamId}
              isUserPickable={isUserTurn}
              showTierBadges={isLiveMode}
              userBudgetRemaining={isLiveMode ? userBudgetRemaining : undefined}
              draftQueue={isLiveMode ? state.draftQueue : undefined}
              onCardClick={handleCardClick}
              onCardHoverStart={handleCardHoverStart}
              onCardHoverEnd={handleCardHoverEnd}
            />
          ) : (
            <DraftPoolTable
              pool={filteredPool}
              ownershipMap={ownershipMap}
              playerLookup={playerLookup}
              rosterLookup={rosterLookup}
              selectedTeamId={state.selectedTeamId}
              onRowClick={handleCardClick}
            />
          )}
        </div>

        {/* Team sidebar */}
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
        />
      </div>

      {/* Draft mode: control bar */}
      {(state.mode === 'demo' || state.mode === 'live') && (
        <DraftControlBar
          state={state}
          dispatch={dispatch}
          isDemoComplete={isDemoComplete}
          draftOrder={draftOrder}
        />
      )}

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
  );
}
