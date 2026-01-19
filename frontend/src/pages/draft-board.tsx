import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { preloadSprites } from '@/components/pokemon-sprite';
import { LayoutGrid, Table, Zap, History } from 'lucide-react';
import { useDraftState } from './draft-board/use-draft-state';
import { DraftFilterBar } from './draft-board/draft-filter-bar';
import { DraftPoolGrid } from './draft-board/draft-pool-grid';
import { DraftTeamSidebar } from './draft-board/draft-team-sidebar';
import { DraftPoolTable } from './draft-board/draft-pool-table';
import { PokemonHoverCard } from './draft-board/pokemon-hover-card';
import { PokemonDetailSheet } from './draft-board/pokemon-detail-sheet';
import { DraftOnTheClock } from './draft-board/draft-on-the-clock';
import { DraftControlBar } from './draft-board/draft-control-bar';
import { TIER_LIST } from '@/mocks/tier-list';

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
    rosterLookup, playerLookup, isUserTurn, draftOrder,
  } = useDraftState();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{ name: string; rect: DOMRect } | null>(null);

  // Preload sprites for all visible Pokemon in the current filtered pool
  useEffect(() => {
    preloadSprites(filteredPool.map(e => e.name));
  }, [filteredPool]);

  const handleCardClick = useCallback((name: string) => {
    dispatch({ type: 'SET_DETAIL', name });
  }, [dispatch]);

  const handleCardHoverStart = useCallback((name: string, rect: DOMRect) => {
    setHoverInfo({ name, rect });
  }, []);

  const handleCardHoverEnd = useCallback(() => {
    setHoverInfo(null);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Live mode: on-the-clock banner */}
      {state.mode === 'live' && currentPick && playerLookup.get(currentPick.playerId) && (
        <DraftOnTheClock
          pick={currentPick}
          player={playerLookup.get(currentPick.playerId)!}
          timerSeconds={state.timerSeconds}
          isUserTurn={isUserTurn}
          totalPicks={state.allPicks.length}
        />
      )}

      {/* Page header */}
      <div className="flex items-center justify-between gap-4 pb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-heading font-bold text-text-primary">Draft Board</h1>
          <SegmentedToggle
            value={state.mode}
            onChange={mode => dispatch({ type: 'SET_MODE', mode })}
            options={[
              { value: 'season', label: 'Season', icon: <History size={13} />, activeClass: 'bg-neon/10 text-neon' },
              { value: 'live', label: 'Live Demo', icon: <Zap size={13} />, activeClass: 'bg-pink/10 text-pink' },
            ]}
          />
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
        />
      </div>

      {/* Live mode: control bar */}
      {state.mode === 'live' && (
        <DraftControlBar
          state={state}
          dispatch={dispatch}
          currentPick={currentPick}
          playerLookup={playerLookup}
        />
      )}

      {/* Hover card */}
      {hoverInfo && (
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

      {/* Detail sheet */}
      <PokemonDetailSheet
        name={state.detailPokemon}
        onClose={() => dispatch({ type: 'SET_DETAIL', name: null })}
        rosterLookup={rosterLookup}
        ownershipMap={ownershipMap}
        playerLookup={playerLookup}
        canDraft={isUserTurn && !!state.detailPokemon && !ownershipMap.has(state.detailPokemon)}
        onDraft={name => dispatch({ type: 'USER_PICK', pokemonName: name })}
      />
    </div>
  );
}
