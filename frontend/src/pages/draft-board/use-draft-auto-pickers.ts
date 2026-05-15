import { useCallback, useEffect, useRef, type Dispatch } from 'react';
import { toast } from 'sonner';
import { TIER_LIST, BANNED } from '@/data/tier-list';
import {
  findPickConflict, captainHeadroomNeeded, type ConflictInputRoster,
} from '@/lib/draft-rules';
import type { DraftAction, DraftState, SnakeSlot } from './types';

const BANNED_SET = new Set(BANNED);

/**
 * Mirrors backend draft-engine.getAutoPick: filters banned, drafted, and any
 * pick that would fail findPickConflict (same-species, mega-cap, over-budget,
 * or roster-reserve when picksLeft is provided).
 */
function simulatorAutoPick(
  drafted: Set<string>,
  roster: ConflictInputRoster,
  pointCap: number,
): { name: string; tier: number } | null {
  const available = TIER_LIST.filter(e => {
    if (drafted.has(e.name)) return false;
    if (BANNED_SET.has(e.name)) return false;
    if (e.tier <= 0) return false;
    if (findPickConflict(e.name, e.tier, roster, pointCap)) return false;
    return true;
  });
  if (available.length === 0) return null;

  // Pick from top 3 tiers available, weighted random
  available.sort((a, b) => b.tier - a.tier);
  const topTier = available[0].tier;
  const candidates = available.filter(e => e.tier >= topTier - 2);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

interface UseDraftAutoPickersOptions {
  state: DraftState;
  dispatch: Dispatch<DraftAction>;
  draftedSet: Set<string>;
  demoTeamPoints: Map<string, number>;
  demoTeamRosterNames: Map<string, string[]>;
  picksLeftByTeam: Map<string, number>;
  teraCaptainSlots: number;
}

/**
 * Encapsulates client-side auto-pick effects:
 *   - Toast when it becomes the user's turn
 *   - Simulator AI picks for non-user teams
 *   - User auto-pick on timer expiry (simulator only — live mode is admin-driven)
 *   - Auto-draft from queue when toggle is on
 *
 * Returns:
 *   - `currentSlot`: the slot currently on the clock (null if not running)
 *   - `isUserTurn`: whether the user is on the clock
 *   - `buildConflictRoster`: helper to build ConflictInputRoster for any team
 */
export function useDraftAutoPickers({
  state, dispatch, draftedSet,
  demoTeamPoints, demoTeamRosterNames, picksLeftByTeam,
  teraCaptainSlots,
}: UseDraftAutoPickersOptions) {
  const isActive = state.view === 'active';
  const isRunning = isActive && state.status === 'running';
  const isComplete = isActive && state.status === 'complete';

  const currentSlot: SnakeSlot | null = isActive && (state.status === 'running' || state.status === 'configuring')
    ? state.snakeOrder[state.currentPickIndex] ?? null
    : null;

  const isUserTurn = isRunning && currentSlot?.teamId === state.userTeamId;

  // Build a ConflictInputRoster for any team. Returns undefined when we have no
  // draft context (history view).
  const buildConflictRoster = useCallback((teamId: string): ConflictInputRoster | undefined => {
    if (state.view === 'history') return undefined;
    const names = demoTeamRosterNames.get(teamId) ?? [];
    const pointsUsed = demoTeamPoints.get(teamId) ?? 0;
    const picksLeft = picksLeftByTeam.get(teamId);
    const rosterEntries = state.allPicks
      .filter(p => p.playerId === teamId)
      .map(p => ({ name: p.pokemonName, tier: p.tier }));
    const captainReserve = teraCaptainSlots > 0
      ? captainHeadroomNeeded(rosterEntries, teraCaptainSlots)
      : 0;
    return { pokemonNames: names, pointsUsed, picksLeft, captainReserve };
  }, [state.view, state.allPicks, demoTeamRosterNames, demoTeamPoints, picksLeftByTeam, teraCaptainSlots]);

  // Toast when it becomes the user's turn
  const prevIsUserTurn = useRef(false);
  useEffect(() => {
    if (isUserTurn && !prevIsUserTurn.current && isRunning && !isComplete) {
      toast.warning("It's your turn to pick!", { duration: 8000 });
    }
    prevIsUserTurn.current = isUserTurn;
  }, [isUserTurn, isRunning, isComplete]);

  // Simulator-only: AI picks for non-user teams after a short delay.
  // (For server source the backend drives auto-picks.)
  useEffect(() => {
    if (state.source !== 'simulator' || !isRunning || isComplete) return;
    if (!currentSlot || isUserTurn) return;

    const delay = setTimeout(() => {
      const ctx = buildConflictRoster(currentSlot.teamId);
      if (!ctx) return;
      const pick = simulatorAutoPick(draftedSet, ctx, state.pointCap);
      if (pick) {
        dispatch({ type: 'PICK_LANDED', pokemonName: pick.name, tier: pick.tier });
      }
    }, 300 + Math.random() * 700);

    return () => clearTimeout(delay);
  }, [state.source, isRunning, isComplete, currentSlot, isUserTurn, buildConflictRoster, draftedSet, state.pointCap, dispatch]);

  // Simulator-only: auto-pick for the user on timer expiry. Live mode pauses
  // on expiry server-side; admin resolves explicitly.
  useEffect(() => {
    if (state.source !== 'simulator' || !isRunning || !isUserTurn) return;
    if (state.timerSeconds > 0) return;

    const ctx = state.userTeamId ? buildConflictRoster(state.userTeamId) : undefined;
    if (!ctx) return;
    const pick = simulatorAutoPick(draftedSet, ctx, state.pointCap);
    if (pick) {
      dispatch({ type: 'PICK_LANDED', pokemonName: pick.name, tier: pick.tier });
    }
  }, [state.source, isRunning, isUserTurn, state.timerSeconds, buildConflictRoster, draftedSet, state.pointCap, state.userTeamId, dispatch]);

  // Auto-draft from queue when it's user's turn and autoDraftQueue is enabled.
  // Works in both sources: simulator dispatches PICK_LANDED directly; server
  // path dispatches PICK_LANDED here too — but for server source the actual
  // pick must go through the WS, so this effect is gated to simulator only.
  // In server source, the parent hook's handleUserPick is called via UI buttons;
  // queue auto-draft for server source is left to a separate parent-side effect.
  useEffect(() => {
    if (state.source !== 'simulator') return;
    if (!isUserTurn || !state.autoDraftQueue || state.draftQueue.length === 0) return;
    if (!isRunning || isComplete) return;

    const ctx = state.userTeamId ? buildConflictRoster(state.userTeamId) : undefined;
    if (!ctx) return;

    let chosen: { name: string; tier: number } | null = null;
    for (const name of state.draftQueue) {
      if (draftedSet.has(name)) continue;
      const entry = TIER_LIST.find(e => e.name === name);
      if (!entry) continue;
      if (findPickConflict(name, entry.tier, ctx, state.pointCap)) continue;
      chosen = { name, tier: entry.tier };
      break;
    }
    if (!chosen) return;

    const picked = chosen;
    const delay = setTimeout(() => {
      dispatch({ type: 'PICK_LANDED', pokemonName: picked.name, tier: picked.tier });
    }, 500);

    return () => clearTimeout(delay);
  }, [state.source, isUserTurn, state.autoDraftQueue, state.draftQueue, isRunning, isComplete, buildConflictRoster, draftedSet, state.pointCap, state.userTeamId, dispatch]);

  return {
    currentSlot,
    isUserTurn,
    buildConflictRoster,
  };
}
