import { useState, useMemo, useEffect } from 'react';
import { computeLeagueStats, type PokemonLeagueStat } from '@/lib/pokemon-stats';
import { useLeagueData } from '@/lib/league-data-context';
import { PokemonSprite, preloadSprites } from '@/components/pokemon-sprite';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { TypeChip } from '@/components/type-chip';
import { TierBadge } from '@/components/tier-badge';
import { TeamLogo } from '@/components/team-logo';
import { RecordDisplay } from '@/components/record-display';
import { KDDisplay } from '@/components/kd-display';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLeagueUrl } from '@/lib/use-league-url';
import { pokemonRoute } from '@/lib/pokemon-route';
import { Skeleton } from '@/components/ui/skeleton';
import { StatsTableSkeleton } from '@/components/skeletons';
import { StatsFilterBar, defaultFilters, type StatsFilters } from './stats-filter-bar';

type SortKey = 'kills' | 'deaths' | 'differential' | 'gp' | 'kpg' | 'tier' | 'name' | 'record';

interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const columns: { key: SortKey; label: string; align: 'left' | 'right' | 'center'; width?: string }[] = [
  { key: 'name', label: 'Pokemon', align: 'left' },
  { key: 'tier', label: 'Tier', align: 'center', width: 'w-12' },
  { key: 'kills', label: 'K', align: 'right', width: 'w-12' },
  { key: 'deaths', label: 'D', align: 'right', width: 'w-12' },
  { key: 'differential', label: '+/-', align: 'right', width: 'w-14' },
  { key: 'gp', label: 'GP', align: 'right', width: 'w-12' },
  { key: 'kpg', label: 'KPG', align: 'right', width: 'w-14' },
  { key: 'record', label: 'Record', align: 'right', width: 'w-20' },
];

function sortStats(stats: PokemonLeagueStat[], sort: SortState): PokemonLeagueStat[] {
  const mult = sort.dir === 'desc' ? -1 : 1;
  return [...stats].sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case 'name': cmp = a.name.localeCompare(b.name); break;
      case 'tier': cmp = a.tier - b.tier; break;
      case 'kills': cmp = a.kills - b.kills; break;
      case 'deaths': cmp = a.deaths - b.deaths; break;
      case 'differential': cmp = a.differential - b.differential; break;
      case 'gp': cmp = a.gp - b.gp; break;
      case 'kpg': cmp = a.kpg - b.kpg; break;
      case 'record': cmp = (a.record.wins - a.record.losses) - (b.record.wins - b.record.losses); break;
    }
    return cmp * mult;
  });
}

function filterStats(stats: PokemonLeagueStat[], filters: StatsFilters): PokemonLeagueStat[] {
  return stats.filter(s => {
    if (filters.search && !s.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.teamId && s.teamId !== filters.teamId) return false;
    if (filters.types.length > 0 && !filters.types.some(t => s.types.includes(t))) return false;
    if (s.tier < filters.tierMin || s.tier > filters.tierMax) return false;
    return true;
  });
}

