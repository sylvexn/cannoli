import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeBadge } from '@/components/type-badge';
import { TierBadge } from '@/components/tier-badge';
import type { RosterPokemon } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';
import { AbilityChip } from '@/components/ability-chip';
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
    <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
      {/* Team A roster */}
      <RosterTable team={teamA} side="a" />

      {/* Speed Tier Comparison — center column */}
      <div className="w-72 rounded-lg border border-border-default bg-surface-raised/50 overflow-hidden">
        <div className="px-3 py-1.5 text-xs font-medium text-text-muted text-center border-b border-border-subtle bg-surface-overlay/30">
          Speed Tiers
        </div>
        <div>
          {speedTiers.map((pokemon) => (
            <div
              key={`${pokemon.name}-${pokemon.side}`}
              className={cn(
                'flex items-center py-0.5 px-1.5',
                pokemon.side === 'a' ? 'bg-[#3b82f6]/5' : 'bg-[#ef4444]/5',
              )}
            >
              {/* Left: Team A name+sprite */}
              <div className="flex-1 min-w-0">
                {pokemon.side === 'a' && (
                  <div className="flex items-center gap-1.5 justify-end">
                    <span className="text-[11px] text-text-primary truncate">{pokemon.name}</span>
                    <PokemonSprite name={pokemon.name} size="xs" />
                  </div>
                )}
              </div>

              {/* Center: speed value */}
              <span className={cn(
                'text-xs font-mono font-bold tabular-nums w-10 text-center shrink-0',
                pokemon.side === 'a' ? 'text-[#3b82f6]' : 'text-[#ef4444]',
              )}>
                {pokemon.stats.spe}
              </span>

              {/* Right: Team B name+sprite */}
              <div className="flex-1 min-w-0">
                {pokemon.side === 'b' && (
                  <div className="flex items-center gap-1.5">
                    <PokemonSprite name={pokemon.name} size="xs" />
                    <span className="text-[11px] text-text-primary truncate">{pokemon.name}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Team B roster */}
      <RosterTable team={teamB} side="b" />
    </div>
  );
}

function RosterTable({ team, side }: { team: RosterPokemon[]; side: 'a' | 'b' }) {
  const colors = side === 'a'
    ? { header: 'bg-[#3b82f6]/10 text-[#3b82f6]', row: 'hover:bg-[#3b82f6]/5' }
    : { header: 'bg-[#ef4444]/10 text-[#ef4444]', row: 'hover:bg-[#ef4444]/5' };

  return (
    <div className="rounded-lg border border-border-default overflow-hidden">
      <div className={cn('px-3 py-1.5 text-sm font-medium', colors.header)}>
        {side === 'a' ? 'My Team' : 'Opponent'}
      </div>
      <div className="divide-y divide-border-subtle">
        {team.length === 0 ? (
          <div className="px-3 py-8 text-center text-text-muted text-sm">No team selected</div>
        ) : (
          team.map(pokemon => (
            <div key={pokemon.name} className={cn('flex items-center gap-2 px-2 py-1', colors.row)}>
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
              <div className="flex flex-wrap gap-0.5 justify-end shrink-0 max-w-[140px]">
                {pokemon.abilities.slice(0, 2).map(a => (
                  <AbilityChip key={a} name={a} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
