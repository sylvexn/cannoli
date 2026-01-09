import { useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TeamLogo } from '@/components/team-logo';
import { TierBadge } from '@/components/tier-badge';
import type { Player } from '@/lib/types';

interface PokemonCompactCardProps {
  name: string;
  tier: number;
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

  return (
    <button
      ref={ref}
      onClick={() => onClick(name)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onHoverEnd}
      className={cn(
        'group relative flex flex-col items-center gap-0.5 rounded-md p-1.5 w-[68px] h-[78px]',
        'border transition-all duration-200 cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neon',
        // Base state
        !owner && !isUserPickable && 'bg-surface-overlay/30 border-border-subtle hover:bg-surface-overlay/60 hover:border-border-default',
        // Owned state
        owner && !isHighlighted && 'bg-surface-overlay/40 hover:bg-surface-overlay/70',
        // Highlighted (team selected in sidebar)
        isHighlighted && 'bg-surface-overlay/60 ring-1 shadow-glow-sm',
        // User can pick this
        isUserPickable && !owner && 'bg-neon/5 border-neon/30 hover:bg-neon/10 hover:border-neon/50 hover:shadow-glow-sm',
        // Dimmed (filtered out but still visible, or owned by another team when filtering)
        dimmed && 'opacity-30',
        // Recently picked animation
        recentlyPicked && 'animate-in zoom-in-95 duration-300',
      )}
      style={{
        borderLeftColor: owner && !isHighlighted ? owner.teamColor : undefined,
        borderLeftWidth: owner ? '2px' : undefined,
        ringColor: isHighlighted && owner ? owner.teamColor : undefined,
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
