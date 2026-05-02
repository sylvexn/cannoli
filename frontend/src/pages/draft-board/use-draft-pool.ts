import { useMemo } from 'react';
import { TIER_LIST } from '@/data/tier-list';
import { getPokemonData } from '@/data/pokemon-data';
import type { Player, RosterPokemon } from '@/lib/types';
import type { DraftState, PoolOwnership } from './types';

/**
 * Builds the canonical ownership map (drafted + traded), the filtered/sorted
 * Pokemon pool, and per-tier groupings used by the grid view.
 *
 * Also exposes `rosterLookup` / `playerLookup` since they're cheap by-products
 * of `players` and several consumers (popovers, sidebars) want them too.
 */
export function useDraftPool(state: DraftState, players: Player[]) {
  const rosterLookup = useMemo(() => {
    const map = new Map<string, RosterPokemon>();
    for (const player of players) {
      for (const mon of player.roster) {
        map.set(mon.name, mon);
      }
    }
    return map;
  }, [players]);

  const playerLookup = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) map.set(p.id, p);
    return map;
  }, [players]);

  // Ownership map ────────────────────────────────────────────────
  const ownershipMap = useMemo(() => {
    const map = new Map<string, PoolOwnership>();

    if (state.mode === 'season') {
      // Show all historical picks
      for (const pick of state.allPicks) {
        map.set(pick.pokemonName, {
          teamId: pick.playerId,
          acquisition: { method: 'drafted', round: pick.round, pick: pick.pick },
        });
      }
      // Apply trades on top
      for (const trade of state.trades) {
        const existing = map.get(trade.pokemonName);
        if (existing) {
          map.set(trade.pokemonName, {
            teamId: trade.toTeamId,
            acquisition: { method: 'traded', week: trade.week, fromTeamId: trade.fromTeamId },
          });
        }
      }
    } else {
      // Demo/live: show picks made so far
      for (const pick of state.allPicks) {
        map.set(pick.pokemonName, {
          teamId: pick.playerId,
          acquisition: { method: 'drafted', round: pick.round, pick: pick.pick },
        });
      }
    }

    return map;
  }, [state.allPicks, state.trades, state.mode]);

  // Filtered pool ────────────────────────────────────────────────
  const filteredPool = useMemo(() => {
    let pool = TIER_LIST.filter(entry => {
      if (entry.tier < state.filters.tierMin || entry.tier > state.filters.tierMax) return false;
      if (state.filters.search) {
        const q = state.filters.search.toLowerCase();
        if (!entry.name.toLowerCase().includes(q)) return false;
      }
      const owned = ownershipMap.has(entry.name);
      if (state.filters.ownership === 'owned' && !owned) return false;
      if (state.filters.ownership === 'free-agent' && owned) return false;
      if (state.filters.types.length > 0) {
        const rosterMon = rosterLookup.get(entry.name);
        const pokeData = getPokemonData(entry.name);
        const types = rosterMon?.types ?? pokeData?.types;
        if (types) {
          if (state.filters.typeMode === 'and') {
            // AND: Pokemon must have ALL selected types
            const hasAll = state.filters.types.every(t => types.includes(t));
            if (!hasAll) return false;
          } else {
            // OR: Pokemon must have at least one selected type
            const hasType = state.filters.types.some(t => types.includes(t));
            if (!hasType) return false;
          }
        }
      }
      if (state.filters.abilitySearch) {
        const q = state.filters.abilitySearch.toLowerCase();
        const rosterMon = rosterLookup.get(entry.name);
        const pokeData = getPokemonData(entry.name);
        const abilities = rosterMon?.abilities ?? pokeData?.abilities ?? [];
        const hasAbility = abilities.some(a => a.toLowerCase().includes(q));
        if (!hasAbility) return false;
      }
      return true;
    });

    switch (state.filters.sortBy) {
      case 'tier-desc':
        pool = [...pool].sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
        break;
      case 'tier-asc':
        pool = [...pool].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
        break;
      case 'name-asc':
        pool = [...pool].sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        pool = [...pool].sort((a, b) => b.name.localeCompare(a.name));
        break;
    }
    return pool;
  }, [state.filters, ownershipMap, rosterLookup]);

  const poolByTier = useMemo(() => {
    const groups = new Map<number, typeof filteredPool>();
    for (const entry of filteredPool) {
      const group = groups.get(entry.tier) ?? [];
      group.push(entry);
      groups.set(entry.tier, group);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [filteredPool]);

  return {
    rosterLookup,
    playerLookup,
    ownershipMap,
    filteredPool,
    poolByTier,
  };
}
