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
import { ArrowRightLeft, AlertTriangle, Sparkles, Swords } from 'lucide-react';
import type { TierEntry } from '@/data/tier-list';
import { getPokemonData } from '@/data/pokemon-data';
import type { RosterPokemon, Player } from '@/lib/types';
import type { PoolOwnership } from './types';
import { findPickConflict, type ConflictInputRoster } from '@/lib/draft-rules';
import type { MatchReason } from '@/lib/pool-search';

interface DraftPoolTableProps {
  pool: TierEntry[];
  ownershipMap: Map<string, PoolOwnership>;
  playerLookup: Map<string, Player>;
  rosterLookup: Map<string, RosterPokemon>;
  selectedTeamId: string | null;
  /** Show tier cost badges (draft mode) */
  showTierBadges?: boolean;
  /** Highest tier the user can pick now after reserving for remaining slots */
  userMaxAffordableCost?: number;
  /** Highest tier the *current drafter* can pick now — drives row dim/disable. */
  drafterMaxAffordableCost?: number;
  /** Current drafter's roster — surfaces dup-species, mega-cap, reserve conflicts. */
  drafterConflictRoster?: ConflictInputRoster;
  /** Point cap (for conflict detection). */
  pointCap?: number;
  /** Match reasons keyed by Pokemon name — surfaces "why matched" tags in rows. */
  matchReasons?: Map<string, MatchReason>;
  onRowClick: (name: string) => void;
}

export function DraftPoolTable({
  pool,
  ownershipMap,
  playerLookup,
  rosterLookup,
  selectedTeamId,
  showTierBadges,
  userMaxAffordableCost,
  drafterMaxAffordableCost,
  drafterConflictRoster,
  pointCap = 110,
  matchReasons,
  onRowClick,
}: DraftPoolTableProps) {
  const affordCap = drafterMaxAffordableCost ?? userMaxAffordableCost;
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
          const pokeData = getPokemonData(entry.name);
          const types = mon?.types ?? pokeData?.types;
          const stats = mon?.stats ?? pokeData?.stats;
          const abilities = mon?.abilities ?? pokeData?.abilities ?? [];
          const isHighlighted = selectedTeamId ? ownership?.teamId === selectedTeamId : false;
          const dimmed = selectedTeamId ? (ownership ? ownership.teamId !== selectedTeamId : false) : false;
          const unaffordable = showTierBadges && !ownership && affordCap != null && entry.tier > affordCap;

          // Hard conflict (illegal pick) for the current drafter — mirrors the
          // grid's conflictKind treatment so both views read the same.
          let conflictKind: 'duplicate-species' | 'mega-cap' | 'roster-reserve' | null = null;
          if (showTierBadges && !ownership && drafterConflictRoster) {
            const c = findPickConflict(entry.name, entry.tier, drafterConflictRoster, pointCap);
            if (c && (c.kind === 'duplicate-species' || c.kind === 'mega-cap' || c.kind === 'roster-reserve')) {
              conflictKind = c.kind;
            }
          }
          const blocked = !!conflictKind || unaffordable;
          const conflictTitle = conflictKind === 'mega-cap'
            ? 'Mega cap reached — drafter already has a Mega'
            : conflictKind === 'duplicate-species'
              ? 'Drafter already has this species'
              : conflictKind === 'roster-reserve'
                ? 'Would leave too few points for remaining picks'
                : unaffordable
                  ? 'Costs more than the drafter can afford'
                  : undefined;

          const bst = stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : null;

          return (
            <TableRow
              key={entry.name}
              onClick={() => { if (!blocked) onRowClick(entry.name); }}
              title={conflictTitle}
              aria-disabled={blocked ? true : undefined}
              data-conflict={conflictKind ?? undefined}
              className={cn(
                'transition-all duration-150 border-b border-border-subtle/50',
                blocked ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-surface-overlay/60',
                isHighlighted && 'bg-surface-overlay/40 hover:bg-surface-overlay/60',
                dimmed && 'opacity-30',
                conflictKind && 'opacity-60 grayscale-[35%]',
                unaffordable && !conflictKind && 'opacity-40 line-through decoration-loss/40',
              )}
              style={{
                borderLeftWidth: owner ? '2px' : undefined,
                borderLeftColor: owner ? owner.teamColor : undefined,
              }}
            >
              <TableCell className="px-2 py-1">
                <PokemonSprite name={entry.name} size="xs" shiny={mon?.isShiny} />
              </TableCell>
              <TableCell className="px-2 py-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-text-primary">{entry.name}</span>
                  {conflictKind && (
                    <span
                      className={cn(
                        'inline-flex items-center gap-0.5 px-1 h-3.5 rounded-sm text-[8px] font-mono font-bold uppercase',
                        'border border-loss/40 bg-loss/10 text-loss',
                      )}
                      aria-label={conflictTitle}
                    >
                      <AlertTriangle size={8} aria-hidden />
                      {conflictKind === 'mega-cap' ? 'MEGA' : conflictKind === 'duplicate-species' ? 'DUP' : 'RESERVE'}
                    </span>
                  )}
                  {(() => {
                    const reason = matchReasons?.get(entry.name);
                    if (!reason) return null;
                    return (
                      <span
                        className={cn(
                          'inline-flex items-center gap-0.5 px-1 h-3.5 rounded-sm text-[8px] font-mono uppercase max-w-[80px] truncate',
                          reason.kind === 'ability'
                            ? 'border border-draw/30 bg-draw/10 text-draw/90'
                            : 'border border-neon/30 bg-neon/10 text-neon/90',
                        )}
                        title={`Matched via ${reason.kind}: ${reason.label}`}
                      >
                        {reason.kind === 'ability'
                          ? <Sparkles size={8} aria-hidden />
                          : <Swords size={8} aria-hidden />}
                        <span className="truncate">{reason.label}</span>
                      </span>
                    );
                  })()}
                </div>
                {mon?.nickname && (
                  <span className="block text-[10px] italic font-mono text-text-muted truncate max-w-[140px]" title={mon.nickname}>
                    "{mon.nickname}"
                  </span>
                )}
              </TableCell>
              <TableCell className="px-2 py-1 text-center">
                <TierBadge points={entry.tier} />
              </TableCell>
              <TableCell className="px-2 py-1">
                {types && <TypeChip types={types} size="xs" />}
              </TableCell>
              <TableCell className="px-2 py-1 text-right">
                {bst && <span className="text-xs font-mono tabular-nums text-text-secondary">{bst}</span>}
              </TableCell>
              <TableCell className="px-2 py-1">
                {abilities.length > 0 && (
                  <div className="flex flex-wrap gap-0.5">
                    {abilities.slice(0, 2).map(a => (
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
                    <TeamLogo abbrev={owner.teamAbbrev} color={owner.teamColor} size="sm" logoPath={owner.logoPath} />
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
