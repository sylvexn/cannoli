import { useState, useMemo } from 'react';
import type { RosterPokemon } from '@/lib/types';
import type { LeagueConfig } from '@/lib/types';
import { getTermCost } from '@/data/tier-list';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { ArrowRightLeft, Plus, Search, X } from 'lucide-react';
import { freeAgentToRoster } from './utils';
import type { PoolEntry } from './utils';
import { tierToHslColor } from '@/lib/utils';

interface SwapPickerProps {
  swappingIndex: number;
  activeRoster: RosterPokemon[];
  pool: PoolEntry[];
  pointsUsed: number;
  config: LeagueConfig;
  onSwap: (index: number, replacement: RosterPokemon) => void;
  onClose: () => void;
}

export function SwapPicker({
  swappingIndex,
  activeRoster,
  pool,
  pointsUsed,
  config,
  onSwap,
  onClose,
}: SwapPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showTaken, setShowTaken] = useState(false);
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  const currentMon = activeRoster[swappingIndex];
  const currentCost = currentMon.isTeraCaptain ? getTermCost(currentMon.tier) : currentMon.tier;

  const filteredAgents = useMemo(() => {
    let list = showTaken ? pool : pool.filter(p => !p.drafted);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [pool, searchQuery, showTaken]);

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
        <button onClick={onClose} className="text-text-muted hover:text-text-primary ml-1"><X size={12} /></button>
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
                  onClick={() => { if (!wouldExceed && (!fa.drafted || showTaken)) { onSwap(swappingIndex, freeAgentToRoster(fa)); setHoveredAgent(null); } }}
                  onMouseEnter={() => setHoveredAgent(fa.name)}
                  onMouseLeave={() => { if (hoveredAgent === fa.name) setHoveredAgent(null); }}
                  disabled={wouldExceed || (fa.drafted && !showTaken)}
                  className={`relative w-11 h-11 rounded flex items-center justify-center transition-colors ${
                    fa.drafted && !showTaken ? 'opacity-25 cursor-not-allowed'
                    : wouldExceed ? 'opacity-15 cursor-not-allowed'
                    : isHov ? 'bg-neon/15 ring-1 ring-neon/40'
                    : 'hover:bg-surface-overlay/60'
                  }`}
                >
                  <PokemonSprite name={fa.name} size="sm" />
                  <span
                    className="absolute bottom-0 right-0 text-[7px] font-bold rounded-tl px-[3px] py-[1px] leading-none text-white/90"
                    style={{ backgroundColor: tierToHslColor(fa.tier) }}
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
}

// ─── Add Picker ─────────────────────────────────────────────────

interface AddPickerProps {
  activeRoster: RosterPokemon[];
  pool: PoolEntry[];
  pointsUsed: number;
  config: LeagueConfig;
  onAdd: (mon: RosterPokemon) => void;
  onClose: () => void;
}

export function AddPicker({
  activeRoster,
  pool,
  pointsUsed,
  config,
  onAdd,
  onClose,
}: AddPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showTaken, setShowTaken] = useState(false);
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  const rosterNames = new Set(activeRoster.map(m => m.name));
  const remaining = config.pointCap - pointsUsed;

  const filteredAgents = useMemo(() => {
    let list = showTaken ? pool : pool.filter(p => !p.drafted);
    // Exclude Pokemon already on roster
    list = list.filter(p => !rosterNames.has(p.name));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [pool, searchQuery, showTaken, rosterNames]);

  const visibleAgents = filteredAgents.slice(0, 200);
  const hovered = hoveredAgent ? filteredAgents.find(a => a.name === hoveredAgent) : null;

  return (
    <div className="border-t border-border-subtle bg-surface-overlay/15">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle/30 text-[10px]">
        <Plus size={10} className="text-neon shrink-0" />
        <span className="text-text-muted">Add Pokemon</span>
        <span className="font-mono text-text-muted">({activeRoster.length}/12)</span>
        <span className="text-text-muted mx-1">&middot;</span>
        <span className="font-mono text-text-muted">{remaining}pt left</span>
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
        <button onClick={onClose} className="text-text-muted hover:text-text-primary ml-1"><X size={12} /></button>
      </div>

      <div className="flex" style={{ height: 320 }}>
        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="flex flex-wrap gap-[3px] content-start">
            {visibleAgents.map(fa => {
              const wouldExceed = fa.tier > remaining;
              const isHov = hoveredAgent === fa.name;
              return (
                <button
                  key={fa.name}
                  onClick={() => { if (!wouldExceed && (!fa.drafted || showTaken)) onAdd(freeAgentToRoster(fa)); }}
                  onMouseEnter={() => setHoveredAgent(fa.name)}
                  onMouseLeave={() => { if (hoveredAgent === fa.name) setHoveredAgent(null); }}
                  disabled={wouldExceed || (fa.drafted && !showTaken)}
                  className={`relative w-11 h-11 rounded flex items-center justify-center transition-colors ${
                    fa.drafted && !showTaken ? 'opacity-25 cursor-not-allowed'
                    : wouldExceed ? 'opacity-15 cursor-not-allowed'
                    : isHov ? 'bg-neon/15 ring-1 ring-neon/40'
                    : 'hover:bg-surface-overlay/60'
                  }`}
                >
                  <PokemonSprite name={fa.name} size="sm" />
                  <span
                    className="absolute bottom-0 right-0 text-[7px] font-bold rounded-tl px-[3px] py-[1px] leading-none text-white/90"
                    style={{ backgroundColor: tierToHslColor(fa.tier) }}
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

        {/* Preview panel */}
        <div className="w-52 shrink-0 border-l border-border-subtle/30 p-3 flex flex-col">
          {hovered ? (
            <div className="space-y-2.5">
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
              <div className="rounded bg-surface-overlay/40 p-2 space-y-1 text-[10px] font-mono">
                <div className="flex justify-between">
                  <span className="text-text-muted">Cost</span>
                  <span className="text-text-primary">{hovered.tier}pt</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Team after</span>
                  <span className={hovered.tier > remaining ? 'text-loss font-semibold' : 'text-text-primary'}>
                    {pointsUsed + hovered.tier}/{config.pointCap}
                  </span>
                </div>
              </div>
              {hovered.tier > remaining && <div className="text-[9px] text-loss font-semibold">Over point cap</div>}
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
}
