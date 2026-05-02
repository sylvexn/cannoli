import { useMemo } from 'react';
import { TIER_LIST } from '@/data/tier-list';
import type { Player } from '@/lib/types';
import type { Acquisition, DraftState, PoolOwnership } from './types';

/**
 * Derives all team-level draft data from the reducer state + league data:
 * - `draftedSet`: every drafted Pokemon name (used for free-agent filtering + AI/queue auto-pick).
 * - `demoTeamPoints` / `demoTeamRosterNames`: per-team points + names from in-progress
 *   demo/live picks (NOT season — season uses `teamPoints` derived from ownershipMap).
 * - `picksLeftByTeam`: remaining snake slots per team during an active draft.
 * - `teamRosters` / `teamPoints`: post-ownership roster view (works for season too).
 * - `draftOrder`: standings reversed (worst record picks first).
 *
 * `ownershipMap` is passed in (not computed here) because it's already the
 * canonical view that overlays trades and is also consumed by the pool grid.
 */
export function useDraftTeams(
  state: DraftState,
  players: Player[],
  standings: Player[],
  ownershipMap: Map<string, PoolOwnership>,
) {
  // Compute team points from current picks (for demo validation)
  const demoTeamPoints = useMemo(() => {
    if (state.mode !== 'demo') return new Map<string, number>();
    const pts = new Map<string, number>();
    for (const pick of state.allPicks) {
      pts.set(pick.playerId, (pts.get(pick.playerId) ?? 0) + pick.tier);
    }
    return pts;
  }, [state.mode, state.allPicks]);

  const draftedSet = useMemo(() => {
    return new Set(state.allPicks.map(p => p.pokemonName));
  }, [state.allPicks]);

  // For demo/live: per-team roster names (used for same-species + mega cap checks)
  const demoTeamRosterNames = useMemo(() => {
    if (state.mode === 'season') return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    for (const pick of state.allPicks) {
      const arr = map.get(pick.playerId) ?? [];
      arr.push(pick.pokemonName);
      map.set(pick.playerId, arr);
    }
    return map;
  }, [state.mode, state.allPicks]);

  // Per-team picks-left during draft: count of remaining snake slots assigned to that team
  // (including the slot currently on the clock if it's theirs).
  const picksLeftByTeam = useMemo(() => {
    const map = new Map<string, number>();
    if (state.mode === 'season' || !state.demoStarted) return map;
    for (let i = state.currentPickIndex; i < state.snakeOrder.length; i++) {
      const slot = state.snakeOrder[i];
      map.set(slot.teamId, (map.get(slot.teamId) ?? 0) + 1);
    }
    return map;
  }, [state.mode, state.demoStarted, state.snakeOrder, state.currentPickIndex]);

  // Team rosters from ownership
  const teamRosters = useMemo(() => {
    const rosters = new Map<string, { name: string; tier: number; acquisition: Acquisition }[]>();
    for (const p of players) rosters.set(p.id, []);
    for (const [pokemonName, ownership] of ownershipMap) {
      const entry = rosters.get(ownership.teamId);
      const tierEntry = TIER_LIST.find(t => t.name === pokemonName);
      if (entry) {
        entry.push({ name: pokemonName, tier: tierEntry?.tier ?? 0, acquisition: ownership.acquisition });
      }
    }
    for (const [, roster] of rosters) {
      roster.sort((a, b) => b.tier - a.tier);
    }
    return rosters;
  }, [players, ownershipMap]);

  const teamPoints = useMemo(() => {
    const points = new Map<string, number>();
    for (const [teamId, roster] of teamRosters) {
      points.set(teamId, roster.reduce((sum, mon) => sum + mon.tier, 0));
    }
    return points;
  }, [teamRosters]);

  // Draft order: worst record picks first
  const draftOrder = useMemo(() => [...standings].reverse(), [standings]);

  return {
    draftedSet,
    demoTeamPoints,
    demoTeamRosterNames,
    picksLeftByTeam,
    teamRosters,
    teamPoints,
    draftOrder,
  };
}
