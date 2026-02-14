import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { TierBadge } from '@/components/tier-badge';
import { StatBar } from '@/components/stat-bar';
import { AbilityChip } from '@/components/ability-chip';
import { TeamLogo } from '@/components/team-logo';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ArrowRightLeft } from 'lucide-react';
import type { RosterPokemon, Player } from '@/lib/types';
import type { PoolOwnership } from './types';
import { getTierEntry } from '@/data/tier-list';
import { getPokemonData } from '@/data/pokemon-data';

interface PokemonHoverCardProps {
  name: string;
  rect: DOMRect;
  rosterLookup: Map<string, RosterPokemon>;
  ownershipMap: Map<string, PoolOwnership>;
  playerLookup: Map<string, Player>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function PokemonHoverCard({
  name,
  rect,
  rosterLookup,
  ownershipMap,
  playerLookup,
  onMouseEnter,
  onMouseLeave,
}: PokemonHoverCardProps) {
  const mon = rosterLookup.get(name);
  const pokeData = getPokemonData(name);
  const ownership = ownershipMap.get(name);
  const owner = ownership ? playerLookup.get(ownership.teamId) : undefined;
  const tierEntry = getTierEntry(name);

  // Unified data: prefer roster data (has season stats etc), fall back to pokedex
  const types = mon?.types ?? pokeData?.types;
  const stats = mon?.stats ?? pokeData?.stats;
  const abilities = mon?.abilities ?? pokeData?.abilities ?? [];
  const bst = stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : null;

  // Position: right of the card, or left if near right edge
  const cardWidth = 240;
  const gap = 8;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = rect.right + gap;
  if (left + cardWidth > viewportWidth - 16) {
    left = rect.left - cardWidth - gap;
  }

  let top = rect.top;
  const estimatedHeight = stats ? 300 : 120;
  if (top + estimatedHeight > viewportHeight - 16) {
    top = viewportHeight - estimatedHeight - 16;
  }
  if (top < 16) top = 16;

  const card = (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'fixed z-50 w-[240px] rounded-lg',
        'bg-surface-raised border border-border-default shadow-card-lg',
        'animate-in fade-in-0 zoom-in-95 duration-150',
        'pointer-events-auto',
      )}
      style={{ top, left }}
    >
      {/* Header */}
      <div className="flex items-start gap-2.5 p-3 pb-2">
        <PokemonSprite name={name} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary leading-tight">{name}</div>
          <div className="flex items-center gap-1.5 mt-1">
            {tierEntry && <TierBadge points={tierEntry.tier} />}
            {types && <TypeChip types={types} size="xs" />}
          </div>
          {bst && (
            <div className="text-[10px] text-text-muted font-mono mt-0.5">
              BST {bst}
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <>
          <Separator className="bg-border-subtle" />
          <div className="px-3 py-2 space-y-0.5">
            <StatBar label="HP" value={stats.hp} />
            <StatBar label="Atk" value={stats.atk} />
            <StatBar label="Def" value={stats.def} />
            <StatBar label="SpA" value={stats.spa} />
            <StatBar label="SpD" value={stats.spd} />
            <StatBar label="Spe" value={stats.spe} />
          </div>
        </>
      )}

      {/* Abilities */}
      {abilities.length > 0 && (
        <>
          <Separator className="bg-border-subtle" />
          <div className="px-3 py-2 flex flex-wrap gap-1">
            {abilities.map(a => (
              <AbilityChip key={a} name={a} />
            ))}
          </div>
        </>
      )}

      {/* Ownership */}
      {owner && (
        <>
          <Separator className="bg-border-subtle" />
          <div className="px-3 py-2 flex items-center gap-2">
            <TeamLogo abbrev={owner.teamAbbrev} color={owner.teamColor} size="sm" />
            <span className="text-[11px] text-text-secondary">
              {ownership!.acquisition.method === 'traded' ? (
                <span className="flex items-center gap-1">
                  <ArrowRightLeft size={10} className="text-pink" />
                  Traded from {playerLookup.get(ownership!.acquisition.fromTeamId!)?.teamAbbrev}
                  {ownership!.acquisition.week && ` (Week ${ownership!.acquisition.week})`}
                </span>
              ) : (
                <span>
                  Drafted by {owner.teamAbbrev}
                  {ownership!.acquisition.round && ` (R${ownership!.acquisition.round}P${ownership!.acquisition.pick})`}
                </span>
              )}
            </span>
          </div>
        </>
      )}

      {/* Free agent badge */}
      {!owner && tierEntry && (
        <>
          <Separator className="bg-border-subtle" />
          <div className="px-3 py-2 flex items-center justify-center gap-1.5">
            <span className="text-[10px] text-text-muted">Free agent</span>
            {tierEntry.teraBanned && (
              <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-loss/30 text-loss">
                Tera banned
              </Badge>
            )}
          </div>
        </>
      )}
    </div>
  );

  return createPortal(card, document.body);
}
