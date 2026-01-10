import { useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TeamLogo } from '@/components/team-logo';
import { TierBadge } from '@/components/tier-badge';
import { typeColors } from '@/components/type-chip';
import type { PokemonType } from '@/lib/pokemon';
import type { Player } from '@/lib/types';

interface PokemonCompactCardProps {
  name: string;
  tier: number;
  types?: PokemonType[];
  owner?: Player;
  isHighlighted?: boolean;
  isUserPickable?: boolean;
  dimmed?: boolean;
  recentlyPicked?: boolean;
  onClick: (name: string) => void;
  onHoverStart: (name: string, rect: DOMRect) => void;
  onHoverEnd: () => void;
}

export function PokemonCompactCard({
  name,
  tier,
  types,
  owner,
  isHighlighted,
  isUserPickable,
  dimmed,
  recentlyPicked,
  onClick,
  onHoverStart,
  onHoverEnd,
}: PokemonCompactCardProps) {
  const ref = useRef<HTMLButtonElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (ref.current) {
      onHoverStart(name, ref.current.getBoundingClientRect());
    }
  }, [name, onHoverStart]);

  // Truncate display name for card
  const displayName = name.length > 12 ? name.replace('Mega ', 'M-').replace('-Alola', '-A').replace('-Galar', '-G').replace('-Hisui', '-H').replace('-Paldea', '-P') : name;

  // Type gradient background
  const typeGradient = useMemo(() => {
    if (!types || types.length === 0) return undefined;
    if (types.length === 1) {
      const c = typeColors[types[0]];
      return `radial-gradient(ellipse at 50% 30%, ${c}18 0%, ${c}08 60%, transparent 100%)`;
    }
    // Dual type: blend both colors
    const c1 = typeColors[types[0]];
    const c2 = typeColors[types[1]];
    return `linear-gradient(135deg, ${c1}18 0%, ${c2}18 100%)`;
  }, [types]);

  return (
    <button
      ref={ref}
      onClick={() => onClick(name)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onHoverEnd}
      className={cn(
        'group relative flex flex-col items-center gap-0.5 rounded-md p-1.5 w-[68px] h-[78px]',
        'border transition-all duration-200 cursor-pointer overflow-hidden',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neon',
        // Base state
        !owner && !isUserPickable && 'border-border-subtle hover:border-border-default',
        // Owned state
        owner && !isHighlighted && 'hover:brightness-110',
        // Highlighted (team selected in sidebar)
        isHighlighted && 'ring-1 shadow-glow-sm',
        // User can pick this
        isUserPickable && !owner && 'border-neon/30 hover:border-neon/50 hover:shadow-glow-sm',
        // Dimmed
        dimmed && 'opacity-30',
        // Recently picked animation
        recentlyPicked && 'animate-in zoom-in-95 duration-300',
      )}
      style={{
        background: typeGradient,
        borderLeftColor: owner && !isHighlighted ? owner.teamColor : undefined,
        borderLeftWidth: owner ? '2px' : undefined,
        // @ts-expect-error CSS custom property
        '--tw-ring-color': isHighlighted && owner ? owner.teamColor : undefined,
        '--tw-shadow-color': isHighlighted && owner ? `${owner.teamColor}40` : undefined,
      }}
    >
      {/* Team badge (top-right corner) */}
      {owner && (
        <div className="absolute -top-1 -right-1 z-10">
          <TeamLogo abbrev={owner.teamAbbrev} color={owner.teamColor} size="sm" />
        </div>
      )}

      {/* Sprite */}
      <PokemonSprite name={name} size="sm" />

      {/* Name */}
      <span className={cn(
        'text-[9px] leading-tight text-center w-full truncate',
        owner ? 'text-text-primary' : 'text-text-secondary',
        isHighlighted && 'text-text-primary font-medium',
      )}>
        {displayName}
      </span>

      {/* Tier badge (bottom-left) */}
      <div className="absolute -bottom-1 -left-1">
        <TierBadge points={tier} />
      </div>
    </button>
  );
}
