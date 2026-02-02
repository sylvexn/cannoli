import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeBadge } from '@/components/type-badge';
import { TierBadge } from '@/components/tier-badge';
import type { RosterPokemon } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';
import { Star } from 'lucide-react';

interface OverviewTabProps {
  teamA: RosterPokemon[];
  teamB: RosterPokemon[];
}

export function OverviewTab({ teamA, teamB }: OverviewTabProps) {
  // Speed tier data: merge both teams, sort by speed descending
  const speedTiers = useMemo(() => {
    const all = [
      ...teamA.map(p => ({ ...p, side: 'a' as const })),
      ...teamB.map(p => ({ ...p, side: 'b' as const })),
    ].sort((a, b) => b.stats.spe - a.stats.spe);
    return all;
  }, [teamA, teamB]);

  return (
    <div className="space-y-6">
      {/* Team Information View — side by side roster tables */}
      <div className="grid grid-cols-2 gap-4">
        <RosterTable team={teamA} side="a" />
        <RosterTable team={teamB} side="b" />
      </div>

      {/* Speed Tier Comparison */}
      <div className="rounded-lg border border-border-default bg-surface-raised/50 p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">Speed Tiers</h3>
        <div className="space-y-0.5">
          {speedTiers.map((pokemon) => (
            <div
              key={`${pokemon.name}-${pokemon.side}`}
              className={cn(
                'flex items-center gap-2 py-1 px-2 rounded text-sm',
                pokemon.side === 'a' ? 'bg-[#3b82f6]/5' : 'bg-[#ef4444]/5',
              )}
            >
              <div className={cn(
                'w-[40%] flex items-center gap-2',
                pokemon.side === 'b' && 'flex-row-reverse',
              )}>
                {pokemon.side === 'a' && (
                  <div className="flex items-center gap-2 flex-1">
                    <PokemonSprite name={pokemon.name} size="xs" />
                    <span className="text-xs text-text-primary truncate">{pokemon.name}</span>
                  </div>
                )}
              </div>

              <div className="w-[20%] flex items-center justify-center">
                <span className={cn(
                  'text-sm font-mono font-bold tabular-nums px-2 py-0.5 rounded',
                  pokemon.side === 'a' ? 'text-[#3b82f6]' : 'text-[#ef4444]',
                )}>
                  {pokemon.stats.spe}
                </span>
              </div>

              <div className={cn(
                'w-[40%] flex items-center gap-2',
                pokemon.side === 'a' && 'flex-row-reverse',
              )}>
                {pokemon.side === 'b' && (
                  <div className="flex items-center gap-2 flex-1 justify-end">
                    <span className="text-xs text-text-primary truncate">{pokemon.name}</span>
                    <PokemonSprite name={pokemon.name} size="xs" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RosterTable({ team, side }: { team: RosterPokemon[]; side: 'a' | 'b' }) {
  const colors = side === 'a'
    ? { header: 'bg-[#3b82f6]/10 text-[#3b82f6]', row: 'hover:bg-[#3b82f6]/5' }
    : { header: 'bg-[#ef4444]/10 text-[#ef4444]', row: 'hover:bg-[#ef4444]/5' };

  return (
    <div className="rounded-lg border border-border-default overflow-hidden">
      <div className={cn('px-3 py-2 text-sm font-medium', colors.header)}>
        {side === 'a' ? 'My Team' : 'Opponent'}
      </div>
      <div className="divide-y divide-border-subtle">
        {team.length === 0 ? (
          <div className="px-3 py-8 text-center text-text-muted text-sm">No team selected</div>
        ) : (
          team.map(pokemon => (
            <div key={pokemon.name} className={cn('flex items-center gap-2 px-2 py-1.5', colors.row)}>
              <PokemonSprite name={pokemon.name} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-text-primary font-medium truncate">{pokemon.name}</span>
                  {pokemon.isTeraCaptain && (
                    <Star size={10} className="text-draw shrink-0 fill-draw" />
                  )}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  {pokemon.types.map(t => (
                    <TypeBadge key={t} type={t as PokemonType} size="sm" />
                  ))}
                </div>
              </div>
              <TierBadge points={pokemon.tier} />
              <div className="text-[10px] text-text-muted text-right w-20 shrink-0">
                {pokemon.abilities.slice(0, 2).join(', ')}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
