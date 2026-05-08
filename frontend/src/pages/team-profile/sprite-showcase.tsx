import React from 'react';
import { createPortal } from 'react-dom';
import type { Player, RosterPokemon, LeagueConfig, LeagueSeason, User } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';
import { getEffectiveCost } from '@/data/tier-list';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { PointCapBarLarge } from '@/components/point-cap-bar';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RotateCcw, X, ArrowRightLeft, Plus, Sparkles } from 'lucide-react';
import { SwapPicker, AddPicker } from './theorycraft-mode';
import { TeraCaptainStrip } from './tera-captain-strip';
import type { SwapEntry, TeraEdit } from './utils';

interface SpriteShowcaseProps {
  player: Player;
  config: LeagueConfig;
  activeRoster: RosterPokemon[];
  swaps: SwapEntry[];
  rosterOrder: number[];
  pool: RosterPokemon[];
  pointsUsed: number;
  pointsDelta: number;
  captainCount: number;
  theorycraftMode: boolean;
  /** True if the viewer can take manager actions on this team (owner OR staff). */
  canManage: boolean;
  user: User | null;
  season: LeagueSeason | null | undefined;

  // sprite-row interactive state
  swappingIndex: number | null;
  addingMode: boolean;
  teraEditingIndex: number | null;
  teraEdits: TeraEdit[];
  draggingPosFrom: number | null;
  dragOverIndex: number | null;
  dragPos: { x: number; y: number } | null;

  // refs / shiny
  spriteRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  isMonShiny: (mon: RosterPokemon) => boolean;

  // handlers
  onPointerDownSprite: (index: number, e: React.PointerEvent) => void;
  onSetSwappingIndex: (i: number | null) => void;
  onSetAddingMode: (v: boolean) => void;
  onSetTeraEditingIndex: (i: number | null) => void;
  onRevertSwap: (index: number) => void;
  onRemoveMon: (displayIndex: number) => void;
  onToggleShiny: (mon: RosterPokemon) => void;
  onSwap: (index: number, replacement: RosterPokemon) => void;
  onAddMon: (mon: RosterPokemon) => void;
  onToggleCaptain: (index: number) => void;
  onTeraTypeToggle: (index: number, type: PokemonType) => void;
  onTeraEditsClear: () => void;
}

