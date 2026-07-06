import { useState, useEffect, useMemo } from 'react';
import { api, type ApiFaRequest } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { toast } from 'sonner';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { LoadingSprite } from '@/components/loading-sprite';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, ArrowDown, UserPlus, X } from 'lucide-react';
import type { PokemonType } from '@/lib/pokemon';
import { useDebounced } from '@/lib/use-debounced';
import { tierName } from '@/lib/constants';
import { getErrorMessage } from '@/lib/errors';

interface FreeAgent {
  name: string;
  tier: number;
  type1: string;
  type2: string | null;
  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

interface TeamInfo {
  id: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  roster: { name: string; tier: number }[];
}

type SortOption = 'tier-desc' | 'tier-asc' | 'name-asc' | 'spe-desc' | 'bst-desc' | 'team';

const VISIBLE_LIMIT = 200;

export function AdminFreeAgents() {
  const { leagues } = useAppData();
  const [selectedLeague, setSelectedLeague] = useState<string>('');
  const [freeAgents, setFreeAgents] = useState<FreeAgent[]>([]);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 200);
  const [sortBy, setSortBy] = useState<SortOption>('tier-desc');
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(false);

  // Pickup form state
  const [pickupPokemon, setPickupPokemon] = useState<string | null>(null);
  const [pickupTeam, setPickupTeam] = useState('');
  const [dropPokemon, setDropPokemon] = useState('');

  // Pending FA approval queue (feedback #42)
  const [faReqs, setFaReqs] = useState<ApiFaRequest[]>([]);
  function fetchFaReqs(leagueId: string) {
    if (!leagueId) return;
    api.getFaRequests(leagueId)
      .then(setFaReqs)
      .catch(() => { /* non-fatal */ });
  }
  useEffect(() => { if (selectedLeague) fetchFaReqs(selectedLeague); }, [selectedLeague]);
  const pendingReqs = useMemo(() => faReqs.filter(r => r.status === 'pending'), [faReqs]);
  const teamName = (id: string) => teams.find(t => t.id === id)?.teamAbbrev ?? id;

  async function refreshAfterResolve() {
    fetchFaReqs(selectedLeague);
    const faRes = await api.getFreeAgents(selectedLeague);
    const fa = Array.isArray(faRes) ? faRes : (faRes as { freeAgents: FreeAgent[] }).freeAgents;
    setFreeAgents(fa as FreeAgent[]);
    const t = await api.getTeams(selectedLeague);
    setTeams(t.map(tm => ({ id: tm.id, teamName: tm.teamName, teamAbbrev: tm.teamAbbrev, teamColor: tm.teamColor, roster: tm.roster.map(r => ({ name: r.name, tier: r.tier })) })));
  }

