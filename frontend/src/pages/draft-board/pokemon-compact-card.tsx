import { useRef, useCallback, useMemo, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite, useSpriteState } from '@/components/pokemon-sprite';
import { typeColors } from '@/components/type-chip';
import { ArrowRightLeft, Crown, Lock, Star, AlertTriangle } from 'lucide-react';
import type { PokemonType } from '@/lib/pokemon';
import type { Player } from '@/lib/types';

export type CardDensity = 'compact' | 'comfortable' | 'detailed';

interface PokemonCompactCardProps {
  name: string;
  types?: PokemonType[];
  tier?: number;
  owner?: Player;
  /** Owner-acquired-via-trade: shows a small swap glyph on hover */
  ownerTraded?: boolean;
  isHighlighted?: boolean;
  isUserPickable?: boolean;
  dimmed?: boolean;
  /** Pokemon costs more than the user's remaining budget */
  unaffordable?: boolean;
  recentlyPicked?: boolean;
  showTier?: boolean;
  /** Queue position (1-3) if queued, undefined if not */
  queuePosition?: number;
  /** Roster/budget conflict that would make this pick illegal right now. */
  conflictKind?: 'duplicate-species' | 'mega-cap' | 'roster-reserve' | null;
  isMega?: boolean;
  isTeraBanned?: boolean;
  /** Tier ≤9 and not tera-banned — eligible to be a captain (with markup) */
  isCaptainEligible?: boolean;
  /** Layout density — controls size, name visibility, type-row visibility. */
  density?: CardDensity;
  onClick: (name: string) => void;
  onHoverStart: (name: string, rect: DOMRect) => void;
  onHoverEnd: () => void;
}

/**
 * Pool card with progressive disclosure. The always-visible layer carries:
 *   1. Tier cost pill (top-left)
 *   2. Sprite (centred)
 *   3. Name (bottom; hidden in compact density)
 * Plus a 4px ownership strip at the bottom (owner colour) or a 1px subtle
 * border for free agents, and a 2px type edge on the left.
 *
 * Hover/focus reveals the secondary layer:
 *   - Mega/Captain/Tera-banned glyphs (top-right stack)
 *   - Owner abbrev text inside the strip (or the action label)
 *
 * Pickable cards keep a persistent neon edge so the affordance is visible
 * without hover; the edge intensifies on hover and the "PICK" label appears.
 *
 * Conflict states collapse to a single warning dot — full reason lives in
 * the popover so the card stays scannable.
 *
 * Width is driven by `--card-size` so the parent grid can flow with density.
 */
