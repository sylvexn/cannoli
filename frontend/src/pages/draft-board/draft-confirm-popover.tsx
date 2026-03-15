import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { TierBadge } from '@/components/tier-badge';
import { Button } from '@/components/ui/button';
import { Sparkles, Info, ListOrdered, AlertTriangle } from 'lucide-react';
import { getPokemonData } from '@/data/pokemon-data';
import { getTierEntry } from '@/data/tier-list';
import type { RosterPokemon } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';
import {
  findPickConflict, describeConflict,
  findPickWarning, describeWarning,
  type ConflictInputRoster,
} from '@/lib/draft-rules';

interface DraftConfirmPopoverProps {
  /** Pokemon name to draft, or null if hidden */
  name: string | null;
  /** Anchor rect from the clicked card */
  anchorRect: DOMRect | null;
  /** Remaining budget after this pick */
  budgetAfter?: number;
  onConfirm: (name: string) => void;
  onViewDetails: (name: string) => void;
  onQueue?: (name: string) => void;
  onClose: () => void;
  rosterLookup: Map<string, RosterPokemon>;
  /** Whether this Pokemon is already in the queue */
  isQueued?: boolean;
  /** Whether queue is full (3) */
  queueFull?: boolean;
  /** Whether it's the user's turn right now */
  isUserTurn?: boolean;
  /** User's roster info — used to surface conflicts inline (mega cap, dup species). */
  userConflictRoster?: ConflictInputRoster;
  /** Point cap (for conflict detection) */
  pointCap?: number;
}

export function DraftConfirmPopover({
  name,
  anchorRect,
  budgetAfter,
  onConfirm,
  onViewDetails,
  onQueue,
  onClose,
  rosterLookup,
  isQueued,
  queueFull,
  isUserTurn,
  userConflictRoster,
  pointCap = 110,
}: DraftConfirmPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!name) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [name, onClose]);

  // Close on outside click
  useEffect(() => {
    if (!name) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid the card click itself triggering close
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 10);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [name, onClose]);

  const handleConfirm = useCallback(() => {
    if (name) {
      onConfirm(name);
      onClose();
    }
  }, [name, onConfirm, onClose]);

  const handleDetails = useCallback(() => {
    if (name) {
      onViewDetails(name);
      onClose();
    }
  }, [name, onViewDetails, onClose]);

  const handleQueue = useCallback(() => {
    if (name && onQueue) {
      onQueue(name);
      onClose();
    }
  }, [name, onQueue, onClose]);

  if (!name || !anchorRect) return null;

  const rosterMon = rosterLookup.get(name);
  const pokeData = getPokemonData(name);
  const tierEntry = getTierEntry(name);
  const types: PokemonType[] | undefined = rosterMon?.types ?? pokeData?.types;
  const stats = rosterMon?.stats ?? pokeData?.stats;
  const bst = stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : null;

  // Pre-flight: hard conflicts (block) and soft warnings (notify, don't block).
  const conflict = tierEntry && userConflictRoster
    ? findPickConflict(name, tierEntry.tier, userConflictRoster, pointCap)
    : null;
  const warning = !conflict && tierEntry && userConflictRoster
    ? findPickWarning(name, tierEntry.tier, userConflictRoster, pointCap)
    : null;
  const blocked = !!conflict;

  // Position: above the card, centered. Fall back to below if near top.
  const popoverWidth = 220;
  const popoverHeight = 160;
  let top = anchorRect.top - popoverHeight - 8;
  let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
  let arrowSide: 'bottom' | 'top' = 'bottom';

  if (top < 8) {
    top = anchorRect.bottom + 8;
    arrowSide = 'top';
  }
  // Clamp horizontal position
  left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));

  return createPortal(
    <div
      ref={popoverRef}
      className={cn(
        'fixed z-[60] rounded-lg border border-neon/30 bg-surface-raised shadow-card-lg',
        'animate-in fade-in-0 zoom-in-95 duration-150',
      )}
      style={{ top, left, width: popoverWidth }}
    >
      {/* Arrow */}
      <div
        className={cn(
          'absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45',
          'border-neon/30 bg-surface-raised',
          arrowSide === 'bottom' && '-bottom-1 border-r border-b',
          arrowSide === 'top' && '-top-1 border-l border-t',
        )}
      />

      <div className="p-3">
        {/* Pokemon header */}
        <div className="flex items-center gap-2.5">
          <div className="flex-shrink-0 rounded-md bg-surface-overlay/50 p-1">
            <PokemonSprite name={name} size="md" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-heading font-bold text-text-primary truncate">
              {name}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {tierEntry && <TierBadge points={tierEntry.tier} />}
              {types && <TypeChip types={types} size="sm" />}
            </div>
            {bst && (
              <span className="text-[10px] text-text-muted font-mono">BST {bst}</span>
            )}
          </div>
        </div>

        {/* Budget info */}
        {budgetAfter != null && tierEntry && (
          <div className="mt-2 px-2 py-1 rounded bg-surface-overlay/40 text-[10px] font-mono text-text-muted flex justify-between">
            <span>Cost: <span className="text-text-primary">{tierEntry.tier}pt</span></span>
            <span>After: <span className={cn(
              budgetAfter < 10 ? 'text-draw' : 'text-text-primary',
            )}>{budgetAfter}pt</span> left</span>
          </div>
        )}

        {/* Hard conflict — blocks the action */}
        {conflict && (
          <div className="mt-2 px-2 py-1.5 rounded border border-loss/30 bg-loss/[0.06] text-[10px] font-mono text-loss flex items-start gap-1.5">
            <AlertTriangle size={11} className="shrink-0 mt-px" />
            <span className="leading-snug">{describeConflict(conflict)}</span>
          </div>
        )}

        {/* Soft warning — pick is legal, surface trade-off (e.g. captain reserve) */}
        {warning && (
          <div className="mt-2 px-2 py-1.5 rounded border border-draw/30 bg-draw/[0.06] text-[10px] font-mono text-draw flex items-start gap-1.5">
            <AlertTriangle size={11} className="shrink-0 mt-px" />
            <span className="leading-snug">{describeWarning(warning)}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-1.5 mt-2.5">
          {isUserTurn ? (
            <Button
              onClick={handleConfirm}
              disabled={blocked}
              className="flex-1 h-8 text-xs font-bold bg-neon hover:bg-neon/90 text-surface gap-1 disabled:opacity-40"
            >
              <Sparkles size={12} />
              {blocked ? 'Blocked' : 'Draft'}
            </Button>
          ) : onQueue && !isQueued && !queueFull ? (
            <Button
              onClick={handleQueue}
              className="flex-1 h-8 text-xs font-bold bg-pink/10 text-pink border border-pink/30 hover:bg-pink/20 gap-1"
            >
              <ListOrdered size={12} />
              Queue
            </Button>
          ) : isQueued ? (
            <span className="flex-1 flex items-center justify-center h-8 text-xs text-pink font-medium gap-1">
              <ListOrdered size={12} />
              Queued
            </span>
          ) : null}
          {/* Queue button alongside Draft when it's user's turn */}
          {isUserTurn && onQueue && !isQueued && !queueFull && (
            <Button
              variant="ghost"
              onClick={handleQueue}
              className="h-8 px-2 text-xs text-pink hover:text-pink hover:bg-pink/10 gap-0.5"
              title="Add to queue"
            >
              <ListOrdered size={12} />
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={handleDetails}
            className="h-8 px-2 text-xs text-text-muted hover:text-neon gap-1"
          >
            <Info size={12} />
            Details
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
