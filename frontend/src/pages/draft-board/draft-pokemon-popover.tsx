import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { TierBadge } from '@/components/tier-badge';
import { StatBar } from '@/components/stat-bar';
import { AbilityChip } from '@/components/ability-chip';
import { TeamLogo } from '@/components/team-logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  ArrowRightLeft, Sparkles, Info, ListOrdered,
  AlertTriangle, ChevronDown,
} from 'lucide-react';
import { getPokemonData } from '@/data/pokemon-data';
import { getTierEntry } from '@/data/tier-list';
import type { RosterPokemon, Player } from '@/lib/types';
import type { PoolOwnership } from './types';
import {
  findPickConflict, describeConflict,
  findPickWarning, describeWarning,
  type ConflictInputRoster,
} from '@/lib/draft-rules';

export type PokemonPopoverMode = 'preview' | 'quick-draft' | 'detail-summary';

interface DraftPokemonPopoverProps {
  /** Pokemon name; null hides the popover. */
  name: string | null;
  /** Anchor rect from the originating card. */
  anchorRect: DOMRect | null;
  /** Which content variant to render. */
  mode: PokemonPopoverMode;
  /** Lookup maps shared with the page. */
  rosterLookup: Map<string, RosterPokemon>;
  ownershipMap: Map<string, PoolOwnership>;
  playerLookup: Map<string, Player>;
  /** Whether the user is currently on the clock (drives draft-button availability). */
  isUserTurn?: boolean;
  /** Remaining budget AFTER this pick (preview when in quick-draft mode). */
  budgetAfter?: number;
  /** Whether this Pokemon is already in the queue. */
  isQueued?: boolean;
  /** Whether queue is full (3). */
  queueFull?: boolean;
  /** User's roster info — used to surface conflicts inline. */
  userConflictRoster?: ConflictInputRoster;
  /** Point cap (for conflict detection). */
  pointCap?: number;
  onClose: () => void;
  onModeChange?: (mode: PokemonPopoverMode) => void;
  onConfirmDraft?: (name: string) => void;
  onQueueAdd?: (name: string) => void;
  onOpenDetailSheet?: (name: string) => void;
}

/**
 * Single Pokemon popover replacing the previous hover-card +
 * confirm-popover split. Three modes share a common header (sprite, name,
 * tier, types) so the View Transitions can morph between modes — and into
 * the detail sheet — without flicker.
 *
 *   - preview      → triggered by hover; read-only summary.
 *   - quick-draft  → triggered by click during the user's turn; surfaces
 *                    the draft/queue actions, budget-after, conflicts.
 *   - detail-summary → triggered explicitly (e.g. "More") to expose
 *                    abilities + base stats inline before opening the full
 *                    detail sheet.
 *
 * The `pokemon-card-${name}` view-transition-name is stamped on the sprite
 * so it morphs from the card into the popover and onward into the sheet.
 */