export function PokemonCompactCard({
  name,
  types,
  tier,
  owner,
  ownerTraded,
  isHighlighted,
  isUserPickable,
  dimmed,
  unaffordable,
  recentlyPicked,
  showTier,
  queuePosition,
  conflictKind,
  isMega,
  isTeraBanned,
  isCaptainEligible,
  density = 'comfortable',
  onClick,
  onHoverStart,
  onHoverEnd,
}: PokemonCompactCardProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const spriteState = useSpriteState(name);

  const handleMouseEnter = useCallback(() => {
    if (ref.current) onHoverStart(name, ref.current.getBoundingClientRect());
  }, [name, onHoverStart]);

  const handleFocus = useCallback(() => {
    if (ref.current) onHoverStart(name, ref.current.getBoundingClientRect());
  }, [name, onHoverStart]);

  const displayName = name.length > 12
    ? name.replace('Mega ', 'M-').replace('-Alola', '-A').replace('-Galar', '-G').replace('-Hisui', '-H').replace('-Paldea', '-P')
    : name;

  const typeEdge = useMemo(() => {
    if (!types || types.length === 0) return undefined;
    if (types.length === 1) return typeColors[types[0]];
    const c1 = typeColors[types[0]];
    const c2 = typeColors[types[1]];
    return `linear-gradient(180deg, ${c1} 0%, ${c1} 50%, ${c2} 50%, ${c2} 100%)`;
  }, [types]);

  const ownerColor = owner?.teamColor;
  const hasConflict = !owner && !!conflictKind;
  const looksPickable = isUserPickable && !owner && !hasConflict && !unaffordable;

  // Action label shown inside the bottom strip on hover for free-agent cards.
  // For owned cards we instead reveal the owner abbrev.
  const actionLabel: string | null = owner
    ? null
    : hasConflict
      ? (conflictKind === 'mega-cap' ? 'MEGA CAP'
        : conflictKind === 'duplicate-species' ? 'DUP'
        : 'RESERVE')
      : looksPickable
        ? 'PICK'
        : unaffordable
          ? 'OVER'
          : 'FA';

  const showName = density !== 'compact';
  const showTypeRow = density === 'detailed' && types && types.length > 0;
  const spriteSize = density === 'detailed' ? 'lg' : 'md';

  const cardStyle: CSSProperties = {
    // @ts-expect-error custom CSS var — consumed by tailwind arbitrary value below
    '--owner': ownerColor,
    '--type-edge': typeEdge,
    '--tw-ring-color': isHighlighted ? ownerColor : undefined,
    // Per-instance view-transition name so the popover/detail-sheet can morph
    // the same sprite. Phase 2a may wrap from outside; this remains stable.
    viewTransitionName: `pokemon-card-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
  };

  return (
    <button
      ref={ref}
      onClick={() => onClick(name)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onHoverEnd}
      onFocus={handleFocus}
      onBlur={onHoverEnd}
      data-conflict={hasConflict ? conflictKind : undefined}
      data-density={density}
      data-pokemon={name}
      className={cn(
        'pkmn-card group relative flex flex-col items-center justify-start gap-0.5 rounded-md cursor-pointer',
        'p-1 pl-1.5 pb-[6px]',
        'bg-surface',
        'border transition-[box-shadow,border-color,transform,opacity] duration-180 ease-out',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neon',
        // Hover lift (skip when dimmed)
        !dimmed && 'hover:scale-[1.04]',
        // Base subtle border for free agents
        !owner && !looksPickable && !queuePosition && !hasConflict && 'border-border-subtle hover:border-border-default',
        // Persistent pickable affordance — soft neon edge + tiny inner glow.
        // AMP UP on hover (full glow).
        looksPickable && 'border-[1.5px] border-neon/40 shadow-[inset_0_0_6px_rgba(34,211,238,0.10)] hover:border-neon hover:shadow-[0_0_14px_rgba(34,211,238,0.30)]',
        // Owned — solid 1px owner border
        owner && 'border-[var(--owner)]/70',
        // Highlighted via team sidebar
        isHighlighted && 'ring-2 ring-offset-1 ring-offset-surface',
        // Queued — pink edge
        queuePosition && !owner && 'border-pink/70 shadow-[0_0_8px_rgba(232,121,249,0.18)]',
        // Conflict — desaturated, no loud bg tint (warning dot carries the signal)
        hasConflict && 'opacity-70 grayscale-[40%]',
        // Unaffordable — readable, dimmed
        unaffordable && !owner && !hasConflict && 'opacity-55',
        // Dimmed (sidebar selected another team)
        dimmed && 'opacity-30',
        // Recently picked animation
        recentlyPicked && 'animate-in zoom-in-95 duration-300',
      )}
      style={{
        ...cardStyle,
        width: 'var(--card-size, 88px)',
      }}
    >
      {/* 2px type edge (left side) */}
      {typeEdge && (
        <span
          className="absolute left-0 top-0 bottom-0 w-[2px] rounded-l-md pointer-events-none"
          style={{ background: typeEdge }}
          aria-hidden
        />
      )}

      {/* Tier cost pill — top-left, ALWAYS visible (canonical cost indicator) */}
      {showTier && tier != null && (
        <span className={cn(
          'absolute top-0.5 left-0.5 z-10 min-w-[18px] h-[16px] px-1',
          'flex items-center justify-center rounded-sm text-[9px] font-mono font-bold leading-none',
          'bg-surface/90 backdrop-blur-sm border',
          unaffordable
            ? 'text-loss border-loss/30'
            : looksPickable
              ? 'text-neon border-neon/40'
              : 'text-text-secondary border-border-subtle',
        )}>
          {tier}
        </span>
      )}

      {/* Queue position — top-right corner, persistent (queue is user-driven, must be visible) */}
      {queuePosition && !owner && (
        <span className="absolute top-0.5 right-0.5 z-10 w-[14px] h-[14px] flex items-center justify-center rounded-sm bg-pink text-white text-[9px] font-mono font-bold leading-none">
          {queuePosition}
        </span>
      )}

      {/* Conflict warning — single small dot, persistent */}
      {hasConflict && !queuePosition && (
        <span
          className="absolute top-0.5 right-0.5 z-10 w-[14px] h-[14px] flex items-center justify-center rounded-full bg-loss/85 text-white"
          title={
            conflictKind === 'mega-cap' ? 'Already at mega cap'
            : conflictKind === 'duplicate-species' ? 'Already on roster (same species)'
            : 'Roster reserve required'
          }
        >
          <AlertTriangle size={8} strokeWidth={2.5} />
        </span>
      )}

      {/* Status icons cluster — top-right, REVEALED ON HOVER (and persistent for queued slot pushes them down) */}
      {(isMega || isCaptainEligible || isTeraBanned) && !hasConflict && (
        <div
          className={cn(
            'absolute right-0.5 z-10 flex flex-col items-end gap-0.5',
            'opacity-0 -translate-y-0.5 transition-[opacity,transform] duration-180',
            'group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0',
            queuePosition ? 'top-[18px]' : 'top-0.5',
          )}
        >
          {isMega && (
            <span
              className="w-[14px] h-[14px] flex items-center justify-center rounded-sm bg-pink/90 text-white"
              title="Mega"
            >
              <Star size={8} strokeWidth={2.5} />
            </span>
          )}
          {isCaptainEligible && !isTeraBanned && (
            <span className="w-[14px] h-[14px] flex items-center justify-center rounded-sm bg-draw/80 text-surface" title="Captain-eligible">
              <Crown size={8} strokeWidth={2.5} />
            </span>
          )}
          {isTeraBanned && (
            <span className="w-[14px] h-[14px] flex items-center justify-center rounded-sm bg-loss/70 text-white" title="Tera-banned">
              <Lock size={8} strokeWidth={2.5} />
            </span>
          )}
        </div>
      )}

      {/* Sprite — centred, with stable inner view-transition target so popover/detail can morph it */}
      <div
        className={cn(
          'mt-2.5 flex items-center justify-center',
          density === 'detailed' && 'mt-3',
        )}
      >
        <PokemonSprite name={name} size={spriteSize} />
      </div>

      {/* Name */}
      {showName && (
        spriteState === 'loading' ? (
          <div className="h-[12px] w-[50px] rounded bg-surface-overlay/30 animate-pulse" />
        ) : (
          <span className={cn(
            'text-[9px] leading-tight text-center w-full truncate px-0.5',
            owner ? 'text-text-primary' : 'text-text-secondary',
            isHighlighted && 'text-text-primary font-medium',
          )}>
            {displayName}
          </span>
        )
      )}

      {/* Tiny types row — only in detailed density */}
      {showTypeRow && (
        <div className="flex items-center justify-center gap-0.5 mt-0.5" aria-hidden>
          {types!.map(t => (
            <span
              key={t}
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: typeColors[t] }}
              title={t}
            />
          ))}
        </div>
      )}

      {/* Bottom ownership strip — 4px coloured for owners, 1px subtle for FAs.
          The text content (owner abbrev / action label) appears on hover. */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 right-0 bottom-0 rounded-b-md pointer-events-none',
          'transition-[height,background-color] duration-180',
          owner
            ? 'h-[4px] bg-[color:var(--owner)] group-hover:h-[14px] group-focus-visible:h-[14px]'
            : looksPickable
              ? 'h-[2px] bg-neon/60 group-hover:h-[14px] group-focus-visible:h-[14px]'
              : queuePosition
                ? 'h-[2px] bg-pink/60 group-hover:h-[14px] group-focus-visible:h-[14px]'
                : hasConflict
                  ? 'h-[2px] bg-loss/50 group-hover:h-[14px] group-focus-visible:h-[14px]'
                  : unaffordable
                    ? 'h-[1px] bg-loss/30 group-hover:h-[14px] group-focus-visible:h-[14px]'
                    : 'h-[1px] bg-border-subtle group-hover:h-[14px] group-hover:bg-surface-overlay/60 group-focus-visible:h-[14px]',
        )}
        style={ownerColor ? { backgroundColor: ownerColor } : undefined}
      />

      {/* Hover label — sits over the strip, fades in. Owner abbrev wins for owned cards;
          action label otherwise. */}
      <span
        className={cn(
          'absolute left-0 right-0 bottom-0 z-10 flex items-center justify-center gap-1',
          'h-[14px] px-1 text-[8.5px] font-mono leading-none uppercase tracking-wider',
          'opacity-0 transition-opacity duration-180',
          'group-hover:opacity-100 group-focus-visible:opacity-100',
          owner
            ? 'text-white'
            : looksPickable
              ? 'text-neon font-bold'
              : hasConflict
                ? 'text-loss'
                : unaffordable
                  ? 'text-loss/80'
                  : queuePosition
                    ? 'text-pink'
                    : 'text-text-muted',
        )}
        style={owner ? { color: pickReadableTextColor(ownerColor) } : undefined}
      >
        {owner ? (
          <>
            {ownerTraded && <ArrowRightLeft size={8} />}
            <span className="truncate">{owner.teamAbbrev}</span>
          </>
        ) : (
          <span className="truncate">{actionLabel}</span>
        )}
      </span>
    </button>
  );
}

/**
 * Owner strip uses the team colour as background; pick a foreground that
 * stays readable against arbitrary brand colours. A simple luminance check
 * is enough — the strip is small, accessibility-wise it's redundant text
 * (the border carries the same colour signal).
 */
function pickReadableTextColor(bg: string | undefined): string {
  if (!bg) return '#fff';
  const hex = bg.replace('#', '');
  if (hex.length !== 6) return '#fff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0a0a0a' : '#fff';
}
