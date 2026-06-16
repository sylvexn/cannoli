import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { useMarket } from '@/pages/market';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { getEffectiveCost, DEFAULT_FORMAT, type CostFormat } from '@/data/tier-list';
import type { RosterPokemon } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { Search, UserPlus, X, ArrowDown, AlertCircle, ShieldAlert, Star, Plus, Minus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { pokemonRoute } from '@/lib/pokemon-route';
import { withViewTransition } from '@/lib/view-transition';
import { EmptyState } from './budget-bar';
import { NotAManagerRedirect } from './not-a-manager-redirect';
import { getErrorMessage } from '@/lib/errors';

interface FreeAgent {
  name: string;
  tier: number;
  type1: string;
  type2: string | null;
  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

interface FaBudget {
  faUsed: number;
  faRemaining: number;
  faPerSeason: number;
}

type SortOption = 'tier-desc' | 'tier-asc' | 'name-asc' | 'spe-desc' | 'bst-desc';

function bst(s: FreeAgent['stats']) {
  return s.hp + s.atk + s.def + s.spa + s.spd + s.spe;
}

function teamPointsUsed(roster: RosterPokemon[], format?: CostFormat): number {
  return roster.reduce((sum, r) => sum + getEffectiveCost(r.name, r.isTeraCaptain, format), 0);
}

export function FreeAgentsPage() {
  const { user } = useAuth();
  const league = useLeague();
  const { refresh } = useLeagueData();
  const { openSideCard } = usePokemonSideCard();
  const { actingTeam: myTeam } = useMarket();

  const phase = league.season.phase;
  const pointCap = league.season.pointCap;
  const costFormat = league.costFormat ?? DEFAULT_FORMAT;

  // Free agents + optional FA budget
  const [freeAgents, setFreeAgents] = useState<FreeAgent[]>([]);
  const [faBudget, setFaBudget] = useState<FaBudget | null>(null);
  const [loading, setLoading] = useState(false);

  function fetchFreeAgents() {
    if (phase === 'predraft' || phase === 'draft' || !myTeam) return;
    setLoading(true);
    api.getFreeAgents(league.id, myTeam.id)
      .then(res => {
        if (Array.isArray(res)) {
          setFreeAgents(res as FreeAgent[]);
          setFaBudget(null);
        } else {
          setFreeAgents((res as { freeAgents: FreeAgent[]; budget: FaBudget }).freeAgents);
          setFaBudget((res as { freeAgents: FreeAgent[]; budget: FaBudget }).budget);
        }
      })
      .catch(() => toast.error('Failed to load free agents'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchFreeAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league.id, phase, myTeam?.id]);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [tierMin, setTierMin] = useState<number>(0);
  const [tierMax, setTierMax] = useState<number>(0);
  const [sortBy, setSortBy] = useState<SortOption>('tier-desc');
  const [hideUnaffordable, setHideUnaffordable] = useState(false);

  // Multi-pickup state
  const [pendingPickups, setPendingPickups] = useState<FreeAgent[]>([]);
  const [pendingDrops, setPendingDrops] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Reset when team changes
  useEffect(() => {
    setPendingPickups([]);
    setPendingDrops(new Set());
  }, [myTeam?.id]);

  const pointsUsed = myTeam ? teamPointsUsed(myTeam.roster, costFormat) : 0;

  // Projected point total after pending pickups + drops
  const projectedAfter = useMemo(() => {
    if (!myTeam) return pointsUsed;
    const dropCost = [...pendingDrops].reduce((sum, name) => {
      const r = myTeam.roster.find(r => r.name === name);
      return sum + getEffectiveCost(name, !!r?.isTeraCaptain, costFormat);
    }, 0);
    const pickupCost = pendingPickups.reduce((sum, fa) => sum + fa.tier, 0);
    return pointsUsed - dropCost + pickupCost;
  }, [pendingPickups, pendingDrops, pointsUsed, myTeam, costFormat]);

  // Projected roster size after pending transaction
  const projectedRosterSize = useMemo(() => {
    if (!myTeam) return 0;
    return myTeam.roster.length - pendingDrops.size + pendingPickups.length;
  }, [myTeam, pendingPickups, pendingDrops]);

  const rosterSize = league.season.rosterSize;
  const overCap = projectedAfter > pointCap;
  const overRoster = projectedRosterSize > rosterSize;
  const faRemaining = faBudget?.faRemaining ?? null;
  const overFaBudget = faRemaining !== null && pendingPickups.length > faRemaining;

  const canSubmit =
    pendingPickups.length > 0 &&
    !submitting &&
    !overCap &&
    !overRoster &&
    !overFaBudget;

  function togglePickup(fa: FreeAgent) {
    setPendingPickups(prev => {
      const exists = prev.some(p => p.name === fa.name);
      if (exists) return prev.filter(p => p.name !== fa.name);
      return [...prev, fa];
    });
  }

  function toggleDrop(name: string) {
    setPendingDrops(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handlePickup() {
    if (!myTeam || pendingPickups.length === 0) return;
    setSubmitting(true);
    try {
      const result = await api.freeAgentPickup(league.id, {
        teamId: myTeam.id,
        pickupNames: pendingPickups.map(p => p.name),
        dropNames: [...pendingDrops],
      });
      const pickupStr = pendingPickups.map(p => p.name).join(', ');
      const dropStr = pendingDrops.size > 0 ? `, dropped ${[...pendingDrops].join(', ')}` : '';
      toast.success(`Picked up ${pickupStr}${dropStr}`);

      // Update FA budget from response
      if ('faRemaining' in result) {
        setFaBudget({
          faUsed: result.faUsed,
          faRemaining: result.faRemaining,
          faPerSeason: result.faPerSeason,
        });
      }

      // Optimistically remove pickups from FA list + clear selections
      const pickedNames = new Set(pendingPickups.map(p => p.name));
      setFreeAgents(prev => prev.filter(p => !pickedNames.has(p.name)));
      setPendingPickups([]);
      setPendingDrops(new Set());

      // Refresh roster data
      await refresh();
      fetchFreeAgents();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, 'Pickup failed'));
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Empty states ──────────────────────────────────────────────────

  if (phase === 'predraft' || phase === 'draft') {
    return (
      <EmptyState
        icon={<ShieldAlert className="text-text-muted" size={28} />}
        title="Free agency is closed"
        message={`Free agents become available once ${league.name} enters the regular season. The current phase is "${phase}".`}
      />
    );
  }

  if (!user) {
    return (
      <EmptyState
        icon={<AlertCircle className="text-text-muted" size={28} />}
        title="Login required"
        message="Sign in to manage your team's free-agent pickups."
      />
    );
  }

  if (!myTeam) {
    return <NotAManagerRedirect currentLeagueId={league.id} currentLeagueName={league.name} />;
  }

  const filtered = (() => {
    let list = freeAgents;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          p.type1.toLowerCase().includes(q) ||
          (p.type2 && p.type2.toLowerCase().includes(q)),
      );
    }
    if (typeFilter !== 'all') {
      list = list.filter(p =>
        p.type1.toLowerCase() === typeFilter ||
        (p.type2 && p.type2.toLowerCase() === typeFilter),
      );
    }
    if (tierMin > 0) list = list.filter(p => p.tier >= tierMin);
    if (tierMax > 0) list = list.filter(p => p.tier <= tierMax);

    if (hideUnaffordable && myTeam) {
      const remaining = pointCap - pointsUsed;
      const maxDrop = myTeam.roster.reduce(
        (m, r) => Math.max(m, getEffectiveCost(r.name, r.isTeraCaptain, costFormat)),
        0,
      );
      list = list.filter(p => p.tier <= remaining + maxDrop);
    }

    const cmp = (a: FreeAgent, b: FreeAgent) => {
      switch (sortBy) {
        case 'tier-desc': return b.tier - a.tier || a.name.localeCompare(b.name);
        case 'tier-asc': return a.tier - b.tier || a.name.localeCompare(b.name);
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'spe-desc': return b.stats.spe - a.stats.spe || a.name.localeCompare(b.name);
        case 'bst-desc': return bst(b.stats) - bst(a.stats) || a.name.localeCompare(b.name);
      }
    };
    return [...list].sort(cmp);
  })();

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-3 flex-1 min-h-0">
        {/* ─── FA list (left) ───────────────────────────────────────── */}
        <Card className="flex flex-col min-h-0">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Available Free Agents</CardTitle>
              <span className="text-[10px] text-text-muted font-mono">
                {filtered.length} / {freeAgents.length}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 flex-1 min-h-0 flex flex-col">
            {/* Filters */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name or type..."
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
              <Select value={sortBy} onValueChange={v => withViewTransition(() => setSortBy(v as SortOption))}>
                <SelectTrigger className="h-8 w-[150px] text-xs bg-surface border-border-subtle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tier-desc" className="text-xs">Tier (high → low)</SelectItem>
                  <SelectItem value="tier-asc" className="text-xs">Tier (low → high)</SelectItem>
                  <SelectItem value="name-asc" className="text-xs">Name (A → Z)</SelectItem>
                  <SelectItem value="spe-desc" className="text-xs">Speed (fast → slow)</SelectItem>
                  <SelectItem value="bst-desc" className="text-xs">BST (high → low)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Select value={typeFilter} onValueChange={v => setTypeFilter(v ?? 'all')}>
                <SelectTrigger className="h-7 w-[120px] text-xs bg-surface border-border-subtle">
                  <SelectValue placeholder="Any type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Any type</SelectItem>
                  {['normal','fire','water','electric','grass','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'].map(t => (
                    <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1 text-[11px] text-text-muted">
                <span>Tier</span>
                <NumberInput
                  value={tierMin}
                  onChange={setTierMin}
                  min={0}
                  max={20}
                  className="w-20"
                  placeholder="min"
                />
                <span>–</span>
                <NumberInput
                  value={tierMax}
                  onChange={setTierMax}
                  min={0}
                  max={20}
                  className="w-20"
                  placeholder="max"
                />
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideUnaffordable}
                  onChange={e => setHideUnaffordable(e.target.checked)}
                  className="accent-neon"
                />
                Hide unaffordable
              </label>
            </div>

            {/* List */}
            <div className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2">
              {loading ? (
                <div className="text-center text-text-muted text-xs py-8">Loading free agents...</div>
              ) : filtered.length === 0 ? (
                <div className="text-center text-text-muted text-xs py-8">No free agents match these filters.</div>
              ) : (
                <ul className="space-y-0.5">
                  {filtered.slice(0, 250).map((p, i) => {
                    const projectedIfPicked = pointsUsed + p.tier;
                    const overBudget = projectedIfPicked > pointCap;
                    const isPending = pendingPickups.some(pk => pk.name === p.name);
                    return (
                      <li
                        key={p.name}
                        className={cn(
                          'stagger-item row-interactive flex items-center gap-2 px-2 py-1 rounded transition-colors group',
                          isPending
                            ? 'bg-neon/10 ring-1 ring-neon/40'
                            : 'hover:bg-surface-overlay/40',
                        )}
                        style={{ ['--i' as never]: Math.min(i, 20) }}
                      >
                        <button
                          onClick={() => openSideCard(p.name)}
                          className="shrink-0"
                          title="View details"
                        >
                          <PokemonSprite name={p.name} size="xs" />
                        </button>
                        <Link
                          to={pokemonRoute(p.name)}
                          className="text-xs font-medium text-text-primary w-32 truncate text-left hover:text-neon hover:underline transition-colors"
                        >
                          {p.name}
                        </Link>
                        <TierBadge points={p.tier} />
                        <TypeChip
                          types={[p.type1.toLowerCase() as PokemonType, ...(p.type2 ? [p.type2.toLowerCase() as PokemonType] : [])]}
                          size="xs"
                        />
                        <span className="text-[10px] text-text-muted font-mono tabular-nums">{p.stats.spe} spe</span>
                        <span className="text-[10px] text-text-muted/50 font-mono tabular-nums">{bst(p.stats)} bst</span>
                        {overBudget && !isPending && (
                          <span className="text-[10px] text-loss font-semibold flex items-center gap-1">
                            <AlertCircle size={10} /> needs drop
                          </span>
                        )}
                        <button
                          onClick={() => togglePickup(p)}
                          className={cn(
                            'ml-auto text-[10px] font-semibold transition-all px-2 py-0.5 rounded flex items-center gap-1',
                            isPending
                              ? 'text-neon bg-neon/10'
                              : 'text-neon/70 hover:text-neon hover:bg-neon/10 opacity-0 group-hover:opacity-100',
                          )}
                        >
                          {isPending ? <><Minus size={9} /> Remove</> : <><Plus size={9} /> Add</>}
                        </button>
                      </li>
                    );
                  })}
                  {filtered.length > 250 && (
                    <li className="text-[10px] text-text-muted text-center py-2">
                      Showing first 250 — narrow filters to see more.
                    </li>
                  )}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ─── Right pane: Confirm pickup + my roster ────────────────── */}
        <div className="flex flex-col gap-3 min-h-0">
          {/* Pickup form */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <UserPlus size={14} className="text-neon" />
                Confirm Pickup
                {pendingPickups.length > 0 && (
                  <span className="ml-auto text-[11px] font-mono text-neon bg-neon/10 px-1.5 py-0.5 rounded">
                    {pendingPickups.length} queued
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* FA budget readout */}
              {faBudget && (
                <div className={cn(
                  'flex items-center justify-between text-[11px] font-mono mb-3 px-2 py-1.5 rounded border',
                  overFaBudget
                    ? 'border-loss/40 bg-loss/10 text-loss'
                    : faBudget.faRemaining === 0
                    ? 'border-draw/40 bg-draw/10 text-draw'
                    : 'border-border-subtle bg-surface-overlay/20 text-text-muted',
                )}>
                  <span>FA pickups</span>
                  <span className="font-semibold">
                    {faBudget.faUsed + pendingPickups.length} / {faBudget.faPerSeason}
                    {faBudget.faRemaining - pendingPickups.length !== faBudget.faRemaining - 0 && (
                      <span className="text-text-muted ml-1">({Math.max(0, faBudget.faRemaining - pendingPickups.length)} left)</span>
                    )}
                    {faBudget.faRemaining > 0 && pendingPickups.length === 0 && (
                      <span className="text-text-muted ml-1">({faBudget.faRemaining} left)</span>
                    )}
                  </span>
                </div>
              )}

              {pendingPickups.length === 0 ? (
                <div className="text-xs text-text-muted py-3 text-center">
                  Click "+ Add" on any Pokemon to queue them for pickup.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Queued pickups */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                      Picking up ({pendingPickups.length})
                    </div>
                    <div className="space-y-1">
                      {pendingPickups.map(fa => (
                        <div key={fa.name} className="flex items-center gap-2 p-1.5 rounded-md bg-neon/5 border border-neon/20">
                          <PokemonSprite name={fa.name} size="xs" />
                          <Link to={pokemonRoute(fa.name)} className="text-xs font-semibold text-text-primary flex-1 truncate hover:text-neon hover:underline transition-colors">{fa.name}</Link>
                          <TierBadge points={fa.tier} />
                          <button
                            onClick={() => togglePickup(fa)}
                            className="text-text-muted hover:text-loss"
                            aria-label={`Remove ${fa.name}`}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Point cap + roster size summary */}
                  <div className="flex items-center justify-between text-[10px] font-mono text-text-muted">
                    <span>Points after</span>
                    <span className={cn('font-semibold', overCap ? 'text-loss' : 'text-text-primary')}>
                      {projectedAfter} / {pointCap}
                      {overCap && <span className="text-loss ml-1">over by {projectedAfter - pointCap}</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-text-muted">
                    <span>Roster after</span>
                    <span className={cn('font-semibold', overRoster ? 'text-loss' : 'text-text-primary')}>
                      {projectedRosterSize} / {rosterSize}
                      {overRoster && <span className="text-loss ml-1">— drop {projectedRosterSize - rosterSize} more</span>}
                    </span>
                  </div>

                  {overFaBudget && (
                    <div className="text-[10px] text-loss font-semibold">
                      Only {faRemaining} FA pickup{faRemaining === 1 ? '' : 's'} remaining this season.
                    </div>
                  )}

                  {/* Confirm */}
                  <Button
                    onClick={handlePickup}
                    disabled={!canSubmit}
                    className="w-full h-8 text-xs"
                  >
                    <ArrowDown size={12} className="mr-1" />
                    {submitting
                      ? 'Processing...'
                      : `Confirm ${pendingPickups.length} Pickup${pendingPickups.length !== 1 ? 's' : ''}${pendingDrops.size > 0 ? ` + ${pendingDrops.size} Drop${pendingDrops.size !== 1 ? 's' : ''}` : ''}`}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => { setPendingPickups([]); setPendingDrops(new Set()); }}
                    className="w-full h-7 text-xs"
                  >
                    Clear all
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* My roster */}
          <Card className="flex-1 min-h-0 flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: myTeam.teamColor }}
                />
                {myTeam.teamName}
                <span className="text-[10px] text-text-muted ml-auto font-mono">
                  {myTeam.roster.length} Pokemon
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-y-auto">
              {pendingPickups.length > 0 && (
                <div className="text-[10px] text-text-muted mb-2 pb-2 border-b border-border-subtle">
                  Click "Drop" to remove a Pokemon to make room. Drops are free and don't use your FA budget.
                </div>
              )}
              <ul className="space-y-0.5">
                {[...myTeam.roster]
                  .sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name))
                  .map(r => {
                    const cost = getEffectiveCost(r.name, r.isTeraCaptain, costFormat);
                    const isDrop = pendingDrops.has(r.name);
                    return (
                      <li
                        key={r.name}
                        className={cn(
                          'flex items-center gap-2 px-2 py-1 rounded transition-colors',
                          isDrop && 'bg-loss/10 ring-1 ring-loss/40',
                        )}
                      >
                        <button
                          onClick={() => openSideCard(r.name)}
                          className="shrink-0"
                          title="View details"
                        >
                          <PokemonSprite name={r.name} size="xs" />
                        </button>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <Link
                            to={pokemonRoute(r.name)}
                            className="text-xs text-text-primary truncate text-left hover:text-neon hover:underline transition-colors"
                          >
                            {r.name}
                            {r.isTeraCaptain && <Star size={9} className="inline ml-1 text-yellow-400 fill-yellow-400" />}
                          </Link>
                          {r.nickname ? (
                            <span className="italic text-text-muted text-[10px] truncate leading-tight" title={r.nickname}>
                              "{r.nickname}"
                            </span>
                          ) : null}
                        </div>
                        <TierBadge points={cost} />
                        {pendingPickups.length > 0 && (
                          <button
                            onClick={() => toggleDrop(r.name)}
                            className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded font-semibold transition-colors',
                              isDrop
                                ? 'bg-loss/20 text-loss'
                                : 'text-text-muted hover:bg-loss/10 hover:text-loss',
                            )}
                          >
                            {isDrop ? 'Dropping' : 'Drop'}
                          </button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