export function StatsPage() {
  const { players, loading } = useLeagueData();
  const playerMap = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);
  const allStats = useMemo(() => computeLeagueStats(players), [players]);
  const [filters, setFilters] = useState<StatsFilters>(defaultFilters);
  const [sort, setSort] = useState<SortState>({ key: 'kills', dir: 'desc' });
  const { openSideCard } = usePokemonSideCard();

  const filtered = useMemo(() => filterStats(allStats, filters), [allStats, filters]);
  const sorted = useMemo(() => sortStats(filtered, sort), [filtered, sort]);

  const leagueUrl = useLeagueUrl();

  // Top 6 always by kills desc, unfiltered
  const top6 = useMemo(() =>
    [...allStats].sort((a, b) => b.kills - a.kills).slice(0, 6),
    [allStats],
  );

  useEffect(() => {
    preloadSprites(allStats.map(s => s.name));
  }, [allStats]);

  function handleSort(key: SortKey) {
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );
  }

  function handleFilterUpdate(partial: Partial<StatsFilters>) {
    setFilters(prev => ({ ...prev, ...partial }));
  }

  if (loading) return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-44 bg-surface-overlay/50 mb-2" />
        <Skeleton className="h-4 w-56 bg-surface-overlay/50" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="bg-surface-raised border-border-default overflow-hidden">
            <CardContent className="p-3 pt-3.5 flex flex-col items-center text-center gap-1.5">
              <Skeleton className="h-4 w-4 rounded bg-surface-overlay/50" />
              <Skeleton className="h-12 w-12 rounded bg-surface-overlay/50" />
              <Skeleton className="h-3.5 w-16 bg-surface-overlay/50" />
              <Skeleton className="h-3 w-10 bg-surface-overlay/50" />
            </CardContent>
          </Card>
        ))}
      </div>
      <StatsTableSkeleton rows={10} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-orange-400">Pokemon</span>
          <span className="text-text-primary ml-1">Stats</span>
        </h1>
        <p className="text-sm text-text-muted">
          League-wide performance &middot; Season 10
        </p>
      </div>

      {/* Top 6 MVPs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {top6.map((stat, i) => {
          const team = playerMap.get(stat.teamId);
          return (
            <Card
              key={`${stat.teamId}-${stat.name}`}
              className="bg-surface-raised border-border-default overflow-hidden group relative"
            >
              {/* Team color accent bar */}
              <div
                className="absolute inset-x-0 top-0 h-0.5"
                style={{ backgroundColor: team?.teamColor }}
              />
              <CardContent className="p-3 pt-3.5 flex flex-col items-center text-center gap-1.5">
                {/* Rank badge */}
                {i < 3 ? (
                  <span className={`rank-badge rank-badge-${i + 1} w-5 h-5 text-[9px]`}>
                    {i + 1}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold tabular-nums text-text-muted">
                    #{i + 1}
                  </span>
                )}
                {/* Sprite */}
                <button
                  onClick={() => openSideCard(stat.name)}
                  className="transition-transform duration-200 group-hover:scale-110"
                  title="View details"
                >
                  <PokemonSprite name={stat.name} size="md" />
                </button>
                {/* Name */}
                <Link
                  to={pokemonRoute(stat.name)}
                  className="text-xs font-medium text-text-primary hover:text-neon hover:underline transition-colors leading-tight truncate w-full text-center"
                >
                  {stat.name}
                </Link>
                {/* Team */}
                {team && (
                  <Link to={leagueUrl(`/teams/${team.id}`)} viewTransition className="flex items-center gap-1 group/team">
                    <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
                    <span className="text-[10px] text-text-muted group-hover/team:text-neon transition-colors">
                      {team.teamAbbrev}
                    </span>
                  </Link>
                )}
                {/* KD */}
                <KDDisplay kills={stat.kills} deaths={stat.deaths} className="text-xs" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <StatsFilterBar
        filters={filters}
        onUpdate={handleFilterUpdate}
        totalCount={allStats.length}
        filteredCount={filtered.length}
      />

      <Card className="bg-surface-raised border-border-default overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle">
                  {/* Rank */}
                  <th className="px-3 py-2 text-center w-10">
                    <span className="text-[11px] uppercase text-text-muted">#</span>
                  </th>
                  {/* Sprite */}
                  <th className="w-8" />
                  {/* Pokemon name + team (combined) */}
                  <th className="px-2 py-2 text-left">
                    <SortButton label="Pokemon" sortKey="name" current={sort} onClick={handleSort} align="left" />
                  </th>
                  {/* Type */}
                  <th className="px-2 py-2 text-left w-24">
                    <span className="text-[11px] uppercase text-text-muted">Type</span>
                  </th>
                  {/* Sortable columns */}
                  {columns.slice(1).map(col => (
                    <th key={col.key} className={cn('px-2 py-2', col.width, col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left')}>
                      <SortButton label={col.label} sortKey={col.key} current={sort} onClick={handleSort} align={col.align} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((stat, i) => {
                  const team = playerMap.get(stat.teamId);
                  return (
                    <tr
                      key={`${stat.teamId}-${stat.name}`}
                      className="stagger-item group border-b border-border-subtle/50 transition-all duration-150 hover:bg-surface-overlay/60"
                      style={{ ['--i' as never]: Math.min(i, 20) }}
                    >
                      {/* Rank */}
                      <td className="px-3 py-1.5 text-center">
                        {i < 3 ? (
                          <span className={`rank-badge rank-badge-${i + 1} w-5 h-5 text-[9px]`}>
                            {i + 1}
                          </span>
                        ) : (
                          <span className="text-xs font-bold tabular-nums text-text-muted">{i + 1}</span>
                        )}
                      </td>
                      {/* Sprite */}
                      <td className="py-1.5">
                        <button
                          onClick={() => openSideCard(stat.name)}
                          title="View details"
                        >
                          <PokemonSprite name={stat.name} size="xs" />
                        </button>
                      </td>
                      {/* Name + Team */}
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0">
                            <Link
                              to={pokemonRoute(stat.name)}
                              className="text-sm font-medium text-text-primary hover:text-neon hover:underline transition-colors truncate block text-left"
                            >
                              {stat.name}
                              {stat.isTeraCaptain && <span className="text-text-muted ml-1 text-[10px]">(T)</span>}
                            </Link>
                            {team && (
                              <Link
                                to={leagueUrl(`/teams/${team.id}`)} viewTransition
                                className="flex items-center gap-1 group/team"
                              >
                                <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
                                <span className="text-[10px] text-text-muted group-hover/team:text-neon transition-colors">
                                  {team.teamName}
                                </span>
                              </Link>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Type */}
                      <td className="px-2 py-1.5">
                        <TypeChip types={stat.types} size="xs" />
                      </td>
                      {/* Tier */}
                      <td className="px-2 py-1.5 text-center">
                        <TierBadge points={stat.tier} />
                      </td>
                      {/* Kills */}
                      <td className="px-2 py-1.5 text-right">
                        <span className="text-sm font-mono tabular-nums text-win">{stat.kills}</span>
                      </td>
                      {/* Deaths */}
                      <td className="px-2 py-1.5 text-right">
                        <span className="text-sm font-mono tabular-nums text-loss">{stat.deaths}</span>
                      </td>
                      {/* Differential */}
                      <td className="px-2 py-1.5 text-right">
                        <span className={cn(
                          'text-sm font-mono tabular-nums',
                          stat.differential > 0 ? 'text-win' : stat.differential < 0 ? 'text-loss' : 'text-text-muted',
                        )}>
                          {stat.differential > 0 ? '+' : ''}{stat.differential}
                        </span>
                      </td>
                      {/* GP */}
                      <td className="px-2 py-1.5 text-right">
                        <span className="text-sm font-mono tabular-nums text-text-secondary">{stat.gp}</span>
                      </td>
                      {/* KPG */}
                      <td className="px-2 py-1.5 text-right">
                        <span className="text-sm font-mono tabular-nums text-text-secondary">{stat.kpg.toFixed(2)}</span>
                      </td>
                      {/* Record */}
                      <td className="px-2 py-1.5 text-right">
                        <RecordDisplay
                          wins={stat.record.wins}
                          losses={stat.record.losses}
                          differential={stat.record.wins - stat.record.losses}
                          className="text-xs"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

function SortButton({
  label,
  sortKey,
  current,
  onClick,
  align,
}: {
  label: string;
  sortKey: SortKey;
  current: SortState;
  onClick: (key: SortKey) => void;
  align: 'left' | 'right' | 'center';
}) {
  const isActive = current.key === sortKey;
  return (
    <button
      onClick={() => onClick(sortKey)}
      className={cn(
        'flex items-center gap-0.5 text-[11px] uppercase transition-colors',
        isActive ? 'text-neon' : 'text-text-muted hover:text-text-secondary',
        align === 'right' && 'ml-auto',
        align === 'center' && 'mx-auto',
      )}
    >
      {label}
      {isActive ? (
        current.dir === 'desc' ? <ArrowDown size={10} /> : <ArrowUp size={10} />
      ) : (
        <ArrowUpDown size={10} className="opacity-40" />
      )}
    </button>
  );
}
