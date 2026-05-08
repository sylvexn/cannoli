import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gauge, RotateCcw, Sparkles } from 'lucide-react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { api, type ApiSpeedTierRow, type ApiSpeedTierOwnership } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { pokemonRoute } from '@/lib/pokemon-route';
import { TYPE_COLORS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { PokemonSprite, preloadSprites } from '@/components/pokemon-sprite';
import { TeamLogo } from '@/components/team-logo';
import { TypeChip } from '@/components/type-chip';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import type { PokemonType } from '@/lib/pokemon';

import { withViewTransition } from '@/lib/view-transition';

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

// Estimated row height for the virtualizer. The actual row is ~28px (xs
// sprite + py-1), and react-virtual measures real rendered rows after
// mount, so this is just the initial guess.
const ROW_HEIGHT_PX = 32;

export function SpeedTiersPage() {
  const { leagues } = useAppData();
  const { openSideCard } = usePokemonSideCard();

  const [rows, setRows] = useState<ApiSpeedTierRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<SpeedFilters>(DEFAULT_FILTERS);
  const [assumptions, setAssumptions] = useState<CalcAssumptions>(DEFAULT_ASSUMPTIONS);

  // League highlight chips. Empty = no highlight applied (every row at full
  // opacity). Non-empty = rows whose ownerships intersect this set are
  // emphasized; others fade. Rows are NEVER removed by this filter — every
  // mon stays visible so the table also reads as a "what's available" board.
  const [highlightLeagueIds, setHighlightLeagueIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getGlobalSpeedTiers()
      .then(data => { if (!cancelled) setRows(data); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!rows) return;
    // Defer the bulk sprite preload to browser idle time so the initial
    // paint of the table isn't blocked by ~700 image fetch kickoffs. The
    // PokemonSprite cache dedupes any in-flight URLs so per-row mounts
    // still benefit from anything that already finished.
    const names = rows.map(r => r.name);
    const ric: typeof window.requestIdleCallback | undefined =
      typeof window !== 'undefined' ? window.requestIdleCallback : undefined;
    if (ric) {
      const handle = ric(() => preloadSprites(names), { timeout: 2000 });
      return () => {
        if (typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(handle);
        }
      };
    }
    const t = setTimeout(() => preloadSprites(names), 200);
    return () => clearTimeout(t);
  }, [rows]);

  // Teams list for the filter dropdown — derived from every ownership across
  // every row, so the dropdown spans all active leagues regardless of which
  // chips are highlighted.
  const teams = useMemo(() => {
    if (!rows) return [];
    const seen = new Map<string, { id: string; teamAbbrev: string; teamName: string; teamColor: string }>();
    for (const r of rows) {
      for (const o of r.ownerships) {
        if (!seen.has(o.teamId)) {
          seen.set(o.teamId, {
            id: o.teamId,
            teamAbbrev: o.teamAbbrev,
            teamName: o.teamName,
            teamColor: o.teamColor,
          });
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.teamAbbrev.localeCompare(b.teamAbbrev));
  }, [rows]);

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
      // Team filter still HIDES rows (it's a deliberate "show only this team's
      // mons" mode, not a highlight). Mons with no ownerships fail this check
      // when a team is selected.
      if (filters.teamId) {
        if (!r.ownerships.some(o => o.teamId === filters.teamId)) return false;
      }
      if (q) {
        const name = r.name.toLowerCase();
        // Match against any owner identity across leagues.
        const owners = r.ownerships
          .map(o => `${o.teamAbbrev} ${o.teamName} ${o.coachName}`.toLowerCase())
          .join(' ');
        if (!name.includes(q) && !owners.includes(q)) return false;
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
    setHighlightLeagueIds(new Set());
  };

  function toggleHighlightLeague(id: string) {
    setHighlightLeagueIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Virtualize the body rows — at ~700 mons across the dex, rendering every
  // <tr> on every filter change melted the page. We render only the rows in
  // the visible window plus a small overscan buffer, using window scroll so
  // the sticky filter bar above continues to behave naturally.
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useWindowVirtualizer({
    count: sorted.length,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 12,
    scrollMargin: tableContainerRef.current?.offsetTop ?? 0,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom = totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0);

  if (loading && !rows) return <SpeedTiersSkeleton />;

  const highlightActive = highlightLeagueIds.size > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span className="text-cyan-300">SPEED</span>{' '}
            <span className="text-text-primary">TIERS</span>
          </h1>
          <p className="text-xs text-text-muted">
            <Gauge size={11} className="inline mr-1 -mt-0.5" />
            Every Pokemon in the dex, sorted by adjusted speed under your assumptions.
            Gem chips show every league a mon is rostered in.
            {filters.trickRoom && (
              <span className="ml-1 text-pink font-semibold">
                <RotateCcw size={11} className="inline -mt-0.5 mr-0.5" />
                Trick Room — slowest first
              </span>
            )}
          </p>
        </div>

        {/* League highlight chips — multi-select. None active = no dimming.
            Active chips emphasize matching rows, dim the rest (every mon
            stays visible). */}
        {leagues.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {leagues.map(l => {
              const active = highlightLeagueIds.has(l.id);
              return (
                <button
                  key={l.id}
                  onClick={() => withViewTransition(() => toggleHighlightLeague(l.id))}
                  className={cn(
                    'px-2 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider border transition-all',
                    active ? 'opacity-100' : 'opacity-50 hover:opacity-90',
                  )}
                  style={{
                    color: l.color,
                    borderColor: `${l.color}${active ? '80' : '40'}`,
                    backgroundColor: active ? `${l.color}25` : 'transparent',
                  }}
                  title={active
                    ? `Stop highlighting ${l.name}`
                    : `Highlight Pokemon owned in ${l.name}`}
                >
                  {l.name.replace(' League', '')}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <SpeedFilterBar
        filters={filters}
        onFiltersChange={partial => {
          // Search/text changes should be instant; structural filter changes
          // (team, trick-room) cross-fade so reordered rows don't snap.
          const isTextOnly = Object.keys(partial).length === 1 && 'search' in partial;
          if (isTextOnly) {
            setFilters(prev => ({ ...prev, ...partial }));
          } else {
            withViewTransition(() => setFilters(prev => ({ ...prev, ...partial })));
          }
        }}
        assumptions={assumptions}
        onAssumptionsChange={partial => withViewTransition(() => setAssumptions(prev => ({ ...prev, ...partial })))}
        teams={teams}
        totalCount={rows?.length ?? 0}
        filteredCount={sorted.length}
        onReset={() => withViewTransition(handleReset)}
      />

      <Card className="bg-surface-raised border-border-default overflow-hidden">
        <CardContent className="p-0">
          <div ref={tableContainerRef} className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-[5] bg-surface-raised">
                <tr className="border-b border-border-subtle">
                  <th className="px-2 py-1.5 text-center w-10 text-[10px] uppercase text-text-muted">#</th>
                  <th className="w-7" />
                  <th className="px-1 py-1.5 text-left text-[10px] uppercase text-text-muted">Pokemon</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted w-24">Type</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted w-40">Owners</th>
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
                        ? 'No Pokemon in the dex yet.'
                        : 'No Pokemon match the current filters.'}
                    </td>
                  </tr>
                ) : (
                  <>
                    {paddingTop > 0 && (
                      <tr aria-hidden style={{ height: paddingTop }}>
                        <td colSpan={11} />
                      </tr>
                    )}
                    {virtualItems.map(virtualRow => {
                      const i = virtualRow.index;
                      const r = sorted[i];
                      if (!r) return null;
                      const tied = (tieGroups.get(r.calc.speed0) ?? 0) > 1;
                      const types: PokemonType[] = [
                        r.type1?.toLowerCase() as PokemonType,
                        ...(r.type2 ? [r.type2.toLowerCase() as PokemonType] : []),
                      ].filter(Boolean) as PokemonType[];
                      const primaryColor = types[0] ? TYPE_COLORS[types[0]] : undefined;
                      // Highlight = no chips active OR this row touches an active
                      // league. Rows that don't match get faded.
                      const matchesHighlight = !highlightActive
                        || r.ownerships.some(o => highlightLeagueIds.has(o.leagueId));
                      // Pick a representative nickname for the side-card title —
                      // first ownership wins, only ever shown in the tooltip.
                      const firstNickname = r.ownerships.find(o => !!o.nickname)?.nickname ?? null;
                      return (
                        <tr
                          key={r.id}
                          ref={virtualizer.measureElement}
                          data-index={i}
                          className={cn(
                            'group border-b border-border-subtle/50 transition-[background,opacity] hover:bg-surface-overlay/60',
                            tied && 'bg-neon/[0.04]',
                            !matchesHighlight && 'opacity-40 hover:opacity-60',
                          )}
                        >
                          <td className="px-2 py-1 text-center">
                            <span className="text-[10px] font-mono tabular-nums text-text-muted">{i + 1}</span>
                          </td>
                          <td className="py-1">
                            <button
                              onClick={() => openSideCard(r.name)}
                              title={firstNickname ? `${r.name} — "${firstNickname}"` : 'View details'}
                              className="block"
                            >
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
                            <OwnershipChips ownerships={r.ownerships} />
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
                    {paddingBottom > 0 && (
                      <tr aria-hidden style={{ height: paddingBottom }}>
                        <td colSpan={11} />
                      </tr>
                    )}
                  </>
                )}
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

/**
 * Inline cluster of league-colored gem chips — one per (league, team) the
 * mon is rostered on. Each chip uses `league.color` as its background so a
 * mon claimed by Sapphire reads sapphire-blue regardless of the team logo.
 * Hovering surfaces the team identity (logo + abbrev + coach) without
 * needing to leave the row.
 *
 * Empty array (free agent in every active league) renders a quiet em-dash so
 * the column doesn't visually collapse.
 */
function OwnershipChips({ ownerships }: { ownerships: ApiSpeedTierOwnership[] }) {
  if (ownerships.length === 0) {
    return <span className="text-[10px] text-text-muted/50">—</span>;
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {ownerships.map(o => (
        <Tooltip key={`${o.leagueId}:${o.teamId}`}>
          <TooltipTrigger
            render={
              <Link
                to={`/league/${o.leagueId}/teams/${o.teamId}`}
                viewTransition
                onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono font-bold uppercase tracking-wider transition-transform hover:scale-105"
                style={{
                  borderColor: `${o.leagueColor}80`,
                  backgroundColor: `${o.leagueColor}20`,
                  color: o.leagueColor,
                }}
                title={undefined}
              />
            }
          >
            {o.teamAbbrev}
            {o.isTeraCaptain && (
              <Sparkles size={8} className="-mt-0.5 text-yellow-300" aria-label="Tera captain" />
            )}
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="bg-surface-overlay border border-border-default text-text-primary"
          >
            <div className="flex items-center gap-2 py-0.5">
              <TeamLogo
                abbrev={o.teamAbbrev}
                color={o.teamColor}
                logoPath={o.logoPath}
                size="sm"
              />
              <div className="flex flex-col leading-tight">
                <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: o.leagueColor }}>
                  {o.leagueName.replace(' League', '')}
                </span>
                <span className="text-xs font-semibold">
                  {o.teamAbbrev} — {o.teamName}
                </span>
                <span className="text-[10px] text-text-muted">
                  {o.coachName}
                  {o.isTeraCaptain && <span className="ml-1 text-yellow-300">· Tera captain</span>}
                </span>
                {o.nickname && (
                  <span className="text-[10px] italic text-text-muted">"{o.nickname}"</span>
                )}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
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
