import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { getEffectiveCost } from '@/data/tier-list';
import type { Player, RosterPokemon } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { Search, UserPlus, X, ArrowDown, AlertCircle, ShieldAlert, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { pokemonRoute } from '@/lib/pokemon-route';
import { withViewTransition } from '@/lib/view-transition';
import { BudgetBar, EmptyState } from './budget-bar';

interface FreeAgent {
  name: string;
  tier: number;
  type1: string;
  type2: string | null;
  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

type SortOption = 'tier-desc' | 'tier-asc' | 'name-asc' | 'spe-desc' | 'bst-desc';

function bst(s: FreeAgent['stats']) {
  return s.hp + s.atk + s.def + s.spa + s.spd + s.spe;
}

function teamPointsUsed(roster: RosterPokemon[]): number {
  return roster.reduce((sum, r) => sum + getEffectiveCost(r.name, r.isTeraCaptain), 0);
}

export function FreeAgentsPage() {
  const { user } = useAuth();
  const league = useLeague();
  const { players, refresh } = useLeagueData();
  const { openSideCard } = usePokemonSideCard();

  const phase = league.season.phase;
  const pointCap = league.season.pointCap;

  // The user's team in this league (if any)
  const myTeam: Player | undefined = useMemo(() => {
    if (!user) return undefined;
    return players.find(p => p.userId != null && String(p.userId) === user.id);
  }, [players, user]);

  // Free agents fetched from backend
  const [freeAgents, setFreeAgents] = useState<FreeAgent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (phase === 'predraft' || phase === 'draft') return;
    if (!myTeam) return;
    setLoading(true);
    api.getFreeAgents(league.id)
      .then(setFreeAgents)
      .catch(() => toast.error('Failed to load free agents'))
      .finally(() => setLoading(false));
  }, [league.id, phase, myTeam?.id]);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  // 0 sentinel = "unset" (the tier list goes 1–20, so 0 is safe as "no filter")
  const [tierMin, setTierMin] = useState<number>(0);
  const [tierMax, setTierMax] = useState<number>(0);
  const [sortBy, setSortBy] = useState<SortOption>('tier-desc');
  const [hideUnaffordable, setHideUnaffordable] = useState(false);

  // Pickup state
  const [selected, setSelected] = useState<FreeAgent | null>(null);
  const [dropTarget, setDropTarget] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const pointsUsed = myTeam ? teamPointsUsed(myTeam.roster) : 0;
  const remaining = pointCap - pointsUsed;

  // After picking, what would the new total be? (assuming optional drop)
  const projectedAfter = useMemo(() => {
    if (!selected || !myTeam) return pointsUsed;
    const dropCost = dropTarget
      ? getEffectiveCost(dropTarget, !!myTeam.roster.find(r => r.name === dropTarget)?.isTeraCaptain)
      : 0;
    return pointsUsed - dropCost + selected.tier;
  }, [selected, dropTarget, pointsUsed, myTeam]);

  const mustDrop = !!selected && projectedAfter > pointCap && !dropTarget;
  const canSubmit =
    !!selected &&
    !submitting &&
    projectedAfter <= pointCap;

  // Reset drop target when selection changes
  useEffect(() => {
    setDropTarget('');
  }, [selected?.name]);

  const filtered = useMemo(() => {
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
      // If the team is full and would need to drop, "affordable" means
      // there exists at least one drop candidate making it fit.
      // Simpler heuristic: tier <= remaining + maxDropCost.
      const maxDrop = myTeam.roster.reduce(
        (m, r) => Math.max(m, getEffectiveCost(r.name, r.isTeraCaptain)),
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
  }, [freeAgents, search, typeFilter, tierMin, tierMax, hideUnaffordable, sortBy, remaining, myTeam]);

  async function handlePickup() {
    if (!selected || !myTeam) return;
    setSubmitting(true);
    try {
      await api.freeAgentPickup(league.id, {
        teamId: myTeam.id,
        pokemonName: selected.name,
        dropPokemonName: dropTarget || undefined,
      });
      toast.success(
        dropTarget
          ? `Picked up ${selected.name}, dropped ${dropTarget}`
          : `Picked up ${selected.name}`,
      );
      // Optimistically remove from list & clear selection
      setFreeAgents(prev => prev.filter(p => p.name !== selected.name));
      setSelected(null);
      setDropTarget('');
      // Refresh teams (so the right pane updates with the new roster)
      await refresh();
      // Refetch FA list (in case backend has computed new state)
      api.getFreeAgents(league.id).then(setFreeAgents).catch(() => {});
    } catch (e: any) {
      toast.error(e?.message || 'Pickup failed');
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
    return (
      <EmptyState
        icon={<AlertCircle className="text-text-muted" size={28} />}
        title="Not a manager in this league"
        message={`You must be the manager of a team in ${league.name} to pick up free agents.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Page title */}
      <div className="flex items-baseline justify-between">
        <h1 className="text-base font-mono uppercase tracking-wider">
          <span style={{ color: league.color }}>FREE</span>{' '}
          <span className="text-text-primary">AGENTS</span>
        </h1>
        <span className="text-[10px] text-text-muted">
          {league.name} · Week {league.season.currentWeek}
        </span>
      </div>

      {/* Budget bar */}
      <BudgetBar
        used={pointsUsed}
        cap={pointCap}
        projected={selected ? projectedAfter : null}
        teamColor={myTeam.teamColor}
        teamName={myTeam.teamName}
      />

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
                    const isSelected = selected?.name === p.name;
                    return (
                      <li
                        key={p.name}
                        className={cn(
                          'stagger-item row-interactive flex items-center gap-2 px-2 py-1 rounded transition-colors group',
                          isSelected
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
                        {overBudget && (
                          <span className="text-[10px] text-loss font-semibold flex items-center gap-1">
                            <AlertCircle size={10} /> needs drop
                          </span>
                        )}
                        <button
                          onClick={() => setSelected(p)}
                          className={cn(
                            'ml-auto text-[10px] font-semibold transition-all px-2 py-0.5 rounded',
                            isSelected
                              ? 'text-neon bg-neon/10'
                              : 'text-neon/70 hover:text-neon hover:bg-neon/10 opacity-0 group-hover:opacity-100',
                          )}
                        >
                          {isSelected ? 'Selected' : 'Pickup'}
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

        {/* ─── Right pane: My roster + pickup form ──────────────────── */}
        <div className="flex flex-col gap-3 min-h-0">
          {/* Pickup form */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <UserPlus size={14} className="text-neon" />
                Confirm Pickup
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selected ? (
                <div className="text-xs text-text-muted py-3 text-center">
                  Choose a Pokemon from the list to add it to {myTeam.teamAbbrev}.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Selected pokemon */}
                  <div className="flex items-center gap-2 p-2 rounded-md bg-neon/5 border border-neon/20">
                    <PokemonSprite name={selected.name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <Link to={pokemonRoute(selected.name)} className="text-sm font-semibold text-text-primary truncate hover:text-neon hover:underline transition-colors block">{selected.name}</Link>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <TierBadge points={selected.tier} />
                        <TypeChip
                          types={[selected.type1.toLowerCase() as PokemonType, ...(selected.type2 ? [selected.type2.toLowerCase() as PokemonType] : [])]}
                          size="xs"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => setSelected(null)}
                      className="text-text-muted hover:text-text-primary"
                      aria-label="Clear selection"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {/* Drop target selector */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1 flex items-center gap-1">
                      <span>Drop (optional)</span>
                      {mustDrop && (
                        <span className="text-loss font-semibold">— required, over cap</span>
                      )}
                    </div>
                    <select
                      value={dropTarget}
                      onChange={e => setDropTarget(e.target.value)}
                      className={cn(
                        'w-full text-xs px-2 py-1.5 rounded bg-surface border focus:outline-none',
                        mustDrop ? 'border-loss/60 focus:border-loss' : 'border-border-subtle focus:border-neon/40',
                      )}
                    >
                      <option value="">— No drop —</option>
                      {[...myTeam.roster]
                        .sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name))
                        .map(r => (
                          <option key={r.name} value={r.name}>
                            {r.isTeraCaptain ? '★ ' : ''}{r.name} (T{getEffectiveCost(r.name, r.isTeraCaptain)})
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Confirm */}
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handlePickup}
                      disabled={!canSubmit}
                      className="flex-1 h-8 text-xs"
                    >
                      <ArrowDown size={12} className="mr-1" />
                      {submitting ? 'Picking up...' : 'Confirm Pickup'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setSelected(null)}
                      className="h-8 text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                  <div className="text-[10px] text-text-muted text-center">
                    {projectedAfter} / {pointCap} after pickup
                    {projectedAfter > pointCap && (
                      <span className="text-loss font-semibold"> — over by {projectedAfter - pointCap}</span>
                    )}
                  </div>
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
              <ul className="space-y-0.5">
                {[...myTeam.roster]
                  .sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name))
                  .map(r => {
                    const cost = getEffectiveCost(r.name, r.isTeraCaptain);
                    const isDrop = dropTarget === r.name;
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
                        <Link
                          to={pokemonRoute(r.name)}
                          className="text-xs text-text-primary truncate flex-1 text-left hover:text-neon hover:underline transition-colors"
                        >
                          {r.name}
                          {r.isTeraCaptain && <Star size={9} className="inline ml-1 text-yellow-400 fill-yellow-400" />}
                        </Link>
                        <TierBadge points={cost} />
                        {selected && (
                          <button
                            onClick={() => setDropTarget(prev => (prev === r.name ? '' : r.name))}
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

