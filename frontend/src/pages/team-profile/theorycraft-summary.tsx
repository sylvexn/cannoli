import { createPortal } from 'react-dom';
import type { RosterPokemon } from '@/lib/types';
import type { SwapEntry, TeraEdit } from './utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TYPE_COLORS, TYPE_ABBR } from '@/lib/constants';
import { ArrowRight, RotateCcw, X, Plus, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TheorycraftSummaryProps {
  originalRoster: RosterPokemon[];
  swaps: SwapEntry[];
  removedIndices: Set<number>;
  additions: RosterPokemon[];
  teraEdits: TeraEdit[];
  pointsDelta: number;
  onReset: () => void;
}

/**
 * Floating summary bar that surfaces the in-progress theorycraft diff.
 * Renders only when there is at least one change. Pinned at the bottom
 * of the viewport via portal so it survives long roster scrolls.
 */
export function TheorycraftSummary({
  originalRoster, swaps, removedIndices, additions, teraEdits, pointsDelta, onReset,
}: TheorycraftSummaryProps) {
  // Filter "real" tera edits — ones that differ from the original mon
  const meaningfulTeraEdits = teraEdits.filter(edit => {
    const original = originalRoster.find(m => m.name === edit.name);
    if (!original) return true; // Edits on additions count
    if (original.isTeraCaptain !== edit.isTeraCaptain) return true;
    const a = (original.teraTypes ?? []).slice().sort().join(',');
    const b = (edit.teraTypes ?? []).slice().sort().join(',');
    return a !== b;
  });

  const removed = [...removedIndices].map(i => originalRoster[i]).filter(Boolean);
  const totalChanges = swaps.length + removed.length + additions.length + meaningfulTeraEdits.length;
  if (totalChanges === 0) return null;

  return createPortal(
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] pointer-events-auto">
      <div className="bg-surface-raised/95 backdrop-blur-md border border-pink/30 rounded-lg shadow-glow-lg overflow-hidden">
        <div className="flex items-stretch gap-0 divide-x divide-border-subtle text-[11px]">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 bg-pink/5">
            <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-pink">
              Theorycraft
            </span>
            <span className="text-text-muted text-[10px] font-mono tabular-nums">
              {totalChanges} change{totalChanges === 1 ? '' : 's'}
            </span>
            {pointsDelta !== 0 && (
              <span className={cn(
                'text-[10px] font-mono font-bold tabular-nums px-1.5 py-0.5 rounded',
                pointsDelta > 0
                  ? 'text-loss bg-loss/10'
                  : 'text-win bg-win/10',
              )}>
                {pointsDelta > 0 ? '+' : ''}{pointsDelta}pt
              </span>
            )}
          </div>

          {/* Swaps */}
          {swaps.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 max-w-md overflow-x-auto">
              <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted shrink-0">
                Swap
              </span>
              <div className="flex items-center gap-2">
                {swaps.map((swap, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    <PokemonSprite name={swap.original.name} size="xs" />
                    <ArrowRight size={10} className="text-pink" />
                    <PokemonSprite name={swap.replacement.name} size="xs" />
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Removed */}
          {removed.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="text-[9px] font-mono uppercase tracking-wider text-loss shrink-0">
                Cut
              </span>
              <div className="flex items-center gap-1">
                {removed.map((mon, i) => (
                  <span key={i} className="relative">
                    <PokemonSprite name={mon.name} size="xs" />
                    <X size={8} className="absolute -top-0.5 -right-0.5 text-loss bg-surface-raised rounded-full" />
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Additions */}
          {additions.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="text-[9px] font-mono uppercase tracking-wider text-win shrink-0">
                Add
              </span>
              <div className="flex items-center gap-1">
                {additions.map((mon, i) => (
                  <span key={i} className="relative">
                    <PokemonSprite name={mon.name} size="xs" />
                    <Plus size={8} className="absolute -top-0.5 -right-0.5 text-win bg-surface-raised rounded-full" />
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tera edits */}
          {meaningfulTeraEdits.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 max-w-sm overflow-x-auto">
              <Star size={10} className="text-pink fill-pink shrink-0" />
              <div className="flex items-center gap-2">
                {meaningfulTeraEdits.map(edit => (
                  <span key={edit.name} className="inline-flex items-center gap-1 text-[10px]">
                    <span className="text-pink font-medium truncate max-w-[80px]">{edit.name}</span>
                    {edit.isTeraCaptain ? (
                      <span className="inline-flex items-center gap-0.5">
                        {edit.teraTypes.map(t => (
                          <span
                            key={t}
                            className="text-[7px] font-bold uppercase rounded px-1 py-px text-white"
                            style={{ backgroundColor: TYPE_COLORS[t] }}
                          >
                            {TYPE_ABBR[t]}
                          </span>
                        ))}
                        {edit.teraTypes.length === 0 && (
                          <span className="text-[9px] text-text-muted">no type</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[9px] text-text-muted">→ not cap</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Reset */}
          <button
            onClick={onReset}
            className="flex items-center gap-1 px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted hover:text-loss hover:bg-loss/5 transition-colors"
            title="Reset all theorycraft changes"
          >
            <RotateCcw size={11} />
            Reset
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
