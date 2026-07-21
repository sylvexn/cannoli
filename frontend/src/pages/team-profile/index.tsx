import { useParams, Link, useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/components/empty-state';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { getTermCost, canBeTeraCaptain, DEFAULT_FORMAT } from '@/data/tier-list';
import type { Player, RosterPokemon } from '@/lib/types';
import { DEFAULT_LEAGUE_CONFIG } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';
import { rosterPointsUsed, teraCaptainCount } from '@/lib/roster';
import { PokemonSprite, preloadSprites } from '@/components/pokemon-sprite';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Shield, Calendar, Zap, Sword } from 'lucide-react';

import { useAuth } from '@/lib/auth-context';
import { canManageTeam, isStaff } from '@/lib/permissions';
import { computePool, getTeamDefensiveProfile } from './utils';
import type { SwapEntry, TeraEdit } from './utils';
import { RosterTable } from './roster-table';
import { TypeCoverageGridInner } from './type-coverage-grid';
import { HeaderStrip } from './header-strip';
import { SpriteShowcase } from './sprite-showcase';
import { ManageRosterModal } from './manage-roster-modal';
import { RosterOverrideModal } from './roster-override-modal';
import { NextMatchBanner } from './next-match-banner';
import { TheorycraftSummary } from './theorycraft-summary';
import { CoverageTab } from './coverage-tab';
import { Personality } from './personality';
import { RecentEvents } from './recent-events';
import { ScheduleTab } from './schedule-tab';
import type { ScheduleRow } from './schedule-tab';
import { TeamProfileSkeleton } from '@/components/skeletons';

// ─── Main Page ───────────────────────────────────────────────────
export function TeamProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { players, standings, loading } = useLeagueData();

  if (loading) {
    return <TeamProfileSkeleton />;
  }

  const player = players.find(p => p.id === id);

  if (!player) {
    return (
      <EmptyState
        variant="not-found"
        title="Team not found."
        subtitle="Maybe it desynced. Or never existed."
        action={
          <Link to="/" className="text-neon hover:underline text-sm">
            Back to standings
          </Link>
        }
      />
    );
  }

  const rank = standings.findIndex(p => p.id === id) + 1;

  return <TeamProfileContent player={player} rank={rank} />;
}

