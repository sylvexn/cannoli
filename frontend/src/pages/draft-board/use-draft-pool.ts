import { useMemo } from 'react';
import { getTierList, type CostFormat } from '@/data/tier-list';
import { DEFAULT_FORMAT, type DraftFormat } from '@/data/pokemon-learnsets';
import { getPokemonData } from '@/data/pokemon-data';
import type { Player, RosterPokemon } from '@/lib/types';
import type { DraftState, PoolOwnership } from './types';
import { matchRawQuery, matchChip, type MatchReason } from '@/lib/pool-search';

interface UseDraftPoolOptions {
  /** Highest tier the user can take right now after reserves (raw budget minus
   *  min-cost reserve for remaining mandatory picks). When provided alongside
   *  `filters.affordableOnly`, the pool excludes Pokemon over this cap. The
   *  call-site passes whatever it already has — we compute a coarse fallback
   *  from current points used + picks-left so the toggle is useful even
   *  before downstream hooks resolve. */
  affordCap?: number;
  /** Active league cost format — determines which tier list and ban list to use. */
  format?: CostFormat;
  /** Move-legality format for the pool's ability/move search (DraftFormat). */
  draftFormat?: DraftFormat;
}

/**
 * Builds the canonical ownership map (drafted + traded), the filtered/sorted
 * Pokemon pool, and per-tier groupings used by the grid view.
 *
 * Also exposes `rosterLookup` / `playerLookup` since they're cheap by-products
 * of `players` and several consumers (popovers, sidebars) want them too.
 */
export function useDraftPool(state: DraftState, players: Player[], opts: UseDraftPoolOptions = {}) {
  const { affordCap, format, draftFormat } = opts;
  const resolvedDraftFormat: DraftFormat = draftFormat ?? DEFAULT_FORMAT;
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

  // Ownership map
  // CURRENT ownership is authoritative from rosters (`players[].roster`), which
  // is complete and already reflects trades + free agencies. `state.allPicks`
  // (the draft_picks event log) only ENRICHES draft round/pick detail and covers
  // a live draft before rosters are populated — it must NOT gate the "owned"
  // flag, because that table can be partially populated (e.g. live S11 only has
  // one team's picks recorded), which would render every other team's mons as
  // free agents. The sim seeds a full draft_picks log, so this only bit live.
  const ownershipMap = useMemo(() => {
    const map = new Map<string, PoolOwnership>();

    if (state.view === 'history') {
      // Draft replay: the draft sequence, then trades overlaid.
      for (const pick of state.allPicks) {
        map.set(pick.pokemonName, {
          teamId: pick.playerId,
          acquisition: { method: 'drafted', round: pick.round, pick: pick.pick },
        });
      }
      for (const trade of state.trades) {
        const existing = map.get(trade.pokemonName);
        if (existing) {
          map.set(trade.pokemonName, {
            teamId: trade.toTeamId,
            acquisition: { method: 'traded', week: trade.week, fromTeamId: trade.fromTeamId },
          });
        }
      }
      // Union rosters so mons absent from an incomplete draft_picks log still
      // show as owned by their current team.
      for (const player of players) {
        for (const mon of player.roster) {
          if (!map.has(mon.name)) {
            map.set(mon.name, { teamId: player.id, acquisition: { method: 'drafted' } });
          }
        }
      }
    } else {
      // Active / current view: rosters are the source of truth for who owns what
      // right now. Seed every rostered mon, then enrich with draft detail.
      for (const player of players) {
        for (const mon of player.roster) {
          map.set(mon.name, { teamId: player.id, acquisition: { method: 'drafted' } });
        }
      }
      for (const pick of state.allPicks) {
        const cur = map.get(pick.pokemonName);
        if (!cur) {
          // A live-draft pick not yet reflected on a roster.
          map.set(pick.pokemonName, {
            teamId: pick.playerId,
            acquisition: { method: 'drafted', round: pick.round, pick: pick.pick },
          });
        } else if (cur.teamId === pick.playerId) {
          // Same owner — attach the draft round/pick for the tooltip.
          cur.acquisition = { method: 'drafted', round: pick.round, pick: pick.pick };
        }
      }
    }

    return map;
  }, [players, state.allPicks, state.trades, state.view]);

  // Filtered pool + match reasons
  const { filteredPool, matchReasons } = useMemo(() => {
    const tierList = getTierList(format);
    const reasons = new Map<string, MatchReason>();

    let pool = tierList.filter(entry => {
      if (entry.tier < state.filters.tierMin || entry.tier > state.filters.tierMax) return false;
      if (state.filters.affordableOnly && affordCap != null && entry.tier > affordCap) return false;

      const abilities = rosterLookup.get(entry.name)?.abilities ?? getPokemonData(entry.name)?.abilities ?? [];

      // Broad-OR free text — name, ability, or move. Captures reason for badge.
      let rawReason: MatchReason | null = null;
      if (state.filters.search) {
        const r = matchRawQuery(entry.name, state.filters.search, resolvedDraftFormat, abilities);
        if (!r.matched) return false;
        rawReason = r.reason;
      }

      // Stacked exact chips — AND logic; all must pass.
      for (const chip of state.filters.searchChips) {
        if (!matchChip(entry.name, chip, resolvedDraftFormat, abilities)) return false;
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

      // Build match reason for this surviving entry using chip-precedence:
      // 1. first move chip → move badge
      // 2. else first ability chip → ability badge
      // 3. else raw-search reason (if non-null)
      // 4. else no badge (name-only match)
      const moveChip = state.filters.searchChips.find(c => c.kind === 'move');
      const abilChip = state.filters.searchChips.find(c => c.kind === 'ability');
      if (moveChip) {
        reasons.set(entry.name, { kind: 'move', label: moveChip.label });
      } else if (abilChip) {
        reasons.set(entry.name, { kind: 'ability', label: abilChip.label });
      } else if (rawReason) {
        reasons.set(entry.name, rawReason);
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
    return { filteredPool: pool, matchReasons: reasons };
  }, [state.filters, ownershipMap, rosterLookup, affordCap, format, resolvedDraftFormat]);

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
    matchReasons,
  };
}
