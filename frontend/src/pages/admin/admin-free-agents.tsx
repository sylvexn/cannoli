import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { toast } from 'sonner';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';

import { Button } from '@/components/ui/button';
import { Search, ArrowDown, UserPlus } from 'lucide-react';
import type { PokemonType } from '@/lib/pokemon';

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

export function AdminFreeAgents() {
  const { leagues } = useAppData();
  const [selectedLeague, setSelectedLeague] = useState<string>('');
  const [freeAgents, setFreeAgents] = useState<FreeAgent[]>([]);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // Pickup form state
  const [pickupPokemon, setPickupPokemon] = useState<string | null>(null);
  const [pickupTeam, setPickupTeam] = useState('');
  const [dropPokemon, setDropPokemon] = useState('');

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
    ]).then(([fa, t]) => {
      setFreeAgents(fa);
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

  const filtered = useMemo(() => {
    if (!search) return freeAgents;
    const q = search.toLowerCase();
    return freeAgents.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.type1.toLowerCase().includes(q) ||
      (p.type2 && p.type2.toLowerCase().includes(q))
    );
  }, [freeAgents, search]);

  const selectedTeamRoster = useMemo(() => {
    if (!pickupTeam) return [];
    return teams.find(t => t.id === pickupTeam)?.roster ?? [];
  }, [pickupTeam, teams]);

  async function handlePickup() {
    if (!pickupPokemon || !pickupTeam) return;
    try {
      await api.freeAgentPickup(selectedLeague, {
        teamId: pickupTeam,
        pokemonName: pickupPokemon,
        dropPokemonName: dropPokemon || undefined,
      });
      toast.success(`${pickupPokemon} picked up successfully`);
      setPickupPokemon(null);
      setPickupTeam('');
      setDropPokemon('');
      // Refresh
      const fa = await api.getFreeAgents(selectedLeague);
      setFreeAgents(fa);
    } catch (e: any) {
      toast.error(e.message || 'Pickup failed');
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

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search free agents..."
          className="w-full pl-8 pr-3 py-1.5 rounded-md bg-surface text-sm border border-border-subtle focus:border-neon/40 focus:outline-none"
        />
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
        <div className="text-center text-text-muted text-xs py-8">Loading...</div>
      ) : (
        <div className="space-y-0.5 max-h-[50vh] overflow-y-auto">
          <div className="text-[10px] text-text-muted mb-1">{filtered.length} free agents available</div>
          {filtered.slice(0, 100).map(p => (
            <div
              key={p.name}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-overlay/40 transition-colors group"
            >
              <PokemonSprite name={p.name} size="xs" className="shrink-0" />
              <span className="text-xs font-medium text-text-primary w-28 truncate">{p.name}</span>
              <TierBadge points={p.tier} />
              <TypeChip types={[p.type1.toLowerCase() as PokemonType, ...(p.type2 ? [p.type2.toLowerCase() as PokemonType] : [])]} size="xs" />
              <span className="text-[10px] text-text-muted font-mono ml-auto">{p.stats.spe} spe</span>
              <button
                onClick={() => setPickupPokemon(p.name)}
                className="opacity-0 group-hover:opacity-100 text-[10px] text-neon hover:text-neon/80 font-semibold transition-all"
              >
                Pickup
              </button>
            </div>
          ))}
          {filtered.length > 100 && (
            <div className="text-[10px] text-text-muted text-center py-2">
              Showing first 100 of {filtered.length} — use search to narrow
            </div>
          )}
        </div>
      )}
    </div>
  );
}
