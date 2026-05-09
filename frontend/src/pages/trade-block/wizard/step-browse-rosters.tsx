import { useMemo, useState } from 'react';
import { TeamLogo } from '@/components/team-logo';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Filter } from 'lucide-react';
import type { Player } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';
import { isMegaForm } from '@/lib/draft-rules';
import { cn } from '@/lib/utils';

interface BrowseRostersStepProps {
  proposer: Player | null;
  recipient: Player | null;
}

const TIER_FILTERS = [
  { value: 'all', label: 'All tiers' },
  { value: 'apex', label: 'Apex (T18+)' },
  { value: 'high', label: 'High (T12+)' },
  { value: 'mid', label: 'Mid (T8-11)' },
  { value: 'low', label: 'Low (T1-7)' },
] as const;

const TYPE_FILTERS = [
  'all', 'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting',
  'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon',
  'dark', 'steel', 'fairy',
] as const;

type TierFilter = typeof TIER_FILTERS[number]['value'];
type TypeFilter = typeof TYPE_FILTERS[number];

function tierMatches(tier: number, f: TierFilter): boolean {
  if (f === 'all') return true;
  if (f === 'apex') return tier >= 18;
  if (f === 'high') return tier >= 12 && tier < 18;
  if (f === 'mid') return tier >= 8 && tier < 12;
  if (f === 'low') return tier < 8;
  return true;
}

/**
 * Step 2 — read-only side-by-side roster browse, filterable by tier band and
 * type. The user explores both rosters here before committing to specific
 * picks in the next step.
 */
export function BrowseRostersStep({ proposer, recipient }: BrowseRostersStepProps) {
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Filter size={12} className="text-text-muted" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Filter</span>
        <Select value={tierFilter} onValueChange={v => setTierFilter(v as TierFilter)}>
          <SelectTrigger className="h-7 w-[140px] text-xs bg-surface-overlay">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIER_FILTERS.map(t => (
              <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={v => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="h-7 w-[120px] text-xs bg-surface-overlay capitalize">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTERS.map(t => (
              <SelectItem key={t} value={t} className="text-xs capitalize">{t === 'all' ? 'All types' : t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <RosterColumn team={proposer} tierFilter={tierFilter} typeFilter={typeFilter} />
        <RosterColumn team={recipient} tierFilter={tierFilter} typeFilter={typeFilter} />
      </div>
    </div>
  );
}

function RosterColumn({
  team,
  tierFilter,
  typeFilter,
}: {
  team: Player | null;
  tierFilter: TierFilter;
  typeFilter: TypeFilter;
}) {
  const filtered = useMemo(() => {
    if (!team) return [];
    return team.roster.filter(m => {
      if (!tierMatches(m.tier, tierFilter)) return false;
      if (typeFilter !== 'all' && !m.types.includes(typeFilter)) return false;
      return true;
    });
  }, [team, tierFilter, typeFilter]);

  if (!team) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle p-4 text-center text-xs text-text-muted">
        No team selected
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
        <span className="text-xs font-medium text-text-primary truncate">{team.teamAbbrev}</span>
        <Badge variant="outline" className="text-[10px] ml-auto">
          {filtered.length}/{team.roster.length}
        </Badge>
      </div>
      <div className="rounded-md border border-border-subtle max-h-[300px] overflow-y-auto divide-y divide-border-subtle/40">
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-center text-[10px] text-text-muted">No matches</div>
        )}
        {filtered.map(mon => (
          <div
            key={mon.name}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5',
              'hover:bg-surface-overlay/40 transition-colors',
            )}
          >
            <PokemonSprite name={mon.name} size="xs" />
            <span className="text-[11px] text-text-primary flex-1 min-w-0 truncate">{mon.name}</span>
            <TypeChip types={mon.types as PokemonType[]} size="xs" />
            {isMegaForm(mon.name) && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 text-purple-400 border-purple-400/30">M</Badge>
            )}
            <TierBadge points={mon.tier} />
          </div>
        ))}
      </div>
    </div>
  );
}
