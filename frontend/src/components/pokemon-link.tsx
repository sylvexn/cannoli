import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { TierBadge } from '@/components/tier-badge';
import { StatBar } from '@/components/stat-bar';
import { AbilityChip } from '@/components/ability-chip';
import { Separator } from '@/components/ui/separator';
import { getPokemonData } from '@/data/pokemon-data';
import { getTierEntry, type CostFormat } from '@/data/tier-list';
import { pokemonRoute } from '@/lib/pokemon-route';

interface PokemonLinkProps {
  name: string;
  /** Custom label; defaults to the name. */
  children?: ReactNode;
  className?: string;
  /** Render a plain link with no hover card. */
  noHoverCard?: boolean;
  /** Cost format for the tier badge (defaults to the global tier list). */
  format?: CostFormat;
}

/**
 * Inline Pokemon name → links to /pokemon/:name and opens a hover card
 * (sprite, tier, types, base stats, abilities) on hover. Mirrors the
 * Popover-on-hover pattern of <TeamLink>/<CoachLink> so any Pokemon mention
 * can get the same treatment without re-plumbing the draft-board popover.
 */
export function PokemonLink({ name, children, className, noHoverCard, format }: PokemonLinkProps) {
  const data = getPokemonData(name);

  // No bundled data (odd form / mismatch) → plain link, no empty card.
  if (noHoverCard || !data) {
    return (
      <Link to={pokemonRoute(name)} onClick={e => e.stopPropagation()} className={className}>
        {children ?? name}
      </Link>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        nativeButton={false}
        openOnHover
        delay={250}
        closeDelay={120}
        render={
          <Link to={pokemonRoute(name)} onClick={e => e.stopPropagation()} className={className} />
        }
      >
        {children ?? name}
      </PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={6} className="w-56 p-2.5 border-border-default">
        <PokemonPreview name={name} format={format} />
      </PopoverContent>
    </Popover>
  );
}

function PokemonPreview({ name, format }: { name: string; format?: CostFormat }) {
  const data = getPokemonData(name);
  const tier = getTierEntry(name, format);
  if (!data) return null;
  const { types, stats, abilities } = data;
  const bst = stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : null;

  return (
    <div>
      <div className="flex items-start gap-2.5">
        <div className="shrink-0 rounded-md bg-surface-overlay/50 p-1">
          <PokemonSprite name={name} size="md" />
        </div>
        <div className="flex-1 min-w-0">
          <Link
            to={pokemonRoute(name)}
            className="block font-heading text-sm font-bold leading-tight text-text-primary hover:text-neon truncate"
          >
            {name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {tier && <TierBadge points={tier.tier} />}
            {types && <TypeChip types={types} size="xs" />}
          </div>
          {bst != null && (
            <div className="mt-0.5 font-mono text-[10px] text-text-muted">BST {bst}</div>
          )}
        </div>
      </div>

      {stats && (
        <>
          <Separator className="my-2 bg-border-subtle" />
          <div className="space-y-0.5">
            <StatBar label="HP" value={stats.hp} />
            <StatBar label="Atk" value={stats.atk} />
            <StatBar label="Def" value={stats.def} />
            <StatBar label="SpA" value={stats.spa} />
            <StatBar label="SpD" value={stats.spd} />
            <StatBar label="Spe" value={stats.spe} />
          </div>
        </>
      )}

      {abilities && abilities.length > 0 && (
        <>
          <Separator className="my-2 bg-border-subtle" />
          <div className="flex flex-wrap gap-1">
            {abilities.map(a => <AbilityChip key={a} name={a} />)}
          </div>
        </>
      )}
    </div>
  );
}
