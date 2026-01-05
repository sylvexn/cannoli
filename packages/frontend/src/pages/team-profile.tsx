import { useParams, Link } from 'react-router-dom';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { players, standings } from '@/mocks/players';
import { getTeamMatches, currentSeason } from '@/mocks/season';
import { TIER_LIST, TERA_BANNED, getEffectiveCost, canBeTeraCaptain, getTermCost } from '@/mocks/tier-list';
import type { Player, RosterPokemon } from '@/lib/types';
import { DEFAULT_LEAGUE_CONFIG } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';
import { POKEMON_TYPES } from '@/lib/pokemon';
import { rosterPointsUsed, teraCaptainCount } from '@/lib/roster';
import { TeamLogo } from '@/components/team-logo';
import { RecordDisplay } from '@/components/record-display';
import { KDDisplay } from '@/components/kd-display';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { TypeBadge } from '@/components/type-badge';
import { StatBar } from '@/components/stat-bar';
import { PointCapBar } from '@/components/point-cap-bar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ArrowLeft, ExternalLink, FlaskConical, RotateCcw,
  ChevronDown, ChevronUp, X, Search, ArrowRightLeft,
  Shield, Calendar, Zap,
} from 'lucide-react';

// ─── Type effectiveness ──────────────────────────────────────────
const TYPE_CHART: Record<PokemonType, { weak: PokemonType[]; resist: PokemonType[]; immune: PokemonType[] }> = {
  normal: { weak: ['fighting'], resist: [], immune: ['ghost'] },
  fire: { weak: ['water', 'ground', 'rock'], resist: ['fire', 'grass', 'ice', 'bug', 'steel', 'fairy'], immune: [] },
  water: { weak: ['electric', 'grass'], resist: ['fire', 'water', 'ice', 'steel'], immune: [] },
  electric: { weak: ['ground'], resist: ['electric', 'flying', 'steel'], immune: [] },
  grass: { weak: ['fire', 'ice', 'poison', 'flying', 'bug'], resist: ['water', 'electric', 'grass', 'ground'], immune: [] },
  ice: { weak: ['fire', 'fighting', 'rock', 'steel'], resist: ['ice'], immune: [] },
  fighting: { weak: ['flying', 'psychic', 'fairy'], resist: ['bug', 'rock', 'dark'], immune: [] },
  poison: { weak: ['ground', 'psychic'], resist: ['fighting', 'poison', 'bug', 'grass', 'fairy'], immune: [] },
  ground: { weak: ['water', 'grass', 'ice'], resist: ['poison', 'rock'], immune: ['electric'] },
  flying: { weak: ['electric', 'ice', 'rock'], resist: ['fighting', 'bug', 'grass'], immune: ['ground'] },
  psychic: { weak: ['bug', 'ghost', 'dark'], resist: ['fighting', 'psychic'], immune: [] },
  bug: { weak: ['fire', 'flying', 'rock'], resist: ['fighting', 'ground', 'grass'], immune: [] },
  rock: { weak: ['water', 'grass', 'fighting', 'ground', 'steel'], resist: ['normal', 'fire', 'poison', 'flying'], immune: [] },
  ghost: { weak: ['ghost', 'dark'], resist: ['poison', 'bug'], immune: ['normal', 'fighting'] },
  dragon: { weak: ['ice', 'dragon', 'fairy'], resist: ['fire', 'water', 'electric', 'grass'], immune: [] },
  dark: { weak: ['fighting', 'bug', 'fairy'], resist: ['ghost', 'dark'], immune: ['psychic'] },
  steel: { weak: ['fire', 'fighting', 'ground'], resist: ['normal', 'grass', 'ice', 'flying', 'psychic', 'bug', 'rock', 'dragon', 'steel', 'fairy'], immune: ['poison'] },
  fairy: { weak: ['poison', 'steel'], resist: ['fighting', 'bug', 'dark'], immune: ['dragon'] },
};

interface TypeProfileEntry {
  weak: string[];
  resist: string[];
  immune: string[];
}

function getTeamDefensiveProfile(roster: RosterPokemon[]) {
  // For each attacking type, track which Pokemon are weak/resist/immune
  const profile: Record<PokemonType, TypeProfileEntry> = {} as any;
  for (const t of POKEMON_TYPES) profile[t] = { weak: [], resist: [], immune: [] };

  for (const mon of roster) {
    const effective: Record<PokemonType, number> = {} as any;
    for (const t of POKEMON_TYPES) effective[t] = 1;

    for (const monType of mon.types) {
      const chart = TYPE_CHART[monType];
      for (const w of chart.weak) effective[w] *= 2;
      for (const r of chart.resist) effective[r] *= 0.5;
      for (const i of chart.immune) effective[i] *= 0;
    }

    for (const t of POKEMON_TYPES) {
      if (effective[t] === 0) profile[t].immune.push(mon.name);
      else if (effective[t] >= 2) profile[t].weak.push(mon.name);
      else if (effective[t] <= 0.5) profile[t].resist.push(mon.name);
    }
  }
  return profile;
}

// ─── Free agents (dynamic from tier list) ────────────────────────
interface PoolEntry { name: string; tier: number; teraCost: number; drafted: boolean; draftedBy?: string }

function computePool(allPlayers: Player[]): PoolEntry[] {
  const draftedMap = new Map<string, string>();
  for (const p of allPlayers) {
    for (const mon of p.roster) draftedMap.set(mon.name, p.teamAbbrev);
  }
  return TIER_LIST
    .map(entry => ({
      name: entry.name,
      tier: entry.tier,
      teraCost: entry.teraCost,
      drafted: draftedMap.has(entry.name),
      draftedBy: draftedMap.get(entry.name),
    }))
    .sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
}

// ─── Swap state ──────────────────────────────────────────────────
interface SwapEntry {
  index: number;
  original: RosterPokemon;
  replacement: RosterPokemon;
}

// ─── Tera edit state ─────────────────────────────────────────────
interface TeraEdit {
  index: number;
  isTeraCaptain: boolean;
  teraTypes: PokemonType[];
}