  async function approveReq(id: number) {
    try {
      await api.approveFaRequest(id);
      toast.success('FA request approved');
      await refreshAfterResolve();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, 'Approve failed'));
    }
  }
  async function rejectReq(id: number) {
    const reason = window.prompt('Reason for rejection (optional):') ?? undefined;
    try {
      await api.rejectFaRequest(id, reason);
      toast.success('FA request rejected');
      await refreshAfterResolve();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, 'Reject failed'));
    }
  }

  // Auto-select first league
  useEffect(() => {
    if (leagues.length > 0 && !selectedLeague) {
      setSelectedLeague(leagues[0].id);
    }
  }, [leagues]);

  // Fetch free agents and teams when league changes
  useEffect(() => {
    if (!selectedLeague) return;
    setLoading(true);
    Promise.all([
      api.getFreeAgents(selectedLeague),
      api.getTeams(selectedLeague),
    ]).then(([faRes, t]) => {
      // getFreeAgents may return either a plain array (no teamId) or
      // { freeAgents, budget } (with teamId). Admin panel doesn't pass a teamId,
      // so it always gets the plain array — but guard for forward-compat.
      const fa = Array.isArray(faRes) ? faRes : (faRes as { freeAgents: FreeAgent[] }).freeAgents;
      setFreeAgents(fa as FreeAgent[]);
      setTeams(t.map(team => ({
        id: team.id,
        teamName: team.teamName,
        teamAbbrev: team.teamAbbrev,
        teamColor: team.teamColor,
        roster: team.roster.map(r => ({ name: r.name, tier: r.tier })),
      })));
    }).catch(() => {
      toast.error('Failed to load free agents');
    }).finally(() => setLoading(false));
  }, [selectedLeague]);

  // Reset show-all when filters change so a stale toggle doesn't dump 1000 rows
  // unexpectedly.
  useEffect(() => { setShowAll(false); }, [debouncedSearch, sortBy, selectedLeague]);

  const filtered = useMemo(() => {
    let list = freeAgents;

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.type1.toLowerCase().includes(q) ||
        (p.type2 && p.type2.toLowerCase().includes(q))
      );
    }

    // Sort
    const bst = (p: FreeAgent) => p.stats.hp + p.stats.atk + p.stats.def + p.stats.spa + p.stats.spd + p.stats.spe;
    switch (sortBy) {
      case 'tier-desc':
        list = [...list].sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
        break;
      case 'tier-asc':
        list = [...list].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
        break;
      case 'name-asc':
        list = [...list].sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'spe-desc':
        list = [...list].sort((a, b) => b.stats.spe - a.stats.spe || a.name.localeCompare(b.name));
        break;
      case 'bst-desc':
        list = [...list].sort((a, b) => bst(b) - bst(a) || a.name.localeCompare(b.name));
        break;
      case 'team':
        // Free agents are not on a team, so this sort just keeps tier ordering;
        // the rendering layer handles the team grouping below.
        list = [...list].sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
        break;
    }

    return list;
  }, [freeAgents, debouncedSearch, sortBy]);

  const visibleList = useMemo(
    () => (showAll ? filtered : filtered.slice(0, VISIBLE_LIMIT)),
    [filtered, showAll],
  );

  const selectedTeamRoster = useMemo(() => {
    if (!pickupTeam) return [];
    return teams.find(t => t.id === pickupTeam)?.roster ?? [];
  }, [pickupTeam, teams]);

  // When grouping by team, build a sectioned view: ungrouped FAs first (the
  // "true" pool), then a section per team showing what they would consider
  // available — currently always empty for FAs, but kept as a header so the
  // sort is informative and future "owned by" metadata can plug in here.
  const teamGroups = useMemo(() => {
    if (sortBy !== 'team') return null;
    return teams
      .slice()
      .sort((a, b) => a.teamName.localeCompare(b.teamName));
  }, [sortBy, teams]);

  async function handlePickup() {
    if (!pickupPokemon || !pickupTeam) return;
    try {
      await api.freeAgentPickup(selectedLeague, {
        teamId: pickupTeam,
        pickupNames: [pickupPokemon],
        dropNames: dropPokemon ? [dropPokemon] : [],
      });
      toast.success(`${pickupPokemon} picked up successfully`);
      setPickupPokemon(null);
      setPickupTeam('');
      setDropPokemon('');
      // Refresh
      const faRes = await api.getFreeAgents(selectedLeague);
      const fa = Array.isArray(faRes) ? faRes : (faRes as { freeAgents: FreeAgent[] }).freeAgents;
      setFreeAgents(fa as FreeAgent[]);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, 'Pickup failed'));
    }
  }

  return (
    <div className="space-y-3">
      {/* League selector */}
      <div className="flex items-center gap-2">
        {leagues.map(l => (
          <button
            key={l.id}
            onClick={() => setSelectedLeague(l.id)}
            className={`text-[10px] font-bold uppercase px-2 py-1 rounded transition-colors ${
              selectedLeague === l.id
                ? 'text-white'
                : 'text-text-muted hover:text-text-secondary'
            }`}
            style={selectedLeague === l.id ? { backgroundColor: l.color, color: '#fff' } : undefined}
          >
            {l.name.replace(' League', '')}
          </button>
        ))}
      </div>

      {/* Pending approval queue (feedback #42) */}
      {pendingReqs.length > 0 && (
        <div className="rounded-lg border border-draw/40 bg-draw/[0.04] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-draw/20 bg-draw/10">
            <UserPlus size={14} className="text-draw shrink-0" />
            <span className="text-xs font-heading font-semibold uppercase tracking-wider text-text-primary">
              Pending FA &amp; tera requests
            </span>
            <span className="text-[11px] px-1.5 py-0 rounded bg-draw/15 text-draw font-mono">
              {pendingReqs.length}
            </span>
          </div>
          <div className="divide-y divide-border-subtle">
            {pendingReqs.map(r => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-2">
                <span className="text-[11px] font-bold font-mono text-text-secondary shrink-0 w-12 truncate" title={teamName(r.teamId)}>
                  {teamName(r.teamId)}
                </span>
                {r.requestType === 'tera_change' ? (
                  <span className="flex-1 min-w-0 text-[11px] text-text-secondary truncate font-mono flex items-center gap-1.5">
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-pink/15 text-pink">
                      Tera
                    </span>
                    <span className="text-pink truncate">
                      {(r.teraChanges ?? []).length === 0
                        ? 'clear captains'
                        : (r.teraChanges ?? [])
                            .map(c => `${c.pokemonName}${c.teraTypes.length ? ` (${c.teraTypes.join('/')})` : ''}`)
                            .join(', ')}
                    </span>
                    {r.requestedBy && <span className="text-text-muted ml-1 shrink-0">· {r.requestedBy}</span>}
                  </span>
                ) : (
                  <span className="flex-1 min-w-0 text-[11px] text-text-secondary truncate font-mono">
                    <span className="text-win">+ {r.pickups.join(', ')}</span>
                    {r.drops.length > 0 && <span className="text-loss ml-2">− {r.drops.join(', ')}</span>}
                    {r.requestedBy && <span className="text-text-muted ml-2">· {r.requestedBy}</span>}
                  </span>
                )}
                <Button size="sm" className="h-6 px-2 text-[11px] bg-win/15 text-win hover:bg-win/25 border border-win/30" onClick={() => approveReq(r.id)}>
                  Approve
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-loss hover:bg-loss/10" onClick={() => rejectReq(r.id)}>
                  Reject
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search + Sort row */}
      <div className="flex items-center gap-2">
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
        <Select value={sortBy} onValueChange={v => setSortBy(v as SortOption)}>
          <SelectTrigger className="h-8 w-[170px] text-xs bg-surface border-border-subtle">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tier-desc" className="text-xs">Tier (high → low)</SelectItem>
            <SelectItem value="tier-asc" className="text-xs">Tier (low → high)</SelectItem>
            <SelectItem value="name-asc" className="text-xs">Name (A → Z)</SelectItem>
            <SelectItem value="spe-desc" className="text-xs">Speed (fast → slow)</SelectItem>
            <SelectItem value="bst-desc" className="text-xs">BST (high → low)</SelectItem>
            <SelectItem value="team" className="text-xs">Group by team</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Pickup dialog inline */}
      {pickupPokemon && (
        <div className="rounded-lg bg-neon/5 border border-neon/20 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <UserPlus size={14} className="text-neon" />
            <span className="text-xs font-semibold text-neon">Pick up {pickupPokemon}</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={pickupTeam}
              onChange={e => { setPickupTeam(e.target.value); setDropPokemon(''); }}
              className="flex-1 text-xs px-2 py-1.5 rounded bg-surface border border-border-subtle focus:border-neon/40 focus:outline-none"
            >
              <option value="">Select team...</option>
              {teams.map(t => (
                <option key={t.id} value={t.id}>{t.teamName} ({t.teamAbbrev})</option>
              ))}
            </select>
            {pickupTeam && (
              <select
                value={dropPokemon}
                onChange={e => setDropPokemon(e.target.value)}
                className="flex-1 text-xs px-2 py-1.5 rounded bg-surface border border-border-subtle focus:border-neon/40 focus:outline-none"
              >
                <option value="">No drop (optional)</option>
                {selectedTeamRoster.map(r => (
                  <option key={r.name} value={r.name}>{r.name} (T{r.tier})</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handlePickup} disabled={!pickupTeam} className="text-xs h-7">
              <ArrowDown size={12} className="mr-1" /> Confirm Pickup
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPickupPokemon(null)} className="text-xs h-7">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* FA list */}
      {loading ? (
        <LoadingSprite />
      ) : (
        <div className="space-y-0.5 max-h-[50vh] overflow-y-auto">
          {/* Header summary */}
          <div className="text-[10px] text-text-muted mb-1 flex items-center justify-between">
            {filtered.length > VISIBLE_LIMIT && !showAll ? (
              <span>
                Showing <span className="text-text-secondary font-semibold">{VISIBLE_LIMIT}</span> of{' '}
                <span className="text-text-secondary font-semibold">{filtered.length}</span> — refine search to see more
              </span>
            ) : (
              <span>{filtered.length} free agents available</span>
            )}
          </div>

          {/* Ungrouped (always shown) */}
          {visibleList.map(p => (
            <FreeAgentRow
              key={p.name}
              p={p}
              onPickup={() => setPickupPokemon(p.name)}
            />
          ))}

          {/* Show-all toggle */}
          {filtered.length > VISIBLE_LIMIT && (
            <div className="flex justify-center py-2">
              <Button
                size="sm"
                variant="outline"
                className="text-[10px] h-6"
                onClick={() => setShowAll(s => !s)}
              >
                {showAll
                  ? `Collapse to ${VISIBLE_LIMIT}`
                  : `Show all ${filtered.length}`}
              </Button>
            </div>
          )}

          {/* Owned-by-team grouping section (when sort = team) */}
          {teamGroups && teamGroups.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted px-1">
                By team
              </div>
              {teamGroups.map(t => (
                <div key={t.id} className="rounded border border-border-subtle">
                  <div
                    className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-2"
                    style={{ color: t.teamColor }}
                  >
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: t.teamColor }}
                    />
                    {t.teamName} <span className="text-text-muted/60">({t.teamAbbrev})</span>
                    <span className="ml-auto text-text-muted/60 font-mono">{t.roster.length} on roster</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FreeAgentRow({ p, onPickup }: { p: FreeAgent; onPickup: () => void }) {
  const bst = p.stats.hp + p.stats.atk + p.stats.def + p.stats.spa + p.stats.spd + p.stats.spe;
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-overlay/40 transition-colors">
      <PokemonSprite name={p.name} size="xs" className="shrink-0" />
      <span className="text-xs font-medium text-text-primary w-28 truncate">{p.name}</span>
      <div className="flex items-center gap-1 shrink-0">
        <TierBadge points={p.tier} />
        <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted/70">
          {tierName(p.tier)}
        </span>
      </div>
      <TypeChip
        types={[p.type1.toLowerCase() as PokemonType, ...(p.type2 ? [p.type2.toLowerCase() as PokemonType] : [])]}
        size="xs"
      />
      <span className="text-[10px] text-text-muted font-mono tabular-nums">{p.stats.spe} spe</span>
      <span className="text-[10px] text-text-muted/50 font-mono tabular-nums">{bst} bst</span>
      <button
        onClick={onPickup}
        className="opacity-60 hover:opacity-100 focus-visible:opacity-100 text-[10px] text-neon hover:text-neon/80 font-semibold transition-all ml-auto"
      >
        Pickup
      </button>
    </div>
  );
}