function TeamProfileContent({ player, rank }: { player: Player; rank: number }) {
  const { players, getTeamMatches, getTeamByes, refresh } = useLeagueData();
  const league = useLeague();
  const { user } = useAuth();
  // Team-level manager authority: owner OR staff (admin/dev). Drives every
  // edit affordance on this page — tera captains, nickname editing, theorycraft
  // commits, etc. See lib/permissions.
  const canManage = canManageTeam(user, player);
  // Staff-only free-reign roster override (add/remove any Pokemon). Distinct
  // from `canManage` (which also includes team owners).
  const isAdmin = isStaff(user);
  const season = league.season;
  const config = DEFAULT_LEAGUE_CONFIG;

  // Preload sprites for entire roster + free agent pool (theorycraft swaps)
  useEffect(() => {
    preloadSprites(player.roster.map(m => m.name));
  }, [player]);

  // Allow deep-link into theorycraft mode: /league/.../teams/...?theorycraft=1
  const [searchParams, setSearchParams] = useSearchParams();
  const [theorycraftMode, setTheorycraftMode] = useState(
    searchParams.get('theorycraft') === '1',
  );
  const [manageOpen, setManageOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  // Strip the param after consumption so refresh doesn't re-enter mode unintentionally
  useEffect(() => {
    if (searchParams.get('theorycraft') === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('theorycraft');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const [swaps, setSwaps] = useState<SwapEntry[]>([]);
  const [teraEdits, setTeraEdits] = useState<TeraEdit[]>([]);
  const [removedIndices, setRemovedIndices] = useState<Set<number>>(new Set());
  const [additions, setAdditions] = useState<RosterPokemon[]>([]);
  const [addingMode, setAddingMode] = useState(false);
  const [swappingIndex, setSwappingIndex] = useState<number | null>(null);
  const [teraEditingIndex, setTeraEditingIndex] = useState<number | null>(null);
  const [draggingPosFrom, setDraggingPosFrom] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const spriteRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [rosterOrder, setRosterOrder] = useState<number[]>([]);
  const [sortKey, setSortKey] = useState<'tier' | 'kills' | 'deaths' | 'kpg' | 'spe'>('tier');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const matches = useMemo(() => getTeamMatches(player.id), [player.id]);
  const byeWeeks = useMemo(() => new Set(getTeamByes(player.id).map(b => b.week)), [player.id]);
  /** Match rows + BYE rows interleaved by week, sorted ascending. */
  const scheduleRows = useMemo(() => {
    const rows: ScheduleRow[] = [
      ...matches.map(m => ({ kind: 'match' as const, week: m.week, match: m })),
      ...[...byeWeeks].map(week => ({ kind: 'bye' as const, week })),
    ];
    rows.sort((a, b) => a.week - b.week);
    return rows;
  }, [matches, byeWeeks]);
  const costFormat = league.costFormat ?? DEFAULT_FORMAT;
  const pool = useMemo(() => computePool(players, costFormat), [players, costFormat]);

  // Initialize roster order
  useEffect(() => {
    setRosterOrder(player.roster.map((_, i) => i));
  }, [player.roster]);

  // Apply swaps + tera edits + removals + additions + reorder
  const activeRoster = useMemo(() => {
    const base = [...player.roster.map(mon => ({ ...mon }))];
    for (const swap of swaps) base[swap.index] = { ...swap.replacement };
    // Filter out removed, then append additions
    const filtered = base.filter((_, i) => !removedIndices.has(i));
    const combined = [...filtered, ...additions];
    // Apply tera edits by name (works across removals/additions)
    for (const edit of teraEdits) {
      const idx = combined.findIndex(m => m.name === edit.name);
      if (idx >= 0) {
        combined[idx] = { ...combined[idx], isTeraCaptain: edit.isTeraCaptain, teraTypes: edit.teraTypes.length > 0 ? edit.teraTypes : undefined };
      }
    }
    // Apply position reorder (only if length matches)
    const order = rosterOrder.length === combined.length ? rosterOrder : combined.map((_, i) => i);
    return order.map(idx => combined[idx]);
  }, [player.roster, swaps, teraEdits, removedIndices, additions, rosterOrder]);

  const sortedRoster = useMemo(() => {
    const indexed = activeRoster.map((mon, i) => ({ mon, originalIndex: i }));
    indexed.sort((a, b) => {
      let av: number, bv: number;
      const aCost = a.mon.isTeraCaptain ? getTermCost(a.mon.tier) : a.mon.tier;
      const bCost = b.mon.isTeraCaptain ? getTermCost(b.mon.tier) : b.mon.tier;
      switch (sortKey) {
        case 'tier': av = aCost; bv = bCost; break;
        case 'kills': av = a.mon.seasonStats.kills; bv = b.mon.seasonStats.kills; break;
        case 'deaths': av = a.mon.seasonStats.deaths; bv = b.mon.seasonStats.deaths; break;
        case 'kpg':
          av = a.mon.seasonStats.gp ? a.mon.seasonStats.kills / a.mon.seasonStats.gp : 0;
          bv = b.mon.seasonStats.gp ? b.mon.seasonStats.kills / b.mon.seasonStats.gp : 0;
          break;
        case 'spe': av = a.mon.stats.spe; bv = b.mon.stats.spe; break;
        default: av = aCost; bv = bCost;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return indexed;
  }, [activeRoster, sortKey, sortDir]);

  const pointsUsed = rosterPointsUsed(activeRoster);
  const originalPoints = rosterPointsUsed(player.roster);
  const pointsDelta = pointsUsed - originalPoints;
  const captainCount = teraCaptainCount(activeRoster);
  const teamKills = activeRoster.reduce((sum, p) => sum + p.seasonStats.kills, 0);
  const teamDeaths = activeRoster.reduce((sum, p) => sum + p.seasonStats.deaths, 0);
  const typeProfile = useMemo(() => getTeamDefensiveProfile(activeRoster), [activeRoster]);
  const pokemonTypesMap = useMemo(() => new Map(activeRoster.map(m => [m.name, m.types])), [activeRoster]);

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function handleSwap(index: number, replacement: RosterPokemon) {
    setSwaps(prev => {
      const existing = prev.findIndex(s => s.index === index);
      const original = player.roster[index];
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { index, original, replacement };
        return next;
      }
      return [...prev, { index, original, replacement }];
    });
    setSwappingIndex(null);
  }

  function handleRevertSwap(index: number) {
    setSwaps(prev => prev.filter(s => s.index !== index));
  }

  function handleRemoveMon(displayIndex: number) {
    const mon = activeRoster[displayIndex];
    if (!mon) return;

    // Clean up tera edits for this Pokemon
    setTeraEdits(prev => prev.filter(e => e.name !== mon.name));

    // Check if it's from the original roster
    const originalIdx = player.roster.findIndex(m => m.name === mon.name);
    if (originalIdx >= 0 && !removedIndices.has(originalIdx)) {
      setRemovedIndices(prev => new Set([...prev, originalIdx]));
      setSwaps(prev => prev.filter(s => s.index !== originalIdx));
    } else {
      // It's an addition
      setAdditions(prev => prev.filter(m => m.name !== mon.name));
    }
    // Reset roster order since length changed
    setRosterOrder([]);
  }

  function handleAddMon(mon: RosterPokemon) {
    setAdditions(prev => [...prev, mon]);
    setAddingMode(false);
    // Reset roster order since length changed
    setRosterOrder([]);
  }

  function handleResetAll() {
    setSwaps([]);
    setTeraEdits([]);
    setRemovedIndices(new Set());
    setAdditions([]);
    setAddingMode(false);
    setRosterOrder(player.roster.map((_, i) => i));
    setSwappingIndex(null);
    setTeraEditingIndex(null);
    setDraggingPosFrom(null);
  }

  function handlePositionSwap(fromDisplayIdx: number, toDisplayIdx: number) {
    setRosterOrder(prev => {
      const order = prev.length === player.roster.length ? [...prev] : player.roster.map((_, i) => i);
      const temp = order[fromDisplayIdx];
      order[fromDisplayIdx] = order[toDisplayIdx];
      order[toDisplayIdx] = temp;
      return order;
    });
  }

  function handleTeraTypeToggle(index: number, type: PokemonType) {
    const mon = activeRoster[index];
    setTeraEdits(prev => {
      const existing = prev.find(e => e.name === mon.name);
      const currentTypes = existing?.teraTypes ?? mon.teraTypes ?? [];
      const newTypes = currentTypes.includes(type)
        ? currentTypes.filter(t => t !== type)
        : [...currentTypes, type];
      const next = prev.filter(e => e.name !== mon.name);
      next.push({ name: mon.name, isTeraCaptain: true, teraTypes: newTypes });
      return next;
    });
  }

  function handleToggleCaptain(index: number) {
    const mon = activeRoster[index];
    if (mon.isTeraCaptain) {
      // Remove captain
      setTeraEdits(prev => {
        const next = prev.filter(e => e.name !== mon.name);
        next.push({ name: mon.name, isTeraCaptain: false, teraTypes: [] });
        return next;
      });
      setTeraEditingIndex(null);
    } else {
      // Make captain (if valid)
      if (!canBeTeraCaptain(mon.name, costFormat)) return;
      const newCost = getTermCost(mon.tier);
      const oldCost = mon.tier;
      if (pointsUsed - oldCost + newCost > config.pointCap) return;
      if (captainCount >= config.teraCaptainSlots) return;
      setTeraEdits(prev => {
        const next = prev.filter(e => e.name !== mon.name);
        next.push({ name: mon.name, isTeraCaptain: true, teraTypes: mon.teraTypes ?? [] });
        return next;
      });
    }
  }

  // Pointer-based drag system (position reorder)
  const isDragging = draggingPosFrom !== null;
  const dragSource = draggingPosFrom;

  // Use refs for values needed in event handlers to avoid stale closures
  const dragOverRef = useRef<number | null>(null);
  const dragSourceRef = useRef<typeof dragSource>(null);
  const draggingPosFromRef = useRef(draggingPosFrom);
  dragOverRef.current = dragOverIndex;
  dragSourceRef.current = dragSource;
  draggingPosFromRef.current = draggingPosFrom;

  const handlePositionPointerDown = useCallback((index: number, e: React.PointerEvent) => {
    if (!theorycraftMode) return;
    e.preventDefault();
    e.stopPropagation();
    setDraggingPosFrom(index);
    setDragPos({ x: e.clientX, y: e.clientY });
  }, [theorycraftMode]);

  useEffect(() => {
    if (!isDragging) return;

    function onMove(e: PointerEvent) {
      setDragPos({ x: e.clientX, y: e.clientY });
      let found: number | null = null;
      spriteRefs.current.forEach((el, idx) => {
        const rect = el.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          found = idx;
        }
      });
      const src = dragSourceRef.current;
      setDragOverIndex(found !== src ? found : null);
    }

    function onUp() {
      const overIdx = dragOverRef.current;
      const src = dragSourceRef.current;

      if (overIdx !== null && overIdx !== src && draggingPosFromRef.current !== null) {
        handlePositionSwap(draggingPosFromRef.current, overIdx);
      }
      setDraggingPosFrom(null);
      setDragPos(null);
      setDragOverIndex(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [isDragging]);

  return (
    <div className="space-y-4">
      {/* Back nav */}
      <Link to="/" className="inline-flex items-center gap-1 text-[11px] font-medium text-text-muted hover:text-neon transition-colors uppercase tracking-widest">
        <ArrowLeft size={11} /> Standings
      </Link>

      {/* ═══ TEAM HEADER ═══ */}
      <HeaderStrip
        player={player}
        rank={rank}
        theorycraftMode={theorycraftMode}
        onToggleTheorycraft={() => { setTheorycraftMode(!theorycraftMode); if (theorycraftMode) handleResetAll(); }}
        teamKills={teamKills}
        teamDeaths={teamDeaths}
        canManage={canManage}
        onManage={() => setManageOpen(true)}
        canOverride={isAdmin}
        onOverride={() => setOverrideOpen(true)}
      />

      {/* ═══ MANAGE ROSTER MODAL (nicknames + shiny + tera, owner/staff) ═══ */}
      {canManage && (
        <ManageRosterModal
          open={manageOpen}
          onOpenChange={setManageOpen}
          player={player}
          config={config}
          costFormat={costFormat}
          season={season}
          onSaved={refresh}
        />
      )}

      {/* ═══ ROSTER OVERRIDE MODAL (staff free-reign add/remove) ═══ */}
      {isAdmin && overrideOpen && (
        <RosterOverrideModal
          player={player}
          leagueId={league.id}
          players={players}
          costFormat={costFormat}
          config={config}
          season={season}
          onClose={() => setOverrideOpen(false)}
          onCommitted={() => { void refresh(); setOverrideOpen(false); }}
        />
      )}

      {/* ═══ NEXT-MATCH BANNER (regular/playoffs) ═══ */}
      {season && (
        <NextMatchBanner
          player={player}
          matches={matches}
          byeWeeks={byeWeeks}
          opponents={players}
          season={season}
          leagueId={league.id}
        />
      )}

      {/* ═══ TEAM PERSONALITY (captain note, owner-editable) ═══ */}
      {!theorycraftMode && <Personality player={player} onSaved={refresh} />}

      {/* ═══ SPRITE SHOWCASE + POINT CAP + TERA ═══ */}
      <SpriteShowcase
        player={player}
        config={config}
        activeRoster={activeRoster}
        swaps={swaps}
        rosterOrder={rosterOrder}
        // WIP: PoolEntry/RosterPokemon are structurally similar; cast at boundary to unblock build
        pool={pool as unknown as import('@/lib/types').RosterPokemon[]}
        pointsUsed={pointsUsed}
        pointsDelta={pointsDelta}
        captainCount={captainCount}
        theorycraftMode={theorycraftMode}
        season={season}
        swappingIndex={swappingIndex}
        addingMode={addingMode}
        teraEditingIndex={teraEditingIndex}
        teraEdits={teraEdits}
        draggingPosFrom={draggingPosFrom}
        dragOverIndex={dragOverIndex}
        dragPos={dragPos}
        spriteRefs={spriteRefs}
        onPointerDownSprite={handlePositionPointerDown}
        onSetSwappingIndex={setSwappingIndex}
        onSetAddingMode={setAddingMode}
        onSetTeraEditingIndex={setTeraEditingIndex}
        onRevertSwap={handleRevertSwap}
        onRemoveMon={handleRemoveMon}
        onSwap={handleSwap}
        onAddMon={handleAddMon}
        onToggleCaptain={handleToggleCaptain}
        onTeraTypeToggle={handleTeraTypeToggle}
        onTeraEditsClear={() => setTeraEdits([])}
        costFormat={costFormat}
      />

      {/* ═══ MAIN CONTENT GRID ═══ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">

        {/* ─── ROSTER TABLE (2 cols) ─── */}
        <div className="xl:col-span-2 flex flex-col gap-4">
          <RosterTable
            activeRoster={activeRoster}
            sortedRoster={sortedRoster}
            swaps={swaps}
            config={config}
            theorycraftMode={theorycraftMode}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            onResetAll={handleResetAll}
            teamId={player.id}
            canEditNickname={false}
            onNicknameSaved={() => { void refresh(); }}
          />
        </div>

        {/* ─── RIGHT COLUMN — Tabbed, stretches to match roster ─── */}
        <Card className="bg-surface-raised border-border-default flex flex-col min-h-0">
          <Tabs defaultValue="defense" className="flex flex-col flex-1 min-h-0">
            <div className="border-b border-border-subtle">
              <TabsList variant="line" className="w-full justify-start px-2 h-9">
                <TabsTrigger value="defense" className="text-[11px] gap-1 px-2">
                  <Shield size={12} /> Defense
                </TabsTrigger>
                <TabsTrigger value="coverage" className="text-[11px] gap-1 px-2">
                  <Sword size={12} /> Coverage
                </TabsTrigger>
                <TabsTrigger value="schedule" className="text-[11px] gap-1 px-2">
                  <Calendar size={12} /> Schedule
                </TabsTrigger>
                <TabsTrigger value="speed" className="text-[11px] gap-1 px-2">
                  <Zap size={12} /> Speed
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="defense" className="p-0 flex-1 overflow-y-auto flex flex-col">
              <TypeCoverageGridInner profile={typeProfile} pokemonTypesMap={pokemonTypesMap} />
            </TabsContent>

            <TabsContent value="coverage" className="p-0 flex-1 overflow-y-auto flex flex-col">
              <CoverageTab roster={activeRoster} format={league.format} />
            </TabsContent>

            <TabsContent value="schedule" className="p-0 flex-1 overflow-y-auto flex flex-col">
              <ScheduleTab player={player} scheduleRows={scheduleRows} />
            </TabsContent>

            <TabsContent value="speed" className="p-0 flex-1 overflow-y-auto flex flex-col">
              <div className="p-3 flex-1 flex flex-col gap-0.5">
                {[...activeRoster]
                  .sort((a, b) => b.stats.spe - a.stats.spe)
                  .map((mon, i) => {
                    const maxSpe = Math.max(...activeRoster.map(m => m.stats.spe));
                    const pct = maxSpe > 0 ? (mon.stats.spe / maxSpe) * 100 : 0;
                    return (
                      <div key={`${mon.name}-${i}`} className="flex items-center gap-2 px-1 rounded hover:bg-surface-overlay/50 transition-colors flex-1 min-h-[28px]">
                        <PokemonSprite name={mon.name} size="sm" className="shrink-0" />
                        <span className="text-[11px] text-text-secondary font-medium w-24 truncate">{mon.name}</span>
                        <div className="flex-1 h-2 rounded-full bg-surface-overlay overflow-hidden">
                          <div className="h-full rounded-full bg-neon/50 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-text-primary font-semibold w-8 text-right">{mon.stats.spe}</span>
                      </div>
                    );
                  })
                }
              </div>
            </TabsContent>
          </Tabs>
        </Card>
      </div>

      {/* ═══ RECENT MOVES (community surface, anchored at the bottom) ═══ */}
      {!theorycraftMode && <RecentEvents player={player} />}

      {/* ═══ THEORYCRAFT FLOATING DIFF SUMMARY ═══ */}
      {theorycraftMode && (
        <TheorycraftSummary
          originalRoster={player.roster}
          swaps={swaps}
          removedIndices={removedIndices}
          additions={additions}
          teraEdits={teraEdits}
          pointsDelta={pointsDelta}
          onReset={handleResetAll}
        />
      )}
    </div>
  );
}
