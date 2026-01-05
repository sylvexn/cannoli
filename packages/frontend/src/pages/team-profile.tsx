import { useParams, Link } from 'react-router-dom';
import React, { useState, useMemo } from 'react';
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
import {
  ArrowLeft, ExternalLink, FlaskConical, RotateCcw,
  ChevronDown, ChevronUp, X, Search, ArrowRightLeft,
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
function computeFreeAgents(allPlayers: Player[]): { name: string; tier: number; teraCost: number }[] {
  const drafted = new Set<string>();
  for (const p of allPlayers) {
    for (const mon of p.roster) drafted.add(mon.name);
  }
  return TIER_LIST
    .filter(entry => !drafted.has(entry.name))
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
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMon, setExpandedMon] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<'tier' | 'kills' | 'deaths' | 'kpg' | 'spe'>('tier');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const matches = useMemo(() => getTeamMatches(player.id), [player.id]);
  const freeAgents = useMemo(() => computeFreeAgents(players), []);

  // Apply swaps + tera edits
  const activeRoster = useMemo(() => {
    const roster = [...player.roster.map(mon => ({ ...mon }))];
    for (const swap of swaps) roster[swap.index] = { ...swap.replacement };
    for (const edit of teraEdits) {
      roster[edit.index] = { ...roster[edit.index], isTeraCaptain: edit.isTeraCaptain, teraTypes: edit.teraTypes.length > 0 ? edit.teraTypes : undefined };
    }
    return roster;
  }, [player.roster, swaps, teraEdits]);

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
    setSwappingIndex(null);
    setTeraEditingIndex(null);
    setDraggingTeraFrom(null);
    setSearchQuery('');
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

  const SortIcon = ({ k }: { k: typeof sortKey }) => {
    if (sortKey !== k) return null;
    return sortDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />;
  };

  const filteredAgents = useMemo(() => {
    if (!searchQuery) return freeAgents;
    const q = searchQuery.toLowerCase();
    return freeAgents.filter(fa => fa.name.toLowerCase().includes(q));
  }, [freeAgents, searchQuery]);

  // Group free agents by tier for the horizontal scroller
  const agentsByTier = useMemo(() => {
    const groups: Map<number, typeof filteredAgents> = new Map();
    for (const fa of filteredAgents) {
      const existing = groups.get(fa.tier) ?? [];
      existing.push(fa);
      groups.set(fa.tier, existing);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0] - a[0]);
  }, [filteredAgents]);

  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {/* Back nav */}
      <Link to="/" className="inline-flex items-center gap-1 text-[11px] font-medium text-text-muted hover:text-neon transition-colors uppercase tracking-widest">
        <ArrowLeft size={11} /> Standings
      </Link>

      {/* ═══ TEAM HEADER ═══ */}
      <div className="relative rounded-lg border border-border-default overflow-hidden bg-surface-raised">
        {/* Colored top accent line */}
        <div className="h-[2px]" style={{ background: `linear-gradient(90deg, ${player.teamColor}, transparent 80%)` }} />

        <div className="px-5 py-4 flex items-center gap-4">
          {/* Team identity */}
          <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="lg" className="w-11 h-11 text-xs shrink-0" />
          <div className="min-w-0 mr-2">
            <h1 className="text-base font-semibold text-text-primary tracking-tight leading-none">{player.teamName}</h1>
            <p className="text-[11px] text-text-muted mt-1 font-medium">
              {player.name} <span className="text-border-default mx-1">/</span> {player.teamAbbrev}
            </p>
          </div>

          {/* Stats cluster — tight, centered */}
          <div className="flex-1 flex items-center justify-center gap-5">
            <RankBadge rank={rank} />

            <div className="h-8 w-px bg-border-subtle/40" />

            <StatBlock
              value={<RecordDisplay wins={player.record.wins} losses={player.record.losses} differential={player.record.differential} />}
              label="Record"
            />

            <div className="h-8 w-px bg-border-subtle/40" />

            <StatBlock
              value={<><span className="text-win">{teamKills}</span><span className="text-text-muted/40">/</span><span className="text-loss">{teamDeaths}</span></>}
              label="K/D"
            />

            <div className="h-8 w-px bg-border-subtle/40" />

            <StatBlock
              value={<>{((player.record.wins / (player.record.wins + player.record.losses)) * 100).toFixed(0)}<span className="text-xs text-text-muted font-normal">%</span></>}
              label="Win Rate"
            />
          </div>

          {/* Theorycraft */}
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
      </div>

      {/* ═══ SPRITE SHOWCASE + POINT CAP + TERA ═══ */}
      <Card className="bg-surface-raised border-border-default overflow-hidden">
        <div className="flex items-center justify-center gap-1 px-4 py-3 flex-wrap">
          {activeRoster.map((mon, i) => {
            const isSwapped = swaps.some(s => s.index === i);
            const isSwapping = swappingIndex === i;
            const effectiveCost = getEffectiveCost(mon.name, mon.isTeraCaptain);
            const isDragOver = dragOverIndex === i && draggingTeraFrom !== null && draggingTeraFrom !== i;
            const canDrop = isDragOver && canBeTeraCaptain(mon.name);
            return (
              <div
                key={`${mon.name}-${i}`}
                className="relative group"
                onDragOver={(e) => {
                  if (draggingTeraFrom !== null && draggingTeraFrom !== i) {
                    e.preventDefault();
                    setDragOverIndex(i);
                  }
                }}
                onDragLeave={() => { if (dragOverIndex === i) setDragOverIndex(null); }}
                onDrop={(e) => { e.preventDefault(); handleTeraDrop(i); setDragOverIndex(null); }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={`relative cursor-default p-1.5 rounded-lg transition-all duration-200 hover:bg-surface-overlay/60 ${isSwapped ? 'ring-1 ring-pink/40' : ''} ${isSwapping ? 'ring-2 ring-neon/60 bg-neon/5' : ''} ${canDrop ? 'ring-2 ring-pink/60 bg-pink/5' : ''} ${isDragOver && !canDrop ? 'ring-2 ring-loss/40 bg-loss/5' : ''}`}>
                      <PokemonSprite name={mon.name} size="xl" className="transition-transform duration-200 group-hover:scale-110" />
                      {mon.isTeraCaptain && (
                        <div
                          draggable={theorycraftMode}
                          onDragStart={(e) => {
                            if (!theorycraftMode) return;
                            setDraggingTeraFrom(i);
                            e.dataTransfer.effectAllowed = 'move';
                            // Tiny drag image
                            const el = document.createElement('div');
                            el.textContent = 'T';
                            el.style.cssText = 'width:20px;height:20px;border-radius:50%;background:#e879f9;color:white;font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center;position:absolute;top:-100px;left:-100px;';
                            document.body.appendChild(el);
                            e.dataTransfer.setDragImage(el, 10, 10);
                            setTimeout(() => document.body.removeChild(el), 0);
                          }}
                          onDragEnd={() => { setDraggingTeraFrom(null); setDragOverIndex(null); }}
                          onClick={(e) => {
                            if (!theorycraftMode) return;
                            e.stopPropagation();
                            setTeraEditingIndex(teraEditingIndex === i ? null : i);
                          }}
                          className={`absolute top-1 right-1 w-4 h-4 rounded-full bg-pink shadow-glow-pink-sm flex items-center justify-center ${theorycraftMode ? 'cursor-grab active:cursor-grabbing hover:scale-125 transition-transform' : ''}`}
                        >
                          <span className="text-[7px] font-black text-white">T</span>
                        </div>
                      )}
                      {/* Empty captain slot indicator in theorycraft mode */}
                      {theorycraftMode && !mon.isTeraCaptain && canBeTeraCaptain(mon.name) && captainCount < config.teraCaptainSlots && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleCaptain(i); }}
                          className="absolute top-1 right-1 w-4 h-4 rounded-full border border-dashed border-pink/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-pink/10 hover:border-pink/60"
                          title="Make tera captain"
                        >
                          <span className="text-[7px] font-black text-pink/40">T</span>
                        </button>
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

        {/* Swap picker — horizontal tier-grouped scroller */}
        {swappingIndex !== null && theorycraftMode && (() => {
          const currentMon = activeRoster[swappingIndex];
          const currentCost = getEffectiveCost(currentMon.name, currentMon.isTeraCaptain);
          return (
            <div className="border-t border-border-subtle bg-surface-overlay/30">
              {/* Header bar */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-border-subtle/50">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <ArrowRightLeft size={12} className="text-neon" />
                  Replacing <span className="text-text-primary font-medium">{currentMon.name}</span>
                  <span className="text-text-muted">({currentCost}pt)</span>
                </div>
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                  <Search size={13} className="text-text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Filter..."
                    className="w-40 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
                    autoFocus
                  />
                </div>
                <button onClick={() => { setSwappingIndex(null); setSearchQuery(''); setHoveredAgent(null); }} className="text-text-muted hover:text-text-primary p-1">
                  <X size={14} />
                </button>
              </div>

              {/* Tier rows */}
              <div className="max-h-[320px] overflow-y-auto">
                {agentsByTier.map(([tier, agents]) => {
                  const pointDelta = tier - currentCost;
                  const tierExceeds = (pointsUsed + pointDelta) > config.pointCap;
                  return (
                    <div key={tier} className="flex items-start border-b border-border-subtle/30 last:border-0">
                      {/* Tier label (sticky left) */}
                      <div className="w-12 shrink-0 flex flex-col items-center justify-center py-2 sticky left-0 bg-surface-raised/80 z-10">
                        <TierBadge points={tier} />
                        <span className={`text-[9px] tabular-nums mt-0.5 ${pointDelta > 0 ? 'text-loss' : pointDelta < 0 ? 'text-win' : 'text-text-muted'}`}>
                          {pointDelta > 0 ? '+' : ''}{pointDelta}
                        </span>
                      </div>

                      {/* Horizontal scroll of sprites */}
                      <div className="flex-1 overflow-x-auto">
                        <div className="flex items-start gap-0.5 py-1.5 px-1">
                          {agents.map(fa => {
                            const wouldExceed = (pointsUsed + fa.tier - currentCost) > config.pointCap;
                            const isHovered = hoveredAgent === fa.name;
                            return (
                              <div
                                key={fa.name}
                                className="relative shrink-0"
                                onMouseEnter={() => setHoveredAgent(fa.name)}
                                onMouseLeave={() => setHoveredAgent(null)}
                              >
                                <button
                                  onClick={() => { handleSwap(swappingIndex, freeAgentToRoster(fa)); setHoveredAgent(null); }}
                                  disabled={wouldExceed}
                                  className={`relative flex flex-col items-center rounded-lg transition-all duration-200 ease-out ${
                                    wouldExceed
                                      ? 'opacity-20 cursor-not-allowed'
                                      : isHovered
                                        ? 'bg-neon/10 ring-1 ring-neon/40 shadow-glow-sm scale-110 z-20 -mx-1 px-2 py-1'
                                        : 'hover:bg-surface-overlay/60 px-1 py-1'
                                  }`}
                                >
                                  <PokemonSprite
                                    name={fa.name}
                                    size={isHovered ? 'lg' : 'sm'}
                                    className="transition-all duration-200"
                                  />
                                  <span className={`text-center leading-tight transition-all duration-200 ${
                                    isHovered ? 'text-[10px] text-neon font-medium mt-0.5 max-w-[80px]' : 'text-[8px] text-text-muted mt-0.5 max-w-[40px]'
                                  } truncate block`}>
                                    {fa.name}
                                  </span>
                                </button>

                                {/* Expanded comparison card on hover */}
                                {isHovered && !wouldExceed && (
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-30 w-56 rounded-lg bg-surface-raised border border-neon/20 shadow-glow-sm p-2.5 pointer-events-none">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-xs font-semibold text-text-primary">{fa.name}</span>
                                      <TierBadge points={fa.tier} />
                                    </div>

                                    {/* Comparison */}
                                    <div className="space-y-1.5 text-[10px]">
                                      <div className="flex items-center justify-between">
                                        <span className="text-text-muted">Point cost</span>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-text-secondary">{currentCost}</span>
                                          <span className="text-text-muted">&rarr;</span>
                                          <span className="text-text-primary font-medium">{fa.tier}</span>
                                          <span className={`font-bold ${pointDelta > 0 ? 'text-loss' : pointDelta < 0 ? 'text-win' : 'text-text-muted'}`}>
                                            ({pointDelta > 0 ? '+' : ''}{pointDelta})
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-text-muted">Team total</span>
                                        <div className="flex items-center gap-1">
                                          <span className="text-text-secondary">{pointsUsed}</span>
                                          <span className="text-text-muted">&rarr;</span>
                                          <span className={`font-medium ${(pointsUsed + fa.tier - currentCost) > config.pointCap ? 'text-loss' : 'text-text-primary'}`}>
                                            {pointsUsed + fa.tier - currentCost}/{config.pointCap}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Outgoing mon comparison */}
                                    <div className="mt-2 pt-2 border-t border-border-subtle flex items-center gap-2">
                                      <div className="flex items-center gap-1 flex-1 min-w-0">
                                        <PokemonSprite name={currentMon.name} size="xs" />
                                        <span className="text-[10px] text-loss line-through truncate">{currentMon.name}</span>
                                      </div>
                                      <span className="text-text-muted text-[10px]">&rarr;</span>
                                      <div className="flex items-center gap-1 flex-1 min-w-0">
                                        <PokemonSprite name={fa.name} size="xs" />
                                        <span className="text-[10px] text-neon font-medium truncate">{fa.name}</span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {agentsByTier.length === 0 && (
                  <p className="text-xs text-text-muted py-4 text-center">No Pokemon match your search</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Point cap & tera captain info */}
        <div className="px-4 py-2.5 border-t border-border-subtle flex items-center gap-6">
          <div className="flex-1 max-w-xs">
            <PointCapBar used={pointsUsed} total={config.pointCap} />
          </div>
          {pointsDelta !== 0 && (
            <span className={`text-[10px] font-mono font-medium ${pointsDelta > 0 ? 'text-loss' : 'text-win'}`}>
              {pointsDelta > 0 ? '+' : ''}{pointsDelta}pt
            </span>
          )}
          <div className="text-[11px] text-text-muted font-medium">
            Tera <span className={captainCount > config.teraCaptainSlots ? 'text-loss' : 'text-pink'}>{captainCount}<span className="text-text-muted">/{config.teraCaptainSlots}</span></span>
          </div>
        </div>
      </Card>

      {/* ═══ MAIN CONTENT GRID ═══ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ─── ROSTER TABLE (2 cols) ─── */}
        <Card className="xl:col-span-2 bg-surface-raised border-border-default">
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
                                <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-pink/20 text-pink text-[8px] font-black border border-pink/40">T</span>
                              )}
                              {isSwapped && <span className="text-[10px] text-pink">(swapped)</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-col gap-1">
                              <TypeChip types={mon.types} size="xs" />
                              {mon.isTeraCaptain && mon.teraTypes && mon.teraTypes.length > 0 && (
                                <div className="flex items-center gap-px">
                                  <span className="inline-flex items-center justify-center w-3 h-3 rounded-[2px] bg-pink/15 text-pink text-[6px] font-black shrink-0 mr-0.5">t</span>
                                  {mon.teraTypes.map(t => (
                                    <span
                                      key={t}
                                      className="text-[6px] font-bold uppercase rounded-[2px] px-[3px] py-[1px] text-white/90 leading-none"
                                      style={{ backgroundColor: TYPE_COLORS[t] }}
                                    >
                                      {TYPE_ABBR[t]}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
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
              <span className="font-mono"><KDDisplay kills={teamKills} deaths={teamDeaths} /></span>
            </div>
          </CardContent>
        </Card>

        {/* ─── RIGHT COLUMN ─── */}
        <div className="space-y-6">

          {/* ─── TYPE COVERAGE GRID ─── */}
          <TypeCoverageGrid profile={typeProfile} />

          {/* ─── SCHEDULE ─── */}
          <Card className="bg-surface-raised border-border-default">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-text-primary tracking-tight">Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
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
                    <span className="w-8 text-[10px] font-mono tabular-nums text-text-muted shrink-0">{match.week}</span>
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
            </CardContent>
          </Card>

          {/* ─── SPEED TIERS ─── */}
          <Card className="bg-surface-raised border-border-default">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-text-primary tracking-tight">Speed Tiers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-px">
              {[...activeRoster]
                .sort((a, b) => b.stats.spe - a.stats.spe)
                .map((mon, i) => {
                  const maxSpe = Math.max(...activeRoster.map(m => m.stats.spe));
                  const pct = maxSpe > 0 ? (mon.stats.spe / maxSpe) * 100 : 0;
                  return (
                    <div key={`${mon.name}-${i}`} className="flex items-center gap-2 py-1">
                      <PokemonSprite name={mon.name} size="xs" className="shrink-0" />
                      <div className="flex-1 h-1.5 rounded-full bg-surface-overlay overflow-hidden">
                        <div className="h-full rounded-full bg-neon/60" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-text-secondary w-8 text-right">{mon.stats.spe}</span>
                    </div>
                  );
                })
              }
            </CardContent>
          </Card>
        </div>
      </div>
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

function cellColor(weak: number, resist: number, immune: number): string {
  if (immune > 0 && weak === 0) return 'rgba(34, 211, 238, 0.25)';
  const net = weak - resist - immune;
  if (net >= 3) return 'rgba(248, 113, 113, 0.5)';
  if (net >= 1) return 'rgba(248, 113, 113, 0.25)';
  if (net <= -3) return 'rgba(74, 222, 128, 0.35)';
  if (net <= -1) return 'rgba(74, 222, 128, 0.18)';
  return 'transparent';
}

function PipTooltip({ name, category }: { name: string; category: 'weak' | 'resist' | 'immune' }) {
  const colorClass = category === 'weak' ? 'bg-loss/70 hover:bg-loss' : category === 'resist' ? 'bg-win/50 hover:bg-win/70' : 'bg-neon/60 hover:bg-neon/80';
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button className={`w-[10px] h-3 rounded-sm cursor-default transition-colors shrink-0 ${colorClass}`} />
      </TooltipTrigger>
      <TooltipContent side="top" className="bg-surface-overlay border-border-default p-1.5 flex items-center gap-1.5">
        <PokemonSprite name={name} size="xs" />
        <span className="text-[10px] text-text-primary font-medium">{name}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function TypeCoverageGrid({ profile }: {
  profile: Record<PokemonType, TypeProfileEntry>;
}) {
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-text-primary tracking-tight">Defensive Profile</CardTitle>
        <p className="text-[9px] text-text-muted mt-0.5 tracking-wide">
          Hover pips for details
        </p>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <div className="grid grid-cols-2 gap-[2px]">
          {POKEMON_TYPES.map(type => {
            const { weak, resist, immune } = profile[type];
            const wk = weak.length, rs = resist.length, im = immune.length;
            const bg = cellColor(wk, rs, im);
            const hasAny = wk > 0 || rs > 0 || im > 0;

            return (
              <div
                key={type}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded transition-colors"
                style={{ backgroundColor: bg }}
              >
                {/* Type label */}
                <span
                  className="text-[9px] font-bold uppercase w-7 text-center rounded py-0.5 text-white shrink-0"
                  style={{ backgroundColor: TYPE_COLORS[type] }}
                >
                  {TYPE_ABBR[type]}
                </span>

                {/* Pip bar — each pip is an individual Pokemon */}
                <div className="flex-1 flex items-center gap-[2px] h-3">
                  {weak.map(name => (
                    <PipTooltip key={`w-${name}`} name={name} category="weak" />
                  ))}
                  {!hasAny && (
                    <div className="h-full flex-1 rounded-sm bg-surface-overlay/50 max-w-[10px]" />
                  )}
                  {resist.map(name => (
                    <PipTooltip key={`r-${name}`} name={name} category="resist" />
                  ))}
                  {immune.map(name => (
                    <PipTooltip key={`i-${name}`} name={name} category="immune" />
                  ))}
                </div>

                {/* Count labels */}
                <div className="flex items-center gap-1 shrink-0 tabular-nums text-[10px]">
                  {wk > 0 && <span className="text-loss font-bold">{wk}</span>}
                  {rs > 0 && <span className="text-win">{rs}</span>}
                  {im > 0 && <span className="text-neon font-bold">{im}</span>}
                  {!hasAny && <span className="text-text-muted">—</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-2 text-[9px] text-text-muted">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-loss/70" /> Weak</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-win/50" /> Resist</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-neon/60" /> Immune</span>
        </div>
      </CardContent>
    </Card>
  );
}
