import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { AbilityChip } from '@/components/ability-chip';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { TeraIndicator } from '@/components/tera-indicator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { RosterPokemon } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';

interface OverviewTabProps {
  teamA: RosterPokemon[];
  teamB: RosterPokemon[];
}

export function OverviewTab({ teamA, teamB }: OverviewTabProps) {
  const speedTiers = useMemo(() => {
    return [
      ...teamA.map(p => ({ ...p, side: 'a' as const })),
      ...teamB.map(p => ({ ...p, side: 'b' as const })),
    ].sort((a, b) => b.stats.spe - a.stats.spe);
  }, [teamA, teamB]);

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
      <RosterTable team={teamA} side="a" />

      {/* Speed Tier Comparison */}
      <div className="w-72 rounded-lg border border-border-default bg-surface-raised/50 overflow-hidden">
        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-text-muted text-center border-b border-border-subtle bg-surface-overlay/30">
          Speed Tiers
        </div>
        <div>
          {speedTiers.map((pokemon) => (
            <div
              key={`${pokemon.name}-${pokemon.side}`}
              className={cn(
                'flex items-center py-0.5 px-1.5',
                pokemon.side === 'a' ? 'bg-[#3b82f6]/10' : 'bg-[#ef4444]/10',
              )}
            >
              <div className="flex-1 min-w-0">
                {pokemon.side === 'a' && (
                  <div className="flex items-center gap-1.5 justify-end">
                    <span className="text-[11px] font-mono text-text-primary truncate">{pokemon.name}</span>
                    <PokemonSprite name={pokemon.name} size="xs" />
                  </div>
                )}
              </div>
              <span className={cn(
                'text-xs font-mono font-bold tabular-nums w-10 text-center shrink-0',
                pokemon.side === 'a' ? 'text-[#3b82f6]' : 'text-[#ef4444]',
              )}>
                {pokemon.stats.spe}
              </span>
              <div className="flex-1 min-w-0">
                {pokemon.side === 'b' && (
                  <div className="flex items-center gap-1.5">
                    <PokemonSprite name={pokemon.name} size="xs" />
                    <span className="text-[11px] font-mono text-text-primary truncate">{pokemon.name}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <RosterTable team={teamB} side="b" />
    </div>
  );
}

function RosterTable({ team, side }: { team: RosterPokemon[]; side: 'a' | 'b' }) {
  const colors = side === 'a'
    ? { header: 'bg-[#3b82f6]/10 text-[#3b82f6]' }
    : { header: 'bg-[#ef4444]/10 text-[#ef4444]' };

  if (team.length === 0) {
    return (
      <div className="rounded-lg border border-border-default p-8 text-center text-text-muted text-sm">
        No team selected
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-default overflow-hidden">
      <div className={cn('px-3 py-1.5 text-sm font-heading font-semibold', colors.header)}>
        {side === 'a' ? 'My Team' : 'Opponent'}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 px-1"></TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider text-text-muted">Name</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider text-text-muted w-20">Type</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider text-text-muted w-8 text-center">Tier</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider text-text-muted text-right">Abilities</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {team.map(pokemon => (
            <TableRow key={pokemon.name}>
              <TableCell className="px-1 py-1">
                <PokemonSprite name={pokemon.name} size="sm" />
              </TableCell>
              <TableCell className="py-1">
                <TeraIndicator
                  name={pokemon.name}
                  isTeraCaptain={pokemon.isTeraCaptain}
                  teraTypes={pokemon.teraTypes as PokemonType[] | undefined}
                  className="text-sm font-mono font-medium"
                />
              </TableCell>
              <TableCell className="py-1">
                <TypeChip types={pokemon.types as PokemonType[]} size="xs" />
              </TableCell>
              <TableCell className="py-1 text-center">
                <TierBadge points={pokemon.tier} />
              </TableCell>
              <TableCell className="py-1">
                <div className="flex flex-wrap gap-0.5 justify-end">
                  {pokemon.abilities.slice(0, 2).map(a => (
                    <AbilityChip key={a} name={a} />
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
