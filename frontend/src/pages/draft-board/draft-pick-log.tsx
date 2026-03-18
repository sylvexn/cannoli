import { useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TeamLogo } from '@/components/team-logo';
import { pokemonRoute } from '@/lib/pokemon-route';
import type { Player } from '@/lib/types';
import type { DraftPickEntry } from './types';

interface DraftPickLogProps {
  picks: DraftPickEntry[];
  playerLookup: Map<string, Player>;
  /** How many recent picks to show */
  maxVisible?: number;
}

export function DraftPickLog({ picks, playerLookup, maxVisible = 10 }: DraftPickLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest pick
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [picks.length]);

  if (picks.length === 0) return null;

  const visible = picks.slice(-maxVisible);

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-heading font-semibold text-text-muted uppercase tracking-wider">
          Recent Picks
        </span>
        <span className="text-[10px] font-mono text-text-muted/50">
          {picks.length} total
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1"
      >
        {visible.map((pick, i) => {
          const player = playerLookup.get(pick.playerId);
          const isLatest = i === visible.length - 1;

          return (
            <div
              key={pick.overallPick}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md border shrink-0',
                'transition-all duration-300',
                isLatest
                  ? 'border-neon/30 bg-neon/5 shadow-[0_0_8px_rgba(34,211,238,0.1)]'
                  : 'border-border-subtle bg-surface-overlay/30',
              )}
            >
              {/* Pick number */}
              <span className="text-[9px] font-mono tabular-nums text-text-muted/50 w-4 text-right shrink-0">
                {pick.overallPick}
              </span>

              {/* Team pip */}
              {player && (
                <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
              )}

              {/* Pokemon sprite */}
              <PokemonSprite name={pick.pokemonName} size="xs" />

              {/* Name + tier */}
              <Link
                to={pokemonRoute(pick.pokemonName)}
                className={cn(
                  'text-[10px] font-medium truncate max-w-[72px] hover:text-neon hover:underline transition-colors',
                  isLatest ? 'text-text-primary' : 'text-text-secondary',
                )}
              >
                {pick.pokemonName}
              </Link>

              <TierBadge points={pick.tier} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
