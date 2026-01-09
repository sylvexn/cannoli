import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { TierBadge } from '@/components/tier-badge';
import { TeamLogo } from '@/components/team-logo';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowRightLeft } from 'lucide-react';
import type { TierEntry } from '@/mocks/tier-list';
import type { RosterPokemon, Player } from '@/lib/types';
import type { PoolOwnership } from './types';

interface DraftPoolTableProps {
  pool: TierEntry[];
  ownershipMap: Map<string, PoolOwnership>;
  playerLookup: Map<string, Player>;
  rosterLookup: Map<string, RosterPokemon>;
  selectedTeamId: string | null;
  onRowClick: (name: string) => void;
}

export function DraftPoolTable({
  pool,
  ownershipMap,
  playerLookup,
  rosterLookup,
  selectedTeamId,
  onRowClick,
}: DraftPoolTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b border-border-subtle hover:bg-transparent">
          <TableHead className="w-8 px-2"></TableHead>
          <TableHead className="text-[10px] uppercase text-text-muted px-2">Pokemon</TableHead>
          <TableHead className="text-[10px] uppercase text-text-muted px-2 w-12 text-center">Tier</TableHead>
          <TableHead className="text-[10px] uppercase text-text-muted px-2 w-20">Type</TableHead>
          <TableHead className="text-[10px] uppercase text-text-muted px-2 w-14 text-right">BST</TableHead>
          <TableHead className="text-[10px] uppercase text-text-muted px-2 w-32">Abilities</TableHead>
          <TableHead className="text-[10px] uppercase text-text-muted px-2 w-28">Owner</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pool.map(entry => {
          const ownership = ownershipMap.get(entry.name);
          const owner = ownership ? playerLookup.get(ownership.teamId) : undefined;
          const mon = rosterLookup.get(entry.name);
          const isHighlighted = selectedTeamId ? ownership?.teamId === selectedTeamId : false;
          const dimmed = selectedTeamId ? (ownership ? ownership.teamId !== selectedTeamId : false) : false;
          const bst = mon ? mon.stats.hp + mon.stats.atk + mon.stats.def + mon.stats.spa + mon.stats.spd + mon.stats.spe : null;

          return (
            <TableRow
              key={entry.name}
              onClick={() => onRowClick(entry.name)}
              className={cn(
                'cursor-pointer transition-all duration-150 border-b border-border-subtle/50',
                'hover:bg-surface-overlay/60',
                isHighlighted && 'bg-surface-overlay/40 hover:bg-surface-overlay/60',
                dimmed && 'opacity-30',
              )}
              style={{
                borderLeftWidth: owner ? '2px' : undefined,
                borderLeftColor: owner ? owner.teamColor : undefined,
              }}
            >
              <TableCell className="px-2 py-1">
                <PokemonSprite name={entry.name} size="xs" />
              </TableCell>
              <TableCell className="px-2 py-1">
                <span className="text-xs font-medium text-text-primary">{entry.name}</span>
              </TableCell>
              <TableCell className="px-2 py-1 text-center">
                <TierBadge points={entry.tier} />
              </TableCell>
              <TableCell className="px-2 py-1">
                {mon && <TypeChip types={mon.types} size="xs" />}
              </TableCell>
              <TableCell className="px-2 py-1 text-right">
                {bst && <span className="text-xs font-mono tabular-nums text-text-secondary">{bst}</span>}
              </TableCell>
              <TableCell className="px-2 py-1">
                {mon && (
                  <div className="flex flex-wrap gap-0.5">
                    {mon.abilities.slice(0, 2).map(a => (
                      <Badge key={a} variant="outline" className="text-[9px] h-4 px-1 border-border-subtle text-text-muted">
                        {a}
                      </Badge>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell className="px-2 py-1">
                {owner ? (
                  <div className="flex items-center gap-1.5">
                    <TeamLogo abbrev={owner.teamAbbrev} color={owner.teamColor} size="sm" />
                    <span className="text-[11px] text-text-secondary">{owner.teamAbbrev}</span>
                    {ownership!.acquisition.method === 'traded' && (
                      <ArrowRightLeft size={10} className="text-pink" />
                    )}
                  </div>
                ) : (
                  <span className="text-[10px] text-text-muted">FA</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
