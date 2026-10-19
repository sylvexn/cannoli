import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { AbilityChip } from '@/components/ability-chip';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { TeraIndicator } from '@/components/tera-indicator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { pokemonRoute } from '@/lib/pokemon-route';
import { TYPE_COLORS } from '@/lib/constants';
import { getPokemonData } from '@/data/pokemon-data';
import { monCost, baseTier } from '@/lib/draft-center/rules';
import { setSpeed } from '@/lib/draft-center/sets';
import type { Ruleset } from '@/lib/draft-center/ruleset';
import type { DcMon } from '@/lib/draft-center/types';

/** Team information: sprite, types, abilities, tier/cost, tera types and the set at a glance. */
export function InfoPanel({ roster, ruleset }: { roster: DcMon[]; ruleset: Ruleset }) {
  if (roster.length === 0) {
    return <div className="rounded-lg border border-dashed border-border-default p-8 text-center text-sm text-text-muted">Add Pokemon to see the team overview.</div>;
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
      {roster.map(m => <InfoCard key={m.name} mon={m} ruleset={ruleset} />)}
    </div>
  );
}

function InfoCard({ mon, ruleset }: { mon: DcMon; ruleset: Ruleset }) {
  const data = getPokemonData(mon.name);
  const tier = baseTier(mon.name, ruleset.costFormat);
  const cost = monCost(mon, ruleset.costFormat);
  const spe = setSpeed(mon);
  return (
    <div className={cn(
      'rounded-lg border bg-surface-raised/50 p-2 flex flex-col gap-1.5 min-w-0',
      mon.captain ? 'border-pink-400/40' : 'border-border-default',
    )}>
      <div className="flex items-center gap-2 min-w-0">
        <Link to={pokemonRoute(mon.name)} className="shrink-0 hover:scale-105 transition-transform">
          <PokemonSprite name={mon.name} size="md" />
        </Link>
        <div className="min-w-0 flex-1">
          <TeraIndicator
            name={mon.name}
            isTeraCaptain={mon.captain}
            teraTypes={mon.teraTypes}
            asLink
            className="text-sm font-mono font-semibold truncate block"
          />
          <div className="mt-0.5 flex items-center gap-1.5">
            <TypeChip types={data?.types ?? []} size="xs" />
          </div>
        </div>
        <div className="shrink-0 text-right">
          {tier != null && <TierBadge points={tier} />}
          {mon.captain && tier != null && cost !== tier && (
            <div className="text-[9px] font-mono text-pink-400 tabular-nums" title="Cost with tera captain markup">{cost}pt</div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-0.5">
        {(data?.abilities ?? []).map(a => (
          <span key={a} className={cn(mon.set?.ability === a && 'ring-1 ring-neon/60 rounded')}>
            <AbilityChip name={a} />
          </span>
        ))}
      </div>

      {mon.captain && mon.teraTypes.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-[9px] font-mono uppercase text-pink-400">Tera</span>
          {mon.teraTypes.map(t => (
            <Tooltip key={t}>
              <TooltipTrigger render={<span className="size-3 rounded-full ring-1 ring-white/20" style={{ backgroundColor: TYPE_COLORS[t] }} />} />
              <TooltipContent side="top"><span className="capitalize">{t}</span></TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}

      {mon.set && (mon.set.moves.length > 0 || mon.set.item) && (
        <div className="text-[10px] leading-snug text-text-secondary border-t border-border-subtle pt-1">
          {mon.set.item && <span className="text-text-primary">{mon.set.item}</span>}
          {mon.set.item && mon.set.nature && <span className="text-text-muted"> · </span>}
          {mon.set.nature && <span>{mon.set.nature}</span>}
          {spe != null && <span className="text-text-muted"> · Spe {spe}</span>}
          {mon.set.moves.length > 0 && <div className="font-mono text-text-muted">{mon.set.moves.join(' / ')}</div>}
        </div>
      )}
    </div>
  );
}
