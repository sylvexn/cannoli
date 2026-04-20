import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TIER_LIST, TERA_BANNED, canBeTeraCaptain, type TierEntry } from '@/data/tier-list';
import { getPokemonData } from '@/data/pokemon-data';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { EmptyState } from '@/components/empty-state';
import { Search, X, Star, ShieldOff, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pokemonRoute } from '@/lib/pokemon-route';
import type { PokemonType } from '@/lib/pokemon';

type Filter = 'all' | 'captains' | 'tera-banned';

export function TierListPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const filtered: TierEntry[] = useMemo(() => {
    let list = TIER_LIST;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q));
    }
    if (filter === 'captains') {
      list = list.filter(e => canBeTeraCaptain(e.name));
    } else if (filter === 'tera-banned') {
      list = list.filter(e => e.teraBanned);
    }
    return list;
  }, [search, filter]);

  // Group by tier
  const byTier = useMemo(() => {
    const map = new Map<number, TierEntry[]>();
    for (const e of filtered) {
      const arr = map.get(e.tier) ?? [];
      arr.push(e);
      map.set(e.tier, arr);
    }
    // Sort each tier alphabetically
    for (const arr of map.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    // Return tiers descending
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [filtered]);

  const totalCount = TIER_LIST.length;
  const captainCount = TIER_LIST.filter(e => canBeTeraCaptain(e.name)).length;
  const banCount = TERA_BANNED.length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-purple-400">Tier</span>
          <span className="text-text-primary ml-1">List</span>
        </h1>
        <p className="text-sm text-text-muted">
          Browse the full draft pool by tier. {totalCount} Pokémon · {captainCount} captain-eligible · {banCount} tera-banned.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search Pokémon by name..."
            className="w-full pl-8 pr-8 py-1.5 rounded-md bg-surface text-sm border border-border-subtle focus:border-neon/40 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border-subtle overflow-hidden">
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')} icon={<Filter size={11} />}>
            All
          </FilterButton>
          <FilterButton active={filter === 'captains'} onClick={() => setFilter('captains')} icon={<Star size={11} className="text-yellow-400" />}>
            Captain-eligible
          </FilterButton>
          <FilterButton active={filter === 'tera-banned'} onClick={() => setFilter('tera-banned')} icon={<ShieldOff size={11} className="text-loss" />}>
            Tera-banned
          </FilterButton>
        </div>

        <span className="ml-auto text-[11px] text-text-muted font-mono">
          {filtered.length} / {totalCount} shown
        </span>
      </div>

      {/* Tier sections */}
      <div className="space-y-3">
        {byTier.map(([tier, entries]) => (
          <TierSection key={tier} tier={tier} entries={entries} />
        ))}
        {byTier.length === 0 && (
          <Card className="bg-surface-raised border-border-default">
            <CardContent className="py-2">
              <EmptyState
                variant="nothing-here"
                title="No Pokémon match these filters."
                spriteSize="md"
                padding="sm"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function TierSection({ tier, entries }: { tier: number; entries: TierEntry[] }) {
  return (
    <Card className="bg-surface-raised border-border-default overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TierBadge points={tier} />
          <span className="font-mono uppercase tracking-wider text-text-secondary text-xs">
            Tier {tier}
          </span>
          <span className="ml-auto text-[10px] text-text-muted font-mono">
            {entries.length} mon
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-1.5">
          {entries.map(entry => (
            <TierRow key={entry.name} entry={entry} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TierRow({ entry }: { entry: TierEntry }) {
  const data = getPokemonData(entry.name);
  const types = (data?.types ?? []) as PokemonType[];
  const captainEligible = canBeTeraCaptain(entry.name);

  return (
    <Link
      to={pokemonRoute(entry.name)}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-surface-overlay/60 transition-colors group',
        entry.teraBanned && 'opacity-80',
      )}
    >
      <PokemonSprite name={entry.name} size="xs" />
      <span className="text-xs text-text-primary truncate flex-1 group-hover:text-neon transition-colors">
        {entry.name}
      </span>
      {captainEligible && (
        <Star size={10} className="text-yellow-400/70 shrink-0" />
      )}
      {entry.teraBanned && (
        <Badge variant="outline" className="text-[8px] px-1 py-0 border-loss/30 text-loss">
          NoT
        </Badge>
      )}
      {types.length > 0 && (
        <TypeChip types={types} size="xs" />
      )}
    </Link>
  );
}

function FilterButton({ active, onClick, icon, children }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-surface-overlay text-text-primary'
          : 'text-text-muted hover:bg-surface-overlay/40 hover:text-text-secondary',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