export function DraftPokemonPopover({
  name,
  anchorRect,
  mode,
  rosterLookup,
  ownershipMap,
  playerLookup,
  isUserTurn,
  budgetAfter,
  isQueued,
  queueFull,
  userConflictRoster,
  pointCap = 110,
  onClose,
  onModeChange,
  onConfirmDraft,
  onQueueAdd,
  onOpenDetailSheet,
}: DraftPokemonPopoverProps) {
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

  // Close on outside click — only for interactive modes (preview is hover-driven)
  useEffect(() => {
    if (!name) return;
    if (mode === 'preview') return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 10);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [name, mode, onClose]);

  const handleConfirm = useCallback(() => {
    if (name && onConfirmDraft) {
      onConfirmDraft(name);
      onClose();
    }
  }, [name, onConfirmDraft, onClose]);

  const handleDetails = useCallback(() => {
    if (name && onOpenDetailSheet) {
      onOpenDetailSheet(name);
      onClose();
    }
  }, [name, onOpenDetailSheet, onClose]);

  const handleQueue = useCallback(() => {
    if (name && onQueueAdd) {
      onQueueAdd(name);
      onClose();
    }
  }, [name, onQueueAdd, onClose]);

  if (!name || !anchorRect) return null;

  const rosterMon = rosterLookup.get(name);
  const pokeData = getPokemonData(name);
  const tierEntry = getTierEntry(name);
  const ownership = ownershipMap.get(name);
  const owner = ownership ? playerLookup.get(ownership.teamId) : undefined;
  const types = rosterMon?.types ?? pokeData?.types;
  const stats = rosterMon?.stats ?? pokeData?.stats;
  const abilities = rosterMon?.abilities ?? pokeData?.abilities ?? [];
  const bst = stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : null;

  // Pre-flight: hard conflicts (block) and soft warnings (notify).
  const conflict = mode !== 'preview' && tierEntry && userConflictRoster
    ? findPickConflict(name, tierEntry.tier, userConflictRoster, pointCap)
    : null;
  const warning = !conflict && mode !== 'preview' && tierEntry && userConflictRoster
    ? findPickWarning(name, tierEntry.tier, userConflictRoster, pointCap)
    : null;
  const blocked = !!conflict;

  // Position: above the card, centred. Fall back to below if near top.
  // Width adapts to mode (preview is the most compact, detail-summary widest).
  const popoverWidth = mode === 'detail-summary' ? 260 : mode === 'quick-draft' ? 230 : 240;
  const estimatedHeight = mode === 'detail-summary' ? 340 : mode === 'quick-draft' ? 180 : 280;

  let top = anchorRect.top - estimatedHeight - 8;
  let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
  let arrowSide: 'bottom' | 'top' = 'bottom';

  if (top < 8) {
    top = anchorRect.bottom + 8;
    arrowSide = 'top';
  }
  // Clamp horizontal position
  left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));
  // Clamp vertical position
  if (top + estimatedHeight > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - estimatedHeight - 8);
  }

  // Visual style — slim border for preview, neon-tinted for actionable modes.
  const borderClass = mode === 'preview'
    ? 'border-border-default'
    : 'border-neon/30';

  return createPortal(
    <div
      ref={popoverRef}
      data-popover-mode={mode}
      className={cn(
        'fixed z-[60] rounded-lg border bg-surface-raised shadow-card-lg',
        'pkmn-popover popover-fade-in',
        borderClass,
      )}
      style={{ top, left, width: popoverWidth }}
    >
      {/* Arrow */}
      <div
        className={cn(
          'absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-surface-raised',
          mode === 'preview' ? 'border-border-default' : 'border-neon/30',
          arrowSide === 'bottom' && '-bottom-1 border-r border-b',
          arrowSide === 'top' && '-top-1 border-l border-t',
        )}
      />

      <div className={cn(mode === 'quick-draft' ? 'p-3' : 'p-3 pb-2')}>
        {/* Shared header — view-transition target so mode/sheet transitions morph */}
        <div className="flex items-start gap-2.5">
          <div
            className="flex-shrink-0 rounded-md bg-surface-overlay/50 p-1"
            style={{ viewTransitionName: `pokemon-card-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}` }}
          >
            <PokemonSprite name={name} size="md" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-heading font-bold text-text-primary leading-tight truncate">
              {name}
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {tierEntry && <TierBadge points={tierEntry.tier} />}
              {types && <TypeChip types={types} size="xs" />}
            </div>
            {bst != null && (
              <div className="text-[10px] text-text-muted font-mono mt-0.5">
                BST {bst}
              </div>
            )}
          </div>
        </div>

        {/* Free-agent / tera-banned tag (preview) */}
        {mode === 'preview' && !owner && tierEntry?.teraBanned && (
          <Badge variant="outline" className="mt-2 text-[9px] h-4 px-1.5 border-loss/30 text-loss">
            Tera banned
          </Badge>
        )}

        {/* Budget-after row (quick-draft) */}
        {mode === 'quick-draft' && budgetAfter != null && tierEntry && (
          <div className="mt-2 px-2 py-1 rounded bg-surface-overlay/40 text-[10px] font-mono text-text-muted flex justify-between">
            <span>Cost: <span className="text-text-primary">{tierEntry.tier}pt</span></span>
            <span>After: <span className={cn(budgetAfter < 10 ? 'text-draw' : 'text-text-primary')}>{budgetAfter}pt</span> left</span>
          </div>
        )}

        {/* Conflict / warning bands (quick-draft + detail-summary) */}
        {mode !== 'preview' && conflict && (
          <div className="mt-2 px-2 py-1.5 rounded border border-loss/30 bg-loss/[0.06] text-[10px] font-mono text-loss flex items-start gap-1.5">
            <AlertTriangle size={11} className="shrink-0 mt-px" />
            <span className="leading-snug">{describeConflict(conflict)}</span>
          </div>
        )}
        {mode !== 'preview' && warning && (
          <div className="mt-2 px-2 py-1.5 rounded border border-draw/30 bg-draw/[0.06] text-[10px] font-mono text-draw flex items-start gap-1.5">
            <AlertTriangle size={11} className="shrink-0 mt-px" />
            <span className="leading-snug">{describeWarning(warning)}</span>
          </div>
        )}

        {/* Stats / abilities — always shown in preview & detail-summary */}
        {(mode === 'preview' || mode === 'detail-summary') && stats && (
          <>
            <Separator className="my-2 bg-border-subtle" />
            <div className="space-y-0.5">
              <StatBar label="HP" value={stats.hp} />
              <StatBar label="Atk" value={stats.atk} />
              <StatBar label="Def" value={stats.def} />
              <StatBar label="SpA" value={stats.spa} />
              <StatBar label="SpD" value={stats.spd} />
              <StatBar label="Spe" value={stats.spe} />
            </div>
          </>
        )}

        {(mode === 'preview' || mode === 'detail-summary') && abilities.length > 0 && (
          <>
            <Separator className="my-2 bg-border-subtle" />
            <div className="flex flex-wrap gap-1">
              {abilities.map(a => <AbilityChip key={a} name={a} />)}
            </div>
          </>
        )}

        {/* Ownership block (always when present) */}
        {owner && (
          <>
            <Separator className="my-2 bg-border-subtle" />
            <div className="flex items-center gap-2">
              <TeamLogo abbrev={owner.teamAbbrev} color={owner.teamColor} size="sm" />
              <span className="text-[11px] text-text-secondary">
                {ownership!.acquisition.method === 'traded' ? (
                  <span className="flex items-center gap-1">
                    <ArrowRightLeft size={10} className="text-pink" />
                    Traded from {playerLookup.get(ownership!.acquisition.fromTeamId!)?.teamAbbrev}
                    {ownership!.acquisition.week && ` (Week ${ownership!.acquisition.week})`}
                  </span>
                ) : (
                  <span>
                    Drafted by {owner.teamAbbrev}
                    {ownership!.acquisition.round && ` (R${ownership!.acquisition.round}P${ownership!.acquisition.pick})`}
                  </span>
                )}
              </span>
            </div>
          </>
        )}

        {/* Free-agent tag (preview only — quick-draft already implies FA via context) */}
        {mode === 'preview' && !owner && (
          <div className="mt-2 text-[10px] text-text-muted font-mono text-center">
            Free agent
          </div>
        )}

        {/* Action row — quick-draft or detail-summary */}
        {(mode === 'quick-draft' || mode === 'detail-summary') && (
          <div className="flex gap-1.5 mt-2.5">
            {isUserTurn ? (
              <Button
                onClick={handleConfirm}
                disabled={blocked || !!owner}
                className="flex-1 h-8 text-xs font-bold bg-neon hover:bg-neon/90 text-surface gap-1 disabled:opacity-40"
              >
                <Sparkles size={12} />
                {blocked ? 'Blocked' : owner ? 'Owned' : 'Draft'}
              </Button>
            ) : onQueueAdd && !owner && !isQueued && !queueFull ? (
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
            ) : queueFull && !isQueued ? (
              <span className="flex-1 flex items-center justify-center h-8 text-xs text-text-muted gap-1">
                <ListOrdered size={12} />
                Queue full
              </span>
            ) : null}

            {/* Queue button alongside Draft when it's user's turn */}
            {isUserTurn && onQueueAdd && !owner && !isQueued && !queueFull && (
              <Button
                variant="ghost"
                onClick={handleQueue}
                className="h-8 px-2 text-xs text-pink hover:text-pink hover:bg-pink/10 gap-0.5"
                title="Add to queue"
              >
                <ListOrdered size={12} />
              </Button>
            )}

            {/* Expand to detail-summary (only from quick-draft, only if not already there) */}
            {mode === 'quick-draft' && onModeChange && (
              <Button
                variant="ghost"
                onClick={() => onModeChange('detail-summary')}
                className="h-8 px-2 text-xs text-text-muted hover:text-neon"
                title="Show stats & abilities"
              >
                <ChevronDown size={12} />
              </Button>
            )}

            {onOpenDetailSheet && (
              <Button
                variant="ghost"
                onClick={handleDetails}
                className="h-8 px-2 text-xs text-text-muted hover:text-neon gap-1"
              >
                <Info size={12} />
                Details
              </Button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