export function SpriteShowcase({
  player,
  config,
  activeRoster,
  swaps,
  rosterOrder,
  pool,
  pointsUsed,
  pointsDelta,
  captainCount,
  theorycraftMode,
  canManage,
  user,
  season,
  swappingIndex,
  addingMode,
  teraEditingIndex,
  teraEdits,
  draggingPosFrom,
  dragOverIndex,
  dragPos,
  spriteRefs,
  isMonShiny,
  onPointerDownSprite,
  onSetSwappingIndex,
  onSetAddingMode,
  onSetTeraEditingIndex,
  onRevertSwap,
  onRemoveMon,
  onToggleShiny,
  onSwap,
  onAddMon,
  onToggleCaptain,
  onTeraTypeToggle,
  onTeraEditsClear,
}: SpriteShowcaseProps) {
  const isDragging = draggingPosFrom !== null;

  return (
    <>
      <Card className="bg-surface-raised border-border-default overflow-hidden">
        <div className="flex items-center justify-center gap-1 px-4 py-3 flex-wrap">
          {activeRoster.map((mon, i) => {
            const isSwapped = swaps.some(s => s.index === (rosterOrder[i] ?? i));
            const isSwapping = swappingIndex === i;
            const effectiveCost = getEffectiveCost(mon.name, mon.isTeraCaptain);
            const isPosOver = dragOverIndex === i && draggingPosFrom !== null && draggingPosFrom !== i;
            const beingDragged = draggingPosFrom === i;
            return (
              <div
                key={`${mon.name}-${i}`}
                className="relative group flex flex-col items-center"
                ref={(el) => { if (el) spriteRefs.current.set(i, el); else spriteRefs.current.delete(i); }}
              >
                <Tooltip>
                  <TooltipTrigger>
                    <div
                      onPointerDown={(e) => {
                        // Only start position drag from the sprite body (not tera badge)
                        if ((e.target as HTMLElement).closest('svg')) return;
                        onPointerDownSprite(i, e);
                      }}
                      className={`relative p-1.5 rounded-lg transition-all duration-200 ${
                        theorycraftMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                      } ${isSwapped ? 'ring-1 ring-pink/40' : ''
                      } ${isSwapping ? 'ring-2 ring-neon/60 bg-neon/5' : ''
                      } ${isPosOver ? 'ring-2 ring-neon/50 bg-neon/8 scale-105' : ''
                      } ${beingDragged ? 'opacity-30 scale-95' : 'hover:bg-surface-overlay/60'
                      }`}
                    >
                      <PokemonSprite name={mon.name} size="xl" shiny={isMonShiny(mon)} className={`transition-transform duration-200 ${!beingDragged ? 'group-hover:scale-110' : ''}`} />
                      {mon.isTeraCaptain && (
                        <svg
                          width="27"
                          height="27"
                          viewBox="0 0 18 18"
                          onClick={(e) => {
                            if (!theorycraftMode) return;
                            e.stopPropagation();
                            onSetTeraEditingIndex(teraEditingIndex === i ? null : i);
                          }}
                          className={`absolute top-0.5 right-0.5 select-none ${theorycraftMode ? 'cursor-pointer hover:scale-110 transition-transform' : ''}`}
                          style={{ filter: 'drop-shadow(0 0 5px rgba(232, 121, 249, 0.5))' }}
                        >
                          <circle cx="9" cy="9" r="8.5" fill="#e879f9" />
                          <circle cx="9" cy="9" r="7.5" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.5" />
                          <path d="M9 3 L13.5 7.5 L9 15 L4.5 7.5 Z" fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="round" opacity="0.9" />
                          <path d="M4.5 7.5 L13.5 7.5" stroke="white" strokeWidth="0.8" opacity="0.5" />
                          <path d="M9 3 L9 7.5" stroke="white" strokeWidth="0.6" opacity="0.35" />
                        </svg>
                      )}
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
                        <TierBadge points={effectiveCost} />
                      </div>
                      {/* Swap button on hover (theorycraft mode only) */}
                      {theorycraftMode && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onSetSwappingIndex(isSwapping ? null : i); }}
                          className={`absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-all p-1 rounded-md ${
                            isSwapping ? 'opacity-100 bg-neon/20 text-neon' : isSwapped ? 'opacity-100 bg-pink/20 text-pink' : 'bg-surface/80 text-text-muted hover:text-neon hover:bg-neon/10'
                          }`}
                        >
                          {isSwapped ? <RotateCcw size={13} onClick={(e) => { e.stopPropagation(); onRevertSwap(i); }} /> : <ArrowRightLeft size={13} />}
                        </button>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="bg-surface-overlay border-border-default text-xs">
                    <span className="font-semibold text-text-primary">{mon.name}</span>
                    {mon.nickname && (
                      <span className="italic text-text-muted ml-2 font-mono">"{mon.nickname}"</span>
                    )}
                    <span className="text-text-muted ml-2">{effectiveCost}pt{mon.isTeraCaptain ? ` (base ${mon.tier})` : ''}</span>
                  </TooltipContent>
                </Tooltip>
                {/* Shiny toggle button — any authenticated user (backend checks ownership) */}
                {user && !theorycraftMode && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleShiny(mon); }}
                    className={`absolute bottom-7 left-1 z-10 transition-all p-1 rounded-md ${
                      isMonShiny(mon)
                        ? 'opacity-100 bg-yellow-500/20 text-yellow-400'
                        : 'opacity-0 group-hover:opacity-100 bg-surface/80 text-text-muted hover:text-yellow-400 hover:bg-yellow-500/10'
                    }`}
                  >
                    <Sparkles size={13} />
                  </button>
                )}
                {/* Remove button */}
                {theorycraftMode && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveMon(i); }}
                    className="absolute top-0 right-0 z-20 w-5 h-5 flex items-center justify-center rounded-full bg-loss text-white shadow-md hover:scale-110 transition-transform cursor-pointer"
                  >
                    <X size={11} strokeWidth={3} />
                  </button>
                )}
                {/* Nickname under sprite */}
                {mon.nickname && (
                  <div
                    className="max-w-[88px] truncate text-center text-[9px] italic font-mono text-text-muted leading-tight -mt-0.5"
                    title={mon.nickname}
                  >
                    "{mon.nickname}"
                  </div>
                )}
              </div>
            );
          })}
          {/* Add Pokemon button (theorycraft, max 12) */}
          {theorycraftMode && activeRoster.length < 12 && (
            <Tooltip>
              <TooltipTrigger>
                <button
                  onClick={() => { onSetAddingMode(!addingMode); onSetSwappingIndex(null); }}
                  className={`relative p-1.5 rounded-lg transition-all duration-200 w-[76px] h-[76px] flex items-center justify-center border-2 border-dashed ${
                    addingMode
                      ? 'border-neon/60 bg-neon/5 text-neon'
                      : 'border-border-subtle hover:border-neon/40 text-text-muted hover:text-neon hover:bg-surface-overlay/40'
                  }`}
                >
                  <Plus size={24} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="bg-surface-overlay border-border-default text-xs">
                Add Pokemon ({activeRoster.length}/12)
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Swap picker */}
        {swappingIndex !== null && theorycraftMode && !addingMode && (
          <SwapPicker
            swappingIndex={swappingIndex}
            activeRoster={activeRoster}
            // WIP: prop typed RosterPokemon[] but downstream picker expects PoolEntry[]; cast at boundary
            pool={pool as unknown as import('./utils').PoolEntry[]}
            pointsUsed={pointsUsed}
            config={config}
            onSwap={onSwap}
            onClose={() => { onSetSwappingIndex(null); }}
          />
        )}

        {/* Add picker */}
        {addingMode && theorycraftMode && (
          <AddPicker
            activeRoster={activeRoster}
            // WIP: prop typed RosterPokemon[] but downstream picker expects PoolEntry[]; cast at boundary
            pool={pool as unknown as import('./utils').PoolEntry[]}
            pointsUsed={pointsUsed}
            config={config}
            onAdd={onAddMon}
            onClose={() => onSetAddingMode(false)}
          />
        )}

        {/* ─── TERA CAPTAINS STRIP ─── */}
        <TeraCaptainStrip
          activeRoster={activeRoster}
          captainCount={captainCount}
          config={config}
          theorycraftMode={theorycraftMode}
          canEdit={theorycraftMode || canManage}
          seasonPhase={season?.phase ?? null}
          teraEdits={teraEdits}
          teraEditingIndex={teraEditingIndex}
          pointsUsed={pointsUsed}
          playerId={player.id}
          onTeraEditingIndexChange={onSetTeraEditingIndex}
          onToggleCaptain={onToggleCaptain}
          onTeraTypeToggle={onTeraTypeToggle}
          onTeraEditsClear={onTeraEditsClear}
        />

        {/* Point cap bar */}
        <div className="px-6 py-3 border-t border-border-subtle">
          <div className="max-w-xl mx-auto flex items-center gap-3">
            <PointCapBarLarge used={pointsUsed} total={config.pointCap} className="flex-1" />
            {pointsDelta !== 0 && (
              <span className={`text-[10px] font-mono font-semibold shrink-0 ${pointsDelta > 0 ? 'text-loss' : 'text-win'}`}>
                {pointsDelta > 0 ? '+' : ''}{pointsDelta}
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* Floating drag cursor */}
      {isDragging && dragPos && draggingPosFrom !== null && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ left: dragPos.x - 16, top: dragPos.y - 16 }}
        >
          <div className="w-10 h-10 rounded-lg bg-surface-overlay/90 border border-neon/30 flex items-center justify-center shadow-glow-sm">
            <PokemonSprite name={activeRoster[draggingPosFrom].name} size="sm" />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
