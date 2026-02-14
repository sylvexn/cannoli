import { cn } from '@/lib/utils';
import { TierBadge } from '@/components/tier-badge';
import { Badge } from '@/components/ui/badge';
import { PokemonCompactCard } from './pokemon-compact-card';
import type { TierEntry } from '@/data/tier-list';
import { getPokemonData } from '@/data/pokemon-data';
import type { RosterPokemon, Player } from '@/lib/types';
import type { PoolOwnership } from './types';

interface DraftPoolGridProps {
  poolByTier: [number, TierEntry[]][];
  ownershipMap: Map<string, PoolOwnership>;
  playerLookup: Map<string, Player>;
  rosterLookup: Map<string, RosterPokemon>;
  selectedTeamId: string | null;
  isUserPickable?: boolean;
  onCardClick: (name: string) => void;
  onCardHoverStart: (name: string, rect: DOMRect) => void;
  onCardHoverEnd: () => void;
}

export function DraftPoolGrid({
  poolByTier,
  ownershipMap,
  playerLookup,
  rosterLookup,
  selectedTeamId,
  isUserPickable,
  onCardClick,
  onCardHoverStart,
  onCardHoverEnd,
}: DraftPoolGridProps) {
  if (poolByTier.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted text-sm">
        No Pokemon match your filters
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {poolByTier.map(([tier, entries]) => {
        const ownedCount = entries.filter(e => ownershipMap.has(e.name)).length;
        const freeCount = entries.length - ownedCount;

        return (
          <div key={tier} className="group/tier">
            {/* Tier header — sticky */}
            <div className={cn(
              'sticky top-0 z-10 flex items-center gap-2.5 px-2 py-1.5',
              'bg-surface/95 backdrop-blur-sm border-b border-border-subtle',
            )}>
              <TierBadge points={tier} />
              <span className="text-xs font-heading font-semibold text-text-primary">
                Tier {tier}
              </span>
              <div className="flex items-center gap-1.5 ml-auto">
                <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border-subtle text-text-muted font-mono">
                  {entries.length}
                </Badge>
                {ownedCount > 0 && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-neon/30 text-neon font-mono">
                    {ownedCount} owned
                  </Badge>
                )}
                {freeCount > 0 && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border-subtle text-text-muted font-mono">
                    {freeCount} FA
                  </Badge>
                )}
              </div>
            </div>

            {/* Cards grid */}
            <div className="flex flex-wrap gap-1 pl-5 pr-1 py-1.5">
              {entries.map(entry => {
                const ownership = ownershipMap.get(entry.name);
                const owner = ownership ? playerLookup.get(ownership.teamId) : undefined;
                const rosterMon = rosterLookup.get(entry.name);
                const pokeData = getPokemonData(entry.name);
                const types = rosterMon?.types ?? pokeData?.types;
                const isHighlighted = selectedTeamId ? ownership?.teamId === selectedTeamId : false;
                const dimmed = selectedTeamId ? (ownership ? ownership.teamId !== selectedTeamId : false) : false;

                return (
                  <PokemonCompactCard
                    key={entry.name}
                    name={entry.name}
                    types={types}
                    owner={owner}
                    isHighlighted={isHighlighted}
                    isUserPickable={isUserPickable && !ownership}
                    dimmed={dimmed}
                    onClick={onCardClick}
                    onHoverStart={onCardHoverStart}
                    onHoverEnd={onCardHoverEnd}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