// Minimal data for a free agent in swap picker
function freeAgentToRoster(fa: { name: string; tier: number }): RosterPokemon {
  // We only need name/tier/types for theorycraft preview. Types will show as empty until we have full data.
  const entry = TIER_LIST.find(e => e.name === fa.name);
  return {
    name: fa.name,
    tier: fa.tier,
    types: [], // Would come from a Pokemon data API
    isTeraCaptain: false,
    stats: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    abilities: [],
    seasonStats: { kills: 0, deaths: 0, gp: 0 },
  };
}

// ─── Main Page ───────────────────────────────────────────────────
export function TeamProfilePage() {
  const { id } = useParams<{ id: string }>();
  const player = players.find(p => p.id === id);

  if (!player) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-text-muted text-lg">Team not found</p>
        <Link to="/" className="text-neon hover:underline text-sm">Back to standings</Link>
      </div>
    );
  }

  const rank = standings.findIndex(p => p.id === id) + 1;
  const isPlayoff = rank <= 8;

  return <TeamProfileContent player={player} rank={rank} isPlayoff={isPlayoff} />;
}

function TeamProfileContent({ player, rank, isPlayoff }: { player: Player; rank: number; isPlayoff: boolean }) {
  const config = DEFAULT_LEAGUE_CONFIG;
  const [theorycraftMode, setTheorycraftMode] = useState(false);
  const [swaps, setSwaps] = useState<SwapEntry[]>([]);
  const [teraEdits, setTeraEdits] = useState<TeraEdit[]>([]);
  const [swappingIndex, setSwappingIndex] = useState<number | null>(null);
  const [teraEditingIndex, setTeraEditingIndex] = useState<number | null>(null);
  const [draggingTeraFrom, setDraggingTeraFrom] = useState<number | null>(null);
  const [draggingPosFrom, setDraggingPosFrom] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const spriteRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [rosterOrder, setRosterOrder] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMon, setExpandedMon] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<'tier' | 'kills' | 'deaths' | 'kpg' | 'spe'>('tier');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const matches = useMemo(() => getTeamMatches(player.id), [player.id]);
  const pool = useMemo(() => computePool(players), []);
  const [showTaken, setShowTaken] = useState(false);

  // Initialize roster order
  useEffect(() => {
    setRosterOrder(player.roster.map((_, i) => i));
  }, [player.roster]);

  // Apply swaps + tera edits + reorder
  const activeRoster = useMemo(() => {
    const base = [...player.roster.map(mon => ({ ...mon }))];
    for (const swap of swaps) base[swap.index] = { ...swap.replacement };
    for (const edit of teraEdits) {
      base[edit.index] = { ...base[edit.index], isTeraCaptain: edit.isTeraCaptain, teraTypes: edit.teraTypes.length > 0 ? edit.teraTypes : undefined };
    }
    // Apply position reorder
    const order = rosterOrder.length === base.length ? rosterOrder : base.map((_, i) => i);
    return order.map(idx => base[idx]);
  }, [player.roster, swaps, teraEdits, rosterOrder]);

  const sortedRoster = useMemo(() => {
    const indexed = activeRoster.map((mon, i) => ({ mon, originalIndex: i }));
    indexed.sort((a, b) => {
      let av: number, bv: number;
      const aCost = getEffectiveCost(a.mon.name, a.mon.isTeraCaptain);
      const bCost = getEffectiveCost(b.mon.name, b.mon.isTeraCaptain);
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
    setSearchQuery('');
  }

  function handleRevertSwap(index: number) {
    setSwaps(prev => prev.filter(s => s.index !== index));
  }

  function handleResetAll() {
    setSwaps([]);
    setTeraEdits([]);
    setRosterOrder(player.roster.map((_, i) => i));
    setSwappingIndex(null);
    setTeraEditingIndex(null);
    setDraggingTeraFrom(null);
    setDraggingPosFrom(null);
    setSearchQuery('');
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

  function handleTeraDrop(targetIndex: number) {
    if (draggingTeraFrom === null || draggingTeraFrom === targetIndex) return;
    const targetMon = activeRoster[targetIndex];
    if (!canBeTeraCaptain(targetMon.name)) return;

    // Check point cap: removing captain from source, adding to target
    const sourceMon = activeRoster[draggingTeraFrom];
    const oldSourceCost = getEffectiveCost(sourceMon.name, true);
    const newSourceCost = getEffectiveCost(sourceMon.name, false);
    const oldTargetCost = getEffectiveCost(targetMon.name, false);
    const newTargetCost = getEffectiveCost(targetMon.name, true);
    const newTotal = pointsUsed - oldSourceCost + newSourceCost - oldTargetCost + newTargetCost;
    if (newTotal > config.pointCap) return;

    setTeraEdits(prev => {
      const next = prev.filter(e => e.index !== draggingTeraFrom && e.index !== targetIndex);
      // Remove captain from source
      next.push({ index: draggingTeraFrom!, isTeraCaptain: false, teraTypes: [] });
      // Add captain to target (start with no tera types — user can edit them)
      next.push({ index: targetIndex, isTeraCaptain: true, teraTypes: targetMon.teraTypes ?? [] });
      return next;
    });
    setDraggingTeraFrom(null);
  }

  function handleTeraTypeToggle(index: number, type: PokemonType) {
    setTeraEdits(prev => {
      const existing = prev.find(e => e.index === index);
      const currentTypes = existing?.teraTypes ?? activeRoster[index].teraTypes ?? [];
      const newTypes = currentTypes.includes(type)
        ? currentTypes.filter(t => t !== type)
        : [...currentTypes, type];
      const next = prev.filter(e => e.index !== index);
      next.push({ index, isTeraCaptain: true, teraTypes: newTypes });
      return next;
    });
  }

  function handleToggleCaptain(index: number) {
    const mon = activeRoster[index];
    if (mon.isTeraCaptain) {
      // Remove captain
      setTeraEdits(prev => {
        const next = prev.filter(e => e.index !== index);
        next.push({ index, isTeraCaptain: false, teraTypes: [] });
        return next;
      });
      setTeraEditingIndex(null);
    } else {
      // Make captain (if valid)
      if (!canBeTeraCaptain(mon.name)) return;
      const newCost = getEffectiveCost(mon.name, true);
      const oldCost = getEffectiveCost(mon.name, false);
      if (pointsUsed - oldCost + newCost > config.pointCap) return;
      if (captainCount >= config.teraCaptainSlots) return;
      setTeraEdits(prev => {
        const next = prev.filter(e => e.index !== index);
        next.push({ index, isTeraCaptain: true, teraTypes: mon.teraTypes ?? [] });
        return next;
      });
    }
  }

  // Pointer-based drag system (tera badge + position reorder)
  const isDragging = draggingTeraFrom !== null || draggingPosFrom !== null;
  const dragSource = draggingTeraFrom ?? draggingPosFrom;
  const dragType = draggingTeraFrom !== null ? 'tera' : draggingPosFrom !== null ? 'position' : null;

  // Use refs for values needed in event handlers to avoid stale closures
  const dragOverRef = useRef<number | null>(null);
  const dragTypeRef = useRef<typeof dragType>(null);
  const dragSourceRef = useRef<typeof dragSource>(null);
  const activeRosterRef = useRef(activeRoster);
  const draggingPosFromRef = useRef(draggingPosFrom);
  dragOverRef.current = dragOverIndex;
  dragTypeRef.current = dragType;
  dragSourceRef.current = dragSource;
  activeRosterRef.current = activeRoster;
  draggingPosFromRef.current = draggingPosFrom;

  const handleTeraPointerDown = useCallback((index: number, e: React.PointerEvent) => {
    if (!theorycraftMode) return;
    e.preventDefault();
    e.stopPropagation();
    setDraggingTeraFrom(index);
    setDragPos({ x: e.clientX, y: e.clientY });
  }, [theorycraftMode]);

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
      const type = dragTypeRef.current;
      const roster = activeRosterRef.current;

      if (overIdx !== null && overIdx !== src) {
        if (type === 'tera') {
          const targetMon = roster[overIdx];
          if (targetMon && canBeTeraCaptain(targetMon.name)) {
            handleTeraDrop(overIdx);
          }
          // Invalid target: do nothing, badge snaps back
        } else if (type === 'position' && draggingPosFromRef.current !== null) {
          handlePositionSwap(draggingPosFromRef.current, overIdx);
        }
      }
      setDraggingTeraFrom(null);
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

  const SortIcon = ({ k }: { k: typeof sortKey }) => {
    if (sortKey !== k) return null;
    return sortDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />;
  };

  const filteredAgents = useMemo(() => {
    let list = showTaken ? pool : pool.filter(p => !p.drafted);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [pool, searchQuery, showTaken]);

  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {/* Back nav */}
      <Link to="/" className="inline-flex items-center gap-1 text-[11px] font-medium text-text-muted hover:text-neon transition-colors uppercase tracking-widest">
        <ArrowLeft size={11} /> Standings
      </Link>

      {/* ═══ TEAM HEADER ═══ */}
      <div className="relative rounded-lg overflow-hidden" style={{ background: `linear-gradient(135deg, ${player.teamColor}08, ${player.teamColor}03 40%, transparent)` }}>
        {/* Accent bar */}
        <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${player.teamColor}cc, ${player.teamColor}30 60%, transparent)` }} />

        <div className="px-5 pt-4 pb-3 flex items-center gap-4">
          <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="lg" className="w-12 h-12 text-xs shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-text-primary tracking-tight leading-none">{player.teamName}</h1>
            <p className="text-[11px] text-text-muted mt-1.5 font-medium tracking-wide">
              {player.name} <span className="text-border-default mx-1">/</span> {player.teamAbbrev}
            </p>
          </div>
          <button
            onClick={() => { setTheorycraftMode(!theorycraftMode); if (theorycraftMode) handleResetAll(); }}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-semibold tracking-wider uppercase transition-all ${
              theorycraftMode
                ? 'bg-pink/10 text-pink border border-pink/25'
                : 'bg-surface-overlay/50 text-text-muted border border-border-subtle hover:text-neon hover:border-neon/30'
            }`}
          >
            <FlaskConical size={11} />
            {theorycraftMode ? 'Exit' : 'Theorycraft'}
          </button>
        </div>

        {/* Stats strip */}
        <div className="mx-5 mb-4 rounded-lg bg-surface-raised border border-border-default overflow-hidden">
          <div className="flex items-stretch divide-x divide-border-subtle">
            {/* Rank */}
            <div className="flex items-center justify-center px-5 py-3">
              <RankBadge rank={rank} />
            </div>

            {/* Record */}
            <div className="flex-1 flex flex-col items-center justify-center py-3 px-4">
              <div className="font-mono text-lg font-bold tabular-nums tracking-tight leading-none">
                <RecordDisplay wins={player.record.wins} losses={player.record.losses} differential={player.record.differential} />
              </div>
              <span className="text-[8px] font-semibold text-text-muted uppercase tracking-[0.15em] mt-1.5">Record</span>
            </div>

            {/* K/D */}
            <div className="flex-1 flex flex-col items-center justify-center py-3 px-4">
              <div className="font-mono text-lg font-bold tabular-nums tracking-tight leading-none">
                <span className="text-win">{teamKills}</span>
                <span className="text-text-muted/30 mx-0.5">/</span>
                <span className="text-loss">{teamDeaths}</span>
              </div>
              <span className="text-[8px] font-semibold text-text-muted uppercase tracking-[0.15em] mt-1.5">K / D</span>
            </div>

            {/* Win Rate */}
            <div className="flex-1 flex flex-col items-center justify-center py-3 px-4">
              <div className="font-mono text-lg font-bold tabular-nums tracking-tight leading-none text-text-primary">
                {((player.record.wins / (player.record.wins + player.record.losses)) * 100).toFixed(0)}<span className="text-sm text-text-muted font-normal">%</span>
              </div>
              <span className="text-[8px] font-semibold text-text-muted uppercase tracking-[0.15em] mt-1.5">Win Rate</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ SPRITE SHOWCASE + POINT CAP + TERA ═══ */}
      <Card className="bg-surface-raised border-border-default overflow-hidden">
        <div className="flex items-center justify-center gap-1 px-4 py-3 flex-wrap">
          {activeRoster.map((mon, i) => {
            const isSwapped = swaps.some(s => s.index === (rosterOrder[i] ?? i));
            const isSwapping = swappingIndex === i;
            const effectiveCost = getEffectiveCost(mon.name, mon.isTeraCaptain);
            const isTeraOver = dragOverIndex === i && draggingTeraFrom !== null && draggingTeraFrom !== i;
            const isPosOver = dragOverIndex === i && draggingPosFrom !== null && draggingPosFrom !== i;
            const teraCanDrop = isTeraOver && canBeTeraCaptain(mon.name);
            const teraBlocked = isTeraOver && !canBeTeraCaptain(mon.name);
            const beingDragged = draggingPosFrom === i;
            return (
              <div
                key={`${mon.name}-${i}`}
                className="relative group"
                ref={(el) => { if (el) spriteRefs.current.set(i, el); else spriteRefs.current.delete(i); }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      onPointerDown={(e) => {
                        // Only start position drag from the sprite body (not tera badge)
                        if ((e.target as HTMLElement).closest('svg')) return;
                        handlePositionPointerDown(i, e);
                      }}
                      className={`relative p-1.5 rounded-lg transition-all duration-200 ${
                        theorycraftMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                      } ${isSwapped ? 'ring-1 ring-pink/40' : ''
                      } ${isSwapping ? 'ring-2 ring-neon/60 bg-neon/5' : ''
                      } ${teraCanDrop ? 'ring-2 ring-pink/60 bg-pink/8 scale-105' : ''
                      } ${teraBlocked ? 'ring-2 ring-loss/60 bg-loss/10' : ''
                      } ${isPosOver ? 'ring-2 ring-neon/50 bg-neon/8 scale-105' : ''
                      } ${beingDragged ? 'opacity-30 scale-95' : 'hover:bg-surface-overlay/60'
                      }`}
                    >
                      <PokemonSprite name={mon.name} size="xl" className={`transition-transform duration-200 ${!beingDragged ? 'group-hover:scale-110' : ''}`} />
                      {/* Tera blocked overlay */}
                      {teraBlocked && (
                        <div className="absolute inset-0 rounded-lg flex items-center justify-center bg-loss/10">
                          <X size={28} className="text-loss/60" />
                        </div>
                      )}
                      {mon.isTeraCaptain && (
                        <svg
                          width="27"
                          height="27"
                          viewBox="0 0 18 18"
                          onPointerDown={(e) => handleTeraPointerDown(i, e)}
                          onClick={(e) => {
                            if (!theorycraftMode) return;
                            e.stopPropagation();
                            setTeraEditingIndex(teraEditingIndex === i ? null : i);
                          }}
                          className={`absolute top-0.5 right-0.5 select-none touch-none ${theorycraftMode ? 'cursor-grab active:cursor-grabbing hover:scale-110 transition-transform' : ''} ${draggingTeraFrom === i ? 'opacity-40' : ''}`}
                          style={{ filter: 'drop-shadow(0 0 5px rgba(232, 121, 249, 0.5))' }}
                        >
                          <circle cx="9" cy="9" r="8.5" fill="#e879f9" />
                          <circle cx="9" cy="9" r="7.5" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.5" />
                          <path d="M9 3 L13.5 7.5 L9 15 L4.5 7.5 Z" fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="round" opacity="0.9" />
                          <path d="M4.5 7.5 L13.5 7.5" stroke="white" strokeWidth="0.8" opacity="0.5" />
                          <path d="M9 3 L9 7.5" stroke="white" strokeWidth="0.6" opacity="0.35" />
                        </svg>
                      )}
                      {/* Empty captain slot indicator in theorycraft mode */}
                      {theorycraftMode && !mon.isTeraCaptain && canBeTeraCaptain(mon.name) && captainCount < config.teraCaptainSlots && (
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 18 18"
                          onClick={(e) => { e.stopPropagation(); handleToggleCaptain(i); }}
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-all cursor-pointer select-none"
                          style={{ filter: 'drop-shadow(0 0 2px rgba(232, 121, 249, 0.2))' }}
                        >
                          <circle cx="9" cy="9" r="8" fill="none" stroke="#e879f9" strokeWidth="1" strokeDasharray="3 2" opacity="0.5" />
                          <path d="M9 3 L13.5 7.5 L9 15 L4.5 7.5 Z" fill="none" stroke="#e879f9" strokeWidth="0.8" strokeLinejoin="round" opacity="0.4" />
                        </svg>
                      )}
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
                        <TierBadge points={effectiveCost} />
                      </div>
                      {/* Swap button on hover (theorycraft mode only) */}
                      {theorycraftMode && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setSwappingIndex(isSwapping ? null : i); setSearchQuery(''); }}
                          className={`absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-all p-1 rounded-md ${
                            isSwapping ? 'opacity-100 bg-neon/20 text-neon' : isSwapped ? 'opacity-100 bg-pink/20 text-pink' : 'bg-surface/80 text-text-muted hover:text-neon hover:bg-neon/10'
                          }`}
                        >
                          {isSwapped ? <RotateCcw size={13} onClick={(e) => { e.stopPropagation(); handleRevertSwap(i); }} /> : <ArrowRightLeft size={13} />}
                        </button>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="bg-surface-overlay border-border-default text-xs">
                    <span className="font-semibold text-text-primary">{mon.name}</span>
                    <span className="text-text-muted ml-2">{effectiveCost}pt{mon.isTeraCaptain ? ` (base ${mon.tier})` : ''}</span>
                  </TooltipContent>
                </Tooltip>

                {/* Tera type editor popover */}
                {teraEditingIndex === i && mon.isTeraCaptain && theorycraftMode && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-40 w-52 rounded-lg bg-surface-raised border border-pink/20 shadow-glow-pink-sm p-2.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase text-pink">Tera Types</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleCaptain(i); }}
                        className="text-[9px] text-loss/60 hover:text-loss transition-colors"
                      >
                        Remove captain
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {POKEMON_TYPES.map(type => {
                        const isSelected = (mon.teraTypes ?? []).includes(type);
                        return (
                          <button
                            key={type}
                            onClick={(e) => { e.stopPropagation(); handleTeraTypeToggle(i, type); }}
                            className={`text-[8px] font-bold uppercase rounded px-1.5 py-0.5 transition-all ${
                              isSelected
                                ? 'text-white ring-1 ring-white/30 scale-105'
                                : 'text-white/50 opacity-40 hover:opacity-70'
                            }`}
                            style={{ backgroundColor: TYPE_COLORS[type] }}
                          >
                            {TYPE_ABBR[type]}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setTeraEditingIndex(null); }}
                      className="mt-2 w-full text-[10px] text-text-muted hover:text-text-primary text-center py-0.5"
                    >
                      Done
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Swap picker */}
        {swappingIndex !== null && theorycraftMode && (() => {
          const currentMon = activeRoster[swappingIndex];
          const currentCost = getEffectiveCost(currentMon.name, currentMon.isTeraCaptain);
          const visibleAgents = filteredAgents.slice(0, 200);
          const hovered = hoveredAgent ? filteredAgents.find(a => a.name === hoveredAgent) : null;
          const hoveredDelta = hovered ? hovered.tier - currentCost : 0;
          const hoveredNewTotal = hovered ? pointsUsed + hoveredDelta : 0;
          const hoveredExceeds = hovered ? hoveredNewTotal > config.pointCap : false;

          return (
            <div className="border-t border-border-subtle bg-surface-overlay/15">
              {/* Toolbar */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle/30 text-[10px]">
                <ArrowRightLeft size={10} className="text-neon shrink-0" />
                <span className="text-text-muted">Replacing</span>
                <span className="text-text-primary font-semibold">{currentMon.name}</span>
                <span className="font-mono text-text-muted">({currentCost}pt)</span>
                <div className="flex-1" />
                <label className="flex items-center gap-1 cursor-pointer select-none text-text-muted hover:text-text-secondary transition-colors">
                  <input
                    type="checkbox"
                    checked={showTaken}
                    onChange={e => setShowTaken(e.target.checked)}
                    className="w-3 h-3 rounded border-border-default accent-neon"
                  />
                  Show taken
                </label>
                <div className="flex items-center gap-1 bg-surface-overlay/50 rounded px-2 py-0.5 ml-1">
                  <Search size={10} className="text-text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Filter..."
                    className="w-28 bg-transparent text-[10px] text-text-primary placeholder:text-text-muted outline-none"
                    autoFocus
                  />
                  {searchQuery && <button onClick={() => setSearchQuery('')} className="text-text-muted hover:text-text-primary"><X size={9} /></button>}
                </div>
                <span className="font-mono text-text-muted">{filteredAgents.length}</span>
                <button onClick={() => { setSwappingIndex(null); setSearchQuery(''); setHoveredAgent(null); }} className="text-text-muted hover:text-text-primary ml-1"><X size={12} /></button>
              </div>

              <div className="flex" style={{ height: 320 }}>
                {/* Grid */}
                <div className="flex-1 overflow-y-auto p-2">
                  <div className="flex flex-wrap gap-[3px] content-start">
                    {visibleAgents.map(fa => {
                      const wouldExceed = (pointsUsed + fa.tier - currentCost) > config.pointCap;
                      const isHov = hoveredAgent === fa.name;
                      return (
                        <button
                          key={fa.name}
                          onClick={() => { if (!wouldExceed && !fa.drafted) { handleSwap(swappingIndex, freeAgentToRoster(fa)); setHoveredAgent(null); } }}
                          onMouseEnter={() => setHoveredAgent(fa.name)}
                          onMouseLeave={() => { if (hoveredAgent === fa.name) setHoveredAgent(null); }}
                          disabled={wouldExceed || fa.drafted}
                          className={`relative w-11 h-11 rounded flex items-center justify-center transition-colors ${
                            fa.drafted ? 'opacity-25 cursor-not-allowed'
                            : wouldExceed ? 'opacity-15 cursor-not-allowed'
                            : isHov ? 'bg-neon/15 ring-1 ring-neon/40'
                            : 'hover:bg-surface-overlay/60'
                          }`}
                        >
                          <PokemonSprite name={fa.name} size="sm" />
                          <span
                            className="absolute bottom-0 right-0 text-[7px] font-bold rounded-tl px-[3px] py-[1px] leading-none text-white/90"
                            style={{ backgroundColor: `hsl(${Math.round(270 - ((Math.max(1, Math.min(20, fa.tier)) - 1) / 19) * 270)}, 75%, 45%)` }}
                          >
                            {fa.tier}
                          </span>
                          {fa.drafted && (
                            <span className="absolute top-0 left-0 text-[6px] font-bold text-text-muted bg-surface/80 rounded-br px-[2px]">{fa.draftedBy}</span>
                          )}
                        </button>
                      );
                    })}
                    {visibleAgents.length === 0 && (
                      <p className="text-[11px] text-text-muted py-8 text-center w-full">No results</p>
                    )}
                  </div>
                </div>

                {/* Comparison panel */}
                <div className="w-52 shrink-0 border-l border-border-subtle/30 p-3 flex flex-col">
                  {hovered ? (
                    <div className="space-y-2.5">
                      {/* Large preview */}
                      <div className="flex items-start gap-2.5">
                        <PokemonSprite name={hovered.name} size="xl" />
                        <div className="pt-1">
                          <div className="text-sm font-semibold text-text-primary leading-tight">{hovered.name}</div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <TierBadge points={hovered.tier} />
                            <span className="text-[10px] font-mono text-text-muted">{hovered.tier}pt</span>
                          </div>
                          {hovered.drafted && (
                            <div className="text-[9px] text-draw font-medium mt-1">Drafted by {hovered.draftedBy}</div>
                          )}
                        </div>
                      </div>

                      {/* Cost comparison */}
                      <div className="rounded bg-surface-overlay/40 p-2 space-y-1 text-[10px] font-mono">
                        <div className="flex justify-between">
                          <span className="text-text-muted">Cost</span>
                          <span>
                            {currentCost} <span className="text-text-muted">&rarr;</span> {hovered.tier}
                            <span className={`ml-1 font-semibold ${hoveredDelta > 0 ? 'text-loss' : hoveredDelta < 0 ? 'text-win' : 'text-text-muted'}`}>
                              ({hoveredDelta > 0 ? '+' : ''}{hoveredDelta})
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-text-muted">Team</span>
                          <span className={hoveredExceeds ? 'text-loss font-semibold' : 'text-text-primary'}>
                            {hoveredNewTotal}/{config.pointCap}
                          </span>
                        </div>
                      </div>

                      {/* Swap preview */}
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <PokemonSprite name={currentMon.name} size="xs" />
                        <span className="text-loss line-through truncate">{currentMon.name}</span>
                        <span className="text-text-muted shrink-0">&rarr;</span>
                        <span className="text-neon font-medium truncate">{hovered.name}</span>
                      </div>

                      {hoveredExceeds && <div className="text-[9px] text-loss font-semibold">Over point cap</div>}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-[10px] text-text-muted/50">
                      Hover to preview
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Point cap bar — centered, wide */}
        <div className="px-6 py-2.5 border-t border-border-subtle">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <div className="flex-1">
              <PointCapBar used={pointsUsed} total={config.pointCap} />
            </div>
            {pointsDelta !== 0 && (
              <span className={`text-[10px] font-mono font-semibold shrink-0 ${pointsDelta > 0 ? 'text-loss' : 'text-win'}`}>
                {pointsDelta > 0 ? '+' : ''}{pointsDelta}
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* ═══ MAIN CONTENT GRID ═══ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">

        {/* ─── ROSTER TABLE (2 cols) ─── */}
        <Card className="xl:col-span-2 bg-surface-raised border-border-default flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-text-primary tracking-tight">Roster</CardTitle>
              {theorycraftMode && swaps.length > 0 && (
                <button onClick={handleResetAll} className="flex items-center gap-1 text-xs text-text-muted hover:text-loss transition-colors">
                  <RotateCcw size={12} /> Reset all
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-subtle text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    <th className="px-3 py-2.5 text-left w-12">
                      <button onClick={() => handleSort('tier')} className="flex items-center gap-0.5 hover:text-neon transition-colors">
                        Cost <SortIcon k="tier" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-left">Pokemon</th>
                    <th className="px-3 py-2.5 text-left">Type</th>
                    <th className="px-3 py-2.5 text-left hidden lg:table-cell">Abilities</th>
                    <th className="px-3 py-2.5 text-right font-mono">
                      <button onClick={() => handleSort('kills')} className="flex items-center gap-0.5 hover:text-neon transition-colors ml-auto">
                        K <SortIcon k="kills" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-mono">
                      <button onClick={() => handleSort('deaths')} className="flex items-center gap-0.5 hover:text-neon transition-colors ml-auto">
                        D <SortIcon k="deaths" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-mono">GP</th>
                    <th className="px-3 py-2.5 text-right font-mono">
                      <button onClick={() => handleSort('kpg')} className="flex items-center gap-0.5 hover:text-neon transition-colors ml-auto">
                        KPG <SortIcon k="kpg" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-mono">
                      <button onClick={() => handleSort('spe')} className="flex items-center gap-0.5 hover:text-neon transition-colors ml-auto">
                        Spe <SortIcon k="spe" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRoster.map(({ mon, originalIndex }) => {
                    const isExpanded = expandedMon === originalIndex;
                    const isSwapped = swaps.some(s => s.index === originalIndex);
                    const effectiveCost = getEffectiveCost(mon.name, mon.isTeraCaptain);
                    const kpg = mon.seasonStats.gp ? (mon.seasonStats.kills / mon.seasonStats.gp).toFixed(1) : '—';

                    return (
                      <React.Fragment key={`${originalIndex}-${mon.name}`}>
                        <tr
                          className={`group border-b border-border-subtle/50 cursor-pointer transition-colors ${isSwapped ? 'bg-pink/5' : 'hover:bg-surface-overlay/40'}`}
                          onClick={() => setExpandedMon(isExpanded ? null : originalIndex)}
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1">
                              <TierBadge points={effectiveCost} />
                              {mon.isTeraCaptain && effectiveCost !== mon.tier && (
                                <span className="text-[9px] text-text-muted tabular-nums">({mon.tier})</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <PokemonSprite name={mon.name} size="sm" className="shrink-0" />
                              <span className={`text-sm font-medium ${mon.isTeraCaptain ? 'text-pink' : 'text-text-primary'} group-hover:text-neon transition-colors`}>
                                {mon.name}
                              </span>
                              {mon.isTeraCaptain && (
                                <Tooltip delayDuration={0}>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-pink/20 text-pink text-[8px] font-black border border-pink/40 cursor-default">T</span>
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="bg-surface-overlay border-border-default p-2">
                                    <div className="text-[9px] font-semibold text-pink uppercase tracking-wider mb-1.5">Tera Types</div>
                                    {mon.teraTypes && mon.teraTypes.length > 0 ? (
                                      <div className="flex gap-1">
                                        {mon.teraTypes.map(t => (
                                          <span
                                            key={t}
                                            className="text-[9px] font-bold uppercase rounded px-1.5 py-0.5 text-white"
                                            style={{ backgroundColor: TYPE_COLORS[t] }}
                                          >
                                            {TYPE_ABBR[t]}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-[10px] text-text-muted">No tera types set</span>
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              {isSwapped && <span className="text-[10px] text-pink">(swapped)</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <TypeChip types={mon.types} size="xs" />
                          </td>
                          <td className="px-3 py-2.5 hidden lg:table-cell">
                            <span className="text-[11px] text-text-muted">{mon.abilities.join(', ')}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-win">{mon.seasonStats.kills}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-loss">{mon.seasonStats.deaths}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs text-text-muted">{mon.seasonStats.gp}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs text-text-secondary font-semibold">{kpg}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs text-text-secondary">{mon.stats.spe}</td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-border-subtle/50">
                            <td colSpan={9} className="px-3 py-2 bg-surface-overlay/20">
                              <div className="ml-10 mr-4">
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                                  <StatBar label="HP" value={mon.stats.hp} />
                                  <StatBar label="SpA" value={mon.stats.spa} />
                                  <StatBar label="Atk" value={mon.stats.atk} />
                                  <StatBar label="SpD" value={mon.stats.spd} />
                                  <StatBar label="Def" value={mon.stats.def} />
                                  <StatBar label="Spe" value={mon.stats.spe} />
                                </div>
                                {mon.isTeraCaptain && mon.teraTypes && (
                                  <div className="mt-2 flex items-center gap-2">
                                    <span className="text-[10px] text-pink font-bold uppercase">Tera Types:</span>
                                    <div className="flex gap-1">{mon.teraTypes.map(t => <TypeBadge key={t} type={t} size="sm" />)}</div>
                                  </div>
                                )}
                                {mon.abilities.length > 0 && (
                                  <div className="mt-1.5 lg:hidden">
                                    <span className="text-[10px] text-text-muted font-bold uppercase">Abilities: </span>
                                    <span className="text-[11px] text-text-secondary">{mon.abilities.join(', ')}</span>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="px-4 py-2 border-t border-border-subtle flex items-center justify-between text-[11px] text-text-muted font-medium">
              <span className="font-mono">{activeRoster.length} mon &middot; {pointsUsed}/{config.pointCap}pt</span>
              <div className="flex items-center gap-3 font-mono">
                <span>Tera <span className={captainCount > config.teraCaptainSlots ? 'text-loss' : 'text-pink'}>{captainCount}</span>/{config.teraCaptainSlots}</span>
                <KDDisplay kills={teamKills} deaths={teamDeaths} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── RIGHT COLUMN — Tabbed, stretches to match roster ─── */}
        <Card className="bg-surface-raised border-border-default flex flex-col min-h-0">
          <Tabs defaultValue="defense" className="flex flex-col flex-1 min-h-0">
            <div className="border-b border-border-subtle">
              <TabsList variant="line" className="w-full justify-start px-2 h-9">
                <TabsTrigger value="defense" className="text-[11px] gap-1 px-2">
                  <Shield size={12} /> Defense
                </TabsTrigger>
                <TabsTrigger value="schedule" className="text-[11px] gap-1 px-2">
                  <Calendar size={12} /> Schedule
                </TabsTrigger>
                <TabsTrigger value="speed" className="text-[11px] gap-1 px-2">
                  <Zap size={12} /> Speed
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="defense" className="p-0 flex-1 overflow-y-auto">
              <TypeCoverageGridInner profile={typeProfile} />
            </TabsContent>

            <TabsContent value="schedule" className="p-0 flex-1 overflow-y-auto">
              <div className="p-3 space-y-0.5">
                {matches.map(match => {
                  const isHome = match.homePlayer === player.id;
                  const opponentId = isHome ? match.awayPlayer : match.homePlayer;
                  const opponent = players.find(p => p.id === opponentId);
                  if (!opponent) return null;

                  const hasResult = match.homeScore != null && match.awayScore != null;
                  const myScore = isHome ? match.homeScore : match.awayScore;
                  const theirScore = isHome ? match.awayScore : match.homeScore;
                  const won = hasResult && (myScore ?? 0) > (theirScore ?? 0);
                  const lost = hasResult && (myScore ?? 0) < (theirScore ?? 0);
                  const isCurrent = match.week === currentSeason.currentWeek + 1;

                  return (
                    <div key={match.id} className={`flex items-center gap-2 py-1.5 px-2 rounded transition-colors ${isCurrent ? 'bg-neon/5' : 'hover:bg-surface-overlay/30'}`}>
                      <span className="w-6 text-[10px] font-mono tabular-nums text-text-muted shrink-0 text-right">{match.week}</span>
                      {hasResult ? (
                        <span className={`w-4 text-center text-[10px] font-bold ${won ? 'text-win' : lost ? 'text-loss' : 'text-draw'}`}>
                          {won ? 'W' : lost ? 'L' : 'D'}
                        </span>
                      ) : (
                        <span className="w-4 text-center text-[10px] text-text-muted">—</span>
                      )}
                      <Link to={`/teams/${opponentId}`} className="flex items-center gap-1.5 flex-1 min-w-0">
                        <TeamLogo abbrev={opponent.teamAbbrev} color={opponent.teamColor} size="sm" />
                        <span className="text-xs text-text-secondary hover:text-neon transition-colors truncate font-medium">{opponent.teamAbbrev}</span>
                      </Link>
                      {hasResult && (
                        <span className="font-mono text-[11px] tabular-nums text-text-muted">
                          {myScore}<span className="mx-px">-</span>{theirScore}
                        </span>
                      )}
                      {match.replayUrl && (
                        <a href={match.replayUrl} className="text-text-muted/40 hover:text-neon transition-colors"><ExternalLink size={10} /></a>
                      )}
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="speed" className="p-0 flex-1 overflow-y-auto">
              <div className="p-3 space-y-1">
                {[...activeRoster]
                  .sort((a, b) => b.stats.spe - a.stats.spe)
                  .map((mon, i) => {
                    const maxSpe = Math.max(...activeRoster.map(m => m.stats.spe));
                    const pct = maxSpe > 0 ? (mon.stats.spe / maxSpe) * 100 : 0;
                    return (
                      <div key={`${mon.name}-${i}`} className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-surface-overlay/30 transition-colors">
                        <PokemonSprite name={mon.name} size="sm" className="shrink-0" />
                        <span className="text-[11px] text-text-secondary font-medium w-20 truncate">{mon.name}</span>
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

      {/* Floating drag cursor */}
      {isDragging && dragPos && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ left: dragPos.x - 16, top: dragPos.y - 16 }}
        >
          {dragType === 'tera' ? (
            <svg width="32" height="32" viewBox="0 0 18 18" style={{ filter: 'drop-shadow(0 0 8px rgba(232, 121, 249, 0.6))' }}>
              <circle cx="9" cy="9" r="8.5" fill="#e879f9" />
              <path d="M9 3 L13.5 7.5 L9 15 L4.5 7.5 Z" fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="round" opacity="0.9" />
              <path d="M4.5 7.5 L13.5 7.5" stroke="white" strokeWidth="0.8" opacity="0.5" />
            </svg>
          ) : dragType === 'position' && draggingPosFrom !== null ? (
            <div className="w-10 h-10 rounded-lg bg-surface-overlay/90 border border-neon/30 flex items-center justify-center shadow-glow-sm">
              <PokemonSprite name={activeRoster[draggingPosFrom].name} size="sm" />
            </div>
          ) : null}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TYPE COVERAGE GRID — 18-type matrix with clear visual encoding
// ═══════════════════════════════════════════════════════════════════

const TYPE_COLORS: Record<PokemonType, string> = {
  normal: '#a8a77a', fire: '#ee8130', water: '#6390f0', electric: '#f7d02c',
  grass: '#7ac74c', ice: '#96d9d6', fighting: '#c22e28', poison: '#a33ea1',
  ground: '#e2bf65', flying: '#a98ff3', psychic: '#f95587', bug: '#a6b91a',
  rock: '#b6a136', ghost: '#735797', dragon: '#6f35fc', dark: '#705746',
  steel: '#b7b7ce', fairy: '#d685ad',
};

const TYPE_ABBR: Record<PokemonType, string> = {
  normal: 'NOR', fire: 'FIR', water: 'WAT', electric: 'ELE', grass: 'GRA',
  ice: 'ICE', fighting: 'FIG', poison: 'POI', ground: 'GRO', flying: 'FLY',
  psychic: 'PSY', bug: 'BUG', rock: 'ROC', ghost: 'GHO', dragon: 'DRA',
  dark: 'DRK', steel: 'STL', fairy: 'FAI',
};

// ═══════════════════════════════════════════════════════════════════
// RANK BADGE — gold/silver/bronze for top 3, muted for others
// ═══════════════════════════════════════════════════════════════════

function StatBlock({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="font-mono text-base font-bold tabular-nums tracking-tight leading-none">{value}</div>
      <span className="text-[9px] font-medium text-text-muted uppercase tracking-widest mt-1.5">{label}</span>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) {
    const cls = `rank-badge rank-badge-${rank}`;
    return (
      <div className={`${cls} w-10 h-10 rounded-lg text-lg`}>
        #{rank}
      </div>
    );
  }

  if (rank <= 8) {
    return (
      <div className="w-10 h-10 rounded-lg bg-neon/10 border border-neon/20 flex items-center justify-center text-lg font-bold tabular-nums text-neon">
        #{rank}
      </div>
    );
  }

  return (
    <div className="w-10 h-10 rounded-lg bg-surface-overlay border border-border-subtle flex items-center justify-center text-lg font-bold tabular-nums text-text-muted">
      #{rank}
    </div>
  );
}

const DEF_COLORS = {
  loss: { bg: 'rgba(248,113,113,0.45)', hover: 'rgba(248,113,113,0.75)' },
  win:  { bg: 'rgba(74,222,128,0.3)',   hover: 'rgba(74,222,128,0.55)' },
  neon: { bg: 'rgba(34,211,238,0.35)',   hover: 'rgba(34,211,238,0.6)' },
} as const;

const DEF_LABEL_COLORS = { loss: 'text-loss', win: 'text-win', neon: 'text-neon' } as const;

function DefSegment({ name, label, color, pct }: { name: string; label: string; color: 'loss' | 'win' | 'neon'; pct: number }) {
  const [hovered, setHovered] = useState(false);
  const palette = DEF_COLORS[color];
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: `${pct}%`,
          minWidth: 6,
          height: '100%',
          backgroundColor: hovered ? palette.hover : palette.bg,
          transition: 'background-color 0.15s',
          display: 'block',
          cursor: 'default',
          borderRight: '1px solid rgba(10,10,15,0.3)',
        }}
      />
      <TooltipContent side="top" className="bg-surface-overlay border-border-default p-1.5 flex items-center gap-1.5">
        <PokemonSprite name={name} size="xs" />
        <span className="text-[10px] text-text-primary font-medium">{name}</span>
        <span className={`text-[9px] ${DEF_LABEL_COLORS[color]}`}>{label}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function TypeCoverageGridInner({ profile }: {
  profile: Record<PokemonType, TypeProfileEntry>;
}) {
  const maxCount = Math.max(
    ...POKEMON_TYPES.map(t => Math.max(profile[t].weak.length, profile[t].resist.length + profile[t].immune.length)),
    1
  );

  return (
    <div className="px-2 py-2 space-y-[3px]">
      {POKEMON_TYPES.map(type => {
        const { weak, resist, immune } = profile[type];
        const wk = weak.length, rs = resist.length, im = immune.length;
        const net = wk - rs - im;

        return (
          <div key={type} className="flex items-center gap-0 h-[26px] group/row">
            {/* Type badge */}
            <span
              className="text-[8px] font-bold uppercase w-[30px] text-center rounded-l py-[5px] text-white shrink-0 leading-none"
              style={{ backgroundColor: TYPE_COLORS[type] }}
            >
              {TYPE_ABBR[type]}
            </span>

            {/* Stacked bar — inline block segments with explicit sizing */}
            <div className="flex-1 h-full rounded-r overflow-hidden bg-surface-overlay/20" style={{ display: 'flex' }}>
              {weak.map(name => (
                <DefSegment key={`w-${name}`} name={name} label="weak" color="loss" pct={100 / maxCount} />
              ))}
              {resist.map(name => (
                <DefSegment key={`r-${name}`} name={name} label="resist" color="win" pct={100 / maxCount} />
              ))}
              {immune.map(name => (
                <DefSegment key={`i-${name}`} name={name} label="immune" color="neon" pct={100 / maxCount} />
              ))}
            </div>

            {/* Net score */}
            <div className="w-[38px] shrink-0 flex items-center justify-end gap-[3px] pr-1.5 font-mono text-[10px] tabular-nums">
              {wk > 0 && <span className="text-loss font-semibold">{wk}</span>}
              {rs > 0 && <span className="text-win">{rs}</span>}
              {im > 0 && <span className="text-neon font-semibold">{im}</span>}
              {wk === 0 && rs === 0 && im === 0 && <span className="text-text-muted/40">—</span>}
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 pt-2 text-[9px] text-text-muted">
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-loss/50" /> Weak</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-win/35" /> Resist</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-neon/40" /> Immune</span>
      </div>
    </div>
  );
}
