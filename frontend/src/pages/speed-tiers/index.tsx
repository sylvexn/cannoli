import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gauge, RotateCcw, Sparkles } from 'lucide-react';
import { api, type ApiSpeedTierRow } from '@/lib/api';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeagueUrl } from '@/lib/use-league-url';
import { pokemonRoute } from '@/lib/pokemon-route';
import { TYPE_COLORS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { PokemonSprite, preloadSprites } from '@/components/pokemon-sprite';
import { TeamLogo } from '@/components/team-logo';
import { TypeChip } from '@/components/type-chip';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import type { PokemonType } from '@/lib/pokemon';

import { computeRow, type CalcAssumptions } from './speed-calc';
import { SpeedFilterBar, type SpeedFilters } from './filter-bar';

const DEFAULT_ASSUMPTIONS: CalcAssumptions = {
  item: 'none',
  nature: 'neutral',
  applyWeatherAbility: true,
  unburden: false,
  quickFeet: false,
  weather: 'none',
  level: 100,
};

const DEFAULT_FILTERS: SpeedFilters = {
  search: '',
  teamId: '',
  trickRoom: false,
};

export function SpeedTiersPage() {
  const league = useLeague();
  const { players } = useLeagueData();
  const leagueUrl = useLeagueUrl();
  const { openSideCard } = usePokemonSideCard();

  const [rows, setRows] = useState<ApiSpeedTierRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<SpeedFilters>(DEFAULT_FILTERS);
  const [assumptions, setAssumptions] = useState<CalcAssumptions>(DEFAULT_ASSUMPTIONS);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getSpeedTiers(league.id)
      .then(data => { if (!cancelled) setRows(data); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [league.id]);

  useEffect(() => {
    if (rows) preloadSprites(rows.map(r => r.name));
  }, [rows]);

  // Teams list for the filter dropdown — pull from league-data so we always
  // get the canonical color/abbrev even if the speed-tier endpoint omits a
  // team that has no rostered mons (defensive).
  const teams = useMemo(
    () => players.map(p => ({
      id: p.id,
      teamAbbrev: p.teamAbbrev,
      teamName: p.teamName,
      teamColor: p.teamColor,
    })),
    [players],
  );

  const computed = useMemo(() => {
    if (!rows) return [];
    return rows.map(r => {
      const calc = computeRow(r.baseSpeed, r.abilities, assumptions);
      return { ...r, calc };
    });
  }, [rows, assumptions]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return computed.filter(r => {
      if (filters.teamId && r.owner?.teamId !== filters.teamId) return false;
      if (q) {
        const name = r.name.toLowerCase();
        const owner = r.owner ? `${r.owner.teamAbbrev} ${r.owner.teamName}`.toLowerCase() : '';
        if (!name.includes(q) && !owner.includes(q)) return false;
      }
      return true;
    });
  }, [computed, filters]);

  const sorted = useMemo(() => {
    const sortKey = (r: typeof filtered[number]) => r.calc.speed0;
    const dir = filters.trickRoom ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const cmp = sortKey(a) - sortKey(b);
      if (cmp !== 0) return cmp * dir;
      return a.name.localeCompare(b.name);
    });
  }, [filtered, filters.trickRoom]);

  // Tie groupings: rows that share an adjusted speed with at least one
  // neighbor get a subtle row tint so ties pop visually.
  const tieGroups = useMemo(() => {
    const counts = new Map<number, number>();
    for (const r of sorted) counts.set(r.calc.speed0, (counts.get(r.calc.speed0) ?? 0) + 1);
    return counts;
  }, [sorted]);

  const handleReset = () => {
    setAssumptions(DEFAULT_ASSUMPTIONS);
    setFilters(DEFAULT_FILTERS);
  };

  if (loading && !rows) return <SpeedTiersSkeleton />;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span style={{ color: league.color }}>SPEED</span>{' '}
            <span className="text-text-primary">TIERS</span>
          </h1>
          <p className="text-xs text-text-muted">
            <Gauge size={11} className="inline mr-1 -mt-0.5" />
            Every rostered Pokemon, sorted by adjusted speed under your assumptions.
            {filters.trickRoom && (
              <span className="ml-1 text-pink font-semibold">
                <RotateCcw size={11} className="inline -mt-0.5 mr-0.5" />
                Trick Room — slowest first
              </span>
            )}
          </p>
        </div>
      </div>

      <SpeedFilterBar
        filters={filters}
        onFiltersChange={partial => setFilters(prev => ({ ...prev, ...partial }))}
        assumptions={assumptions}
        onAssumptionsChange={partial => setAssumptions(prev => ({ ...prev, ...partial }))}
        teams={teams}
        totalCount={rows?.length ?? 0}
        filteredCount={sorted.length}
        onReset={handleReset}
      />

      <Card className="bg-surface-raised border-border-default overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-[5] bg-surface-raised">
                <tr className="border-b border-border-subtle">
                  <th className="px-2 py-1.5 text-center w-10 text-[10px] uppercase text-text-muted">#</th>
                  <th className="w-7" />
                  <th className="px-1 py-1.5 text-left text-[10px] uppercase text-text-muted">Pokemon</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted w-24">Type</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted w-32">Owner</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-muted w-14">Base</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted w-32">Ability</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-neon w-14">+0</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-muted w-14">+1</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-muted w-14">+2</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-muted w-16" title="Adjusted speed if a Choice Scarf were equipped at +0 stage">
                    Scarf
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center text-text-muted text-xs py-8">
                      {rows?.length === 0
                        ? 'No rostered Pokemon yet — speed tiers populate after the draft.'
                        : 'No Pokemon match the current filters.'}
                    </td>
                  </tr>
                ) : sorted.map((r, i) => {
                  const tied = (tieGroups.get(r.calc.speed0) ?? 0) > 1;
                  const types: PokemonType[] = [
                    r.type1?.toLowerCase() as PokemonType,
                    ...(r.type2 ? [r.type2.toLowerCase() as PokemonType] : []),
                  ].filter(Boolean) as PokemonType[];
                  const primaryColor = types[0] ? TYPE_COLORS[types[0]] : undefined;
                  return (
                    <tr
                      key={r.id}
                      className={cn(
                        'group border-b border-border-subtle/50 transition-colors hover:bg-surface-overlay/60',
                        tied && 'bg-neon/[0.04]',
                      )}
                    >
                      <td className="px-2 py-1 text-center">
                        <span className="text-[10px] font-mono tabular-nums text-text-muted">{i + 1}</span>
                      </td>
                      <td className="py-1">
                        <button onClick={() => openSideCard(r.name)} title="View details" className="block">
                          <PokemonSprite name={r.name} size="xs" />
                        </button>
                      </td>
                      <td className="px-1 py-1">
                        <Link
                          to={pokemonRoute(r.name)}
                          className="text-xs font-medium text-text-primary hover:text-neon hover:underline truncate block"
                        >
                          {r.name}
                          {r.isTeraCaptain && (
                            <Sparkles size={9} className="inline ml-1 -mt-0.5 text-yellow-400" />
                          )}
                        </Link>
                      </td>
                      <td className="px-2 py-1">
                        <TypeChip types={types} size="xs" />
                      </td>
                      <td className="px-2 py-1">
                        {r.owner ? (
                          <Link
                            to={leagueUrl(`/teams/${r.owner.teamId}`)}
                            viewTransition
                            className="inline-flex items-center gap-1.5 group/team min-w-0"
                          >
                            <TeamLogo
                              abbrev={r.owner.teamAbbrev}
                              color={r.owner.teamColor}
                              logoPath={r.owner.logoPath}
                              size="sm"
                            />
                            <span className="text-[10px] font-mono uppercase tabular-nums text-text-muted group-hover/team:text-neon transition-colors truncate">
                              {r.owner.teamAbbrev}
                            </span>
                          </Link>
                        ) : (
                          <span className="text-[10px] text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <span
                          className="text-xs font-mono tabular-nums"
                          style={{ color: primaryColor }}
                        >
                          {r.baseSpeed}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        {r.calc.activeAbility ? (
                          <span className="text-[10px] text-neon font-mono truncate block" title={`${r.calc.activeAbility} is active`}>
                            {r.calc.activeAbility}
                          </span>
                        ) : (
                          <span className="text-[10px] text-text-muted/70 font-mono truncate block">
                            {r.abilities.join(' / ') || '—'}
                          </span>
                        )}
                      </td>
                      {/* Stage cells — +0 is the headline (sort key) */}
                      <td className="px-2 py-1 text-right">
                        <span className={cn(
                          'text-sm font-mono tabular-nums font-semibold',
                          tied ? 'text-neon' : 'text-text-primary',
                        )}>
                          {r.calc.speed0}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <span className="text-xs font-mono tabular-nums text-text-secondary">
                          {r.calc.speed1}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <span className="text-xs font-mono tabular-nums text-text-secondary">
                          {r.calc.speed2}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <span className="text-xs font-mono tabular-nums text-purple-300">
                          {r.calc.scarfEquivalent}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Footer legend */}
      <div className="text-[10px] text-text-muted leading-relaxed px-1">
        Speed = floor((2 × base + 31 + 63) × lvl ÷ 100 + 5) × nature × item × ability,
        then × stage. Assumes 31 IVs, 252 EVs. Tied speeds are highlighted.
        Toggles update instantly — change weather/item/nature presets to see what
        flips the order. <span className="text-text-muted/70">"Scarf" column = same row at +0 with Choice Scarf forced.</span>
      </div>
    </div>
  );
}

function SpeedTiersSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-7 w-44 bg-surface-overlay/50" />
      <Skeleton className="h-20 w-full bg-surface-overlay/40" />
      <Card className="bg-surface-raised border-border-default">
        <CardContent className="p-3 space-y-1.5">
          {Array.from({ length: 14 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full bg-surface-overlay/40" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
