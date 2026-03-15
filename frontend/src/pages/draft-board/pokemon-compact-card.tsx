import { useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite, useSpriteState } from '@/components/pokemon-sprite';
import { typeColors } from '@/components/type-chip';
import { ArrowRightLeft, Crown, Lock, Star } from 'lucide-react';
import type { PokemonType } from '@/lib/pokemon';
import type { Player } from '@/lib/types';

interface PokemonCompactCardProps {
  name: string;
  types?: PokemonType[];
  tier?: number;
  owner?: Player;
  /** Owner-acquired-via-trade: shows a small swap glyph */
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
  onClick: (name: string) => void;
  onHoverStart: (name: string, rect: DOMRect) => void;
  onHoverEnd: () => void;
}

/**
 * Compact 78×88 pool card.
 *
 * Visual states (in stacking order):
 *   - Persistent owner color: 2px border + bottom team-abbrev strip
 *   - Affordability: tier pill colour + slight opacity dim if unaffordable (still readable)
 *   - Highlighted: ring in owner color when sidebar selects this team
 *   - Pickable (your turn, no conflicts): bright neon border + glow + bottom "PICK" label
 *   - Queued: pink border + position pill top-left
 *   - Conflict (dupe species / mega cap): loss-color X badge + tooltip-ready data attr
 *   - Status icons: mega star (top-left or top-center), captain crown, tera lock
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
  onClick,
  onHoverStart,
  onHoverEnd,
}: PokemonCompactCardProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const spriteState = useSpriteState(name);

  const handleMouseEnter = useCallback(() => {
    if (ref.current) onHoverStart(name, ref.current.getBoundingClientRect());
  }, [name, onHoverStart]);

  const displayName = name.length > 12
    ? name.replace('Mega ', 'M-').replace('-Alola', '-A').replace('-Galar', '-G').replace('-Hisui', '-H').replace('-Paldea', '-P')
    : name;

  const typeGradient = useMemo(() => {
    if (!types || types.length === 0) return undefined;
    if (types.length === 1) {
      const c = typeColors[types[0]];
      return `linear-gradient(180deg, ${c}30 0%, ${c}12 100%)`;
    }
    const c1 = typeColors[types[0]];
    const c2 = typeColors[types[1]];
    return `linear-gradient(135deg, ${c1}30 0%, ${c1}30 50%, ${c2}30 50%, ${c2}30 100%)`;
  }, [types]);

  const ownerColor = owner?.teamColor;
  const hasConflict = !owner && !!conflictKind;

  // Ownership/state determines the pickable visual.
  const looksPickable = isUserPickable && !owner && !hasConflict && !unaffordable;

  return (
    <button
      ref={ref}
      onClick={() => onClick(name)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onHoverEnd}
      data-conflict={hasConflict ? conflictKind : undefined}
      className={cn(
        'group relative flex flex-col items-center gap-0.5 rounded-md p-1 w-[78px] h-[88px]',
        'border-2 cursor-pointer transition-[box-shadow,border-color,transform,opacity] duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neon',
        // Hover lift (skip when dimmed)
        !dimmed && 'hover:scale-[1.04]',
        // Base state (no owner)
        !owner && !looksPickable && !queuePosition && !hasConflict && 'border-border-subtle hover:border-border-default',
        // Owner color persistent border
        owner && 'border-[var(--owner)]',
        // Pickable (user's turn, fits)
        looksPickable && 'border-neon shadow-[0_0_14px_rgba(34,211,238,0.30)]',
        // Highlighted via team sidebar
        isHighlighted && 'ring-2 ring-offset-1 ring-offset-surface',
        // Queued
        queuePosition && !owner && 'border-pink/70 shadow-[0_0_10px_rgba(232,121,249,0.20)]',
        // Conflict — clear "this would be illegal" signal but still inspectable
        hasConflict && 'border-loss/40 opacity-70',
        // Unaffordable — readable, dimmed
        unaffordable && !owner && !hasConflict && 'opacity-55',
        // Dimmed (sidebar selected another team)
        dimmed && 'opacity-30',
        // Recently picked animation
        recentlyPicked && 'animate-in zoom-in-95 duration-300',
      )}
      style={{
        background: typeGradient,
        // @ts-expect-error custom CSS var
        '--owner': ownerColor,
        '--tw-ring-color': isHighlighted ? ownerColor : undefined,
      }}
    >
      {/* Top-left — queue position OR captain crown OR mega star */}
      {queuePosition && (
        <span className="absolute top-0.5 left-0.5 z-10 w-[16px] h-[16px] flex items-center justify-center rounded-sm bg-pink text-white text-[9px] font-mono font-bold leading-none">
          {queuePosition}
        </span>
      )}
      {!queuePosition && isMega && (
        <span
          className="absolute top-0.5 left-0.5 z-10 w-[14px] h-[14px] flex items-center justify-center rounded-sm bg-pink/90 text-white"
          title="Mega"
        >
          <Star size={8} strokeWidth={2.5} />
        </span>
      )}

      {/* Tier cost pill — top right, always visible during draft */}
      {showTier && tier != null && (
        <span className={cn(
          'absolute top-0.5 right-0.5 z-10 min-w-[18px] h-[18px] px-1',
          'flex items-center justify-center rounded-sm text-[9px] font-mono font-bold leading-none',
          'bg-surface/85 backdrop-blur-sm border',
          unaffordable
            ? 'text-loss border-loss/30'
            : looksPickable
            ? 'text-neon border-neon/40'
            : 'text-text-secondary border-border-subtle',
        )}>
          {tier}
        </span>
      )}

      {/* Status icons cluster — top right (below tier) */}
      <div className="absolute top-[18px] right-0.5 z-10 flex flex-col items-end gap-0.5">
        {isCaptainEligible && !isTeraBanned && (
          <span className="w-[12px] h-[12px] flex items-center justify-center rounded-sm bg-draw/70 text-surface" title="Captain-eligible">
            <Crown size={7} strokeWidth={2.5} />
          </span>
        )}
        {isTeraBanned && (
          <span className="w-[12px] h-[12px] flex items-center justify-center rounded-sm bg-loss/60 text-white" title="Tera-banned">
            <Lock size={7} strokeWidth={2.5} />
          </span>
        )}
      </div>

      {/* Sprite */}
      <div className="mt-2.5">
        <PokemonSprite name={name} size="md" />
      </div>

      {/* Name */}
      {spriteState === 'loading' ? (
        <div className="h-[12px] w-[50px] rounded bg-surface-overlay/30 animate-pulse" />
      ) : (
        <span className={cn(
          'text-[9px] leading-tight text-center w-full truncate',
          owner ? 'text-text-primary' : 'text-text-secondary',
          isHighlighted && 'text-text-primary font-medium',
        )}>
          {displayName}
        </span>
      )}

      {/* Bottom strip — owner abbrev OR pick affordance OR FA OR conflict reason */}
      <div
        className={cn(
          'absolute left-0 right-0 bottom-0 flex items-center justify-center gap-1',
          'px-1 py-[2px] rounded-b-[3px] border-t',
          'text-[8.5px] font-mono leading-none uppercase tracking-wider',
          owner
            ? 'border-t-[var(--owner)]/40'
            : hasConflict
            ? 'border-t-loss/30 bg-loss/10 text-loss'
            : looksPickable
            ? 'border-t-neon/40 bg-neon/10 text-neon font-bold'
            : unaffordable
            ? 'border-t-loss/20 bg-loss/5 text-loss/80'
            : 'border-t-border-subtle bg-surface-overlay/30 text-text-muted',
        )}
        style={ownerColor
          ? { backgroundColor: `${ownerColor}25`, color: ownerColor }
          : undefined
        }
      >
        {owner ? (
          <>
            {ownerTraded && <ArrowRightLeft size={8} />}
            <span className="truncate">{owner.teamAbbrev}</span>
          </>
        ) : hasConflict ? (
          <span className="truncate">
            {conflictKind === 'mega-cap' ? 'mega cap'
              : conflictKind === 'duplicate-species' ? 'dup species'
              : 'reserve'}
          </span>
        ) : looksPickable ? (
          <span>Pick</span>
        ) : unaffordable ? (
          <span className="flex items-center gap-0.5"><Lock size={7} strokeWidth={2.5} />over</span>
        ) : (
          <span>FA</span>
        )}
      </div>
    </button>
  );
}
