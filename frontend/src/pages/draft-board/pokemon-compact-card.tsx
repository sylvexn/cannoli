import { useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite, useSpriteState } from '@/components/pokemon-sprite';
import { typeColors } from '@/components/type-chip';
import type { PokemonType } from '@/lib/pokemon';
import type { Player } from '@/lib/types';

interface PokemonCompactCardProps {
  name: string;
  types?: PokemonType[];
  tier?: number;
  owner?: Player;
  isHighlighted?: boolean;
  isUserPickable?: boolean;
  dimmed?: boolean;
  unaffordable?: boolean;
  recentlyPicked?: boolean;
  showTier?: boolean;
  onClick: (name: string) => void;
  onHoverStart: (name: string, rect: DOMRect) => void;
  onHoverEnd: () => void;
}

export function PokemonCompactCard({
  name,
  types,
  tier,
  owner,
  isHighlighted,
  isUserPickable,
  dimmed,
  unaffordable,
  recentlyPicked,
  showTier,
  onClick,
  onHoverStart,
  onHoverEnd,
}: PokemonCompactCardProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const spriteState = useSpriteState(name);

  const handleMouseEnter = useCallback(() => {
    if (ref.current) {
      onHoverStart(name, ref.current.getBoundingClientRect());
    }
  }, [name, onHoverStart]);

  // Truncate display name for card
  const displayName = name.length > 12 ? name.replace('Mega ', 'M-').replace('-Alola', '-A').replace('-Galar', '-G').replace('-Hisui', '-H').replace('-Paldea', '-P') : name;

  // Type color background
  const typeGradient = useMemo(() => {
    if (!types || types.length === 0) return undefined;
    if (types.length === 1) {
      const c = typeColors[types[0]];
      return `linear-gradient(180deg, ${c}30 0%, ${c}12 100%)`;
    }
    // Dual type: hard diagonal split
    const c1 = typeColors[types[0]];
    const c2 = typeColors[types[1]];
    return `linear-gradient(135deg, ${c1}30 0%, ${c1}30 50%, ${c2}30 50%, ${c2}30 100%)`;
  }, [types]);

  return (
    <button
      ref={ref}
      onClick={() => onClick(name)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onHoverEnd}
      className={cn(
        'group relative flex flex-col items-center gap-0.5 rounded-md p-1.5 w-[76px] h-[82px]',
        'border cursor-pointer',
        'transition-[box-shadow,border-color,transform,opacity] duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neon',
        // Hover ring + lift
        'hover:ring-1 hover:ring-neon/40 hover:shadow-[0_0_12px_rgba(34,211,238,0.15)] hover:scale-[1.04]',
        // Base state
        !owner && !isUserPickable && 'border-border-subtle hover:border-neon/30',
        // Owned state
        owner && !isHighlighted && 'hover:border-neon/20',
        // Highlighted (team selected in sidebar)
        isHighlighted && 'ring-1 shadow-glow-sm',
        // User can pick this
        isUserPickable && !owner && 'border-neon/30 hover:ring-neon/60 hover:shadow-[0_0_16px_rgba(34,211,238,0.25)]',
        // Unaffordable (can't pick — over budget)
        unaffordable && !owner && 'opacity-25 grayscale-[60%] pointer-events-auto',
        // Dimmed
        dimmed && 'opacity-30',
        // Recently picked animation
        recentlyPicked && 'animate-in zoom-in-95 duration-300',
      )}
      style={{
        background: typeGradient,
        // @ts-expect-error CSS custom property
        '--tw-ring-color': isHighlighted && owner ? owner.teamColor : undefined,
        '--tw-shadow-color': isHighlighted && owner ? `${owner.teamColor}40` : undefined,
      }}
    >
      {/* Owned team tab — sits on left edge, expands outward on hover */}
      {owner && (
        <div
          className={cn(
            'absolute top-1 bottom-1 z-20 flex items-center justify-center',
            'rounded-l-md overflow-hidden',
            'right-full mr-[-3px] w-[3px]',
            'group-hover:w-[26px] group-hover:mr-[-3px]',
            'transition-[width] duration-300 ease-in-out',
          )}
          style={{
            backgroundColor: owner.teamColor,
            boxShadow: `0 0 8px ${owner.teamColor}60`,
          }}
        >
          <span
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-100 font-bold text-white whitespace-nowrap leading-none"
            style={{ fontSize: `${Math.min(10, 26 / owner.teamAbbrev.length)}px` }}
          >
            {owner.teamAbbrev}
          </span>
        </div>
      )}

      {/* Tier cost badge — shown during draft mode */}
      {showTier && tier != null && (
        <span className={cn(
          'absolute top-0.5 right-0.5 z-10 min-w-[16px] h-[16px] px-1',
          'flex items-center justify-center rounded-sm',
          'text-[8px] font-mono font-bold leading-none',
          'bg-surface/80 backdrop-blur-sm border',
          unaffordable
            ? 'text-loss/60 border-loss/20'
            : isUserPickable
            ? 'text-neon border-neon/30'
            : 'text-text-muted border-border-subtle',
        )}>
          {tier}
        </span>
      )}

      {/* Sprite */}
      <PokemonSprite name={name} size="md" />

      {/* Name — skeleton while sprite loads */}
      {spriteState === 'loading' ? (
        <div className="h-[13px] w-[50px] rounded bg-surface-overlay/30 animate-pulse" />
      ) : (
        <span className={cn(
          'text-[9px] leading-tight text-center w-full truncate',
          owner ? 'text-text-primary' : 'text-text-secondary',
          isHighlighted && 'text-text-primary font-medium',
        )}>
          {displayName}
        </span>
      )}

    </button>
  );
}
