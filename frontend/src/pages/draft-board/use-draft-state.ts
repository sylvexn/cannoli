import { useReducer, useMemo, useEffect, useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { TIER_LIST, BANNED } from '@/data/tier-list';
import {
  findPickConflict, describeConflict, type ConflictInputRoster,
} from '@/lib/draft-rules';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import type { ApiDraftPick, ApiDraftState } from '@/lib/api';
import { useDraftWebSocket } from './use-draft-websocket';
import type { DraftPresenceData } from './use-draft-websocket';
import { generateDraftOrder, transactionsToTrades } from './generate-draft-order';
import type {
  DraftState, DraftPickEntry, DraftSource,
} from './types';
import { DEFAULT_FILTERS } from './types';
import { useDraftSettings } from './use-draft-settings';
import { useDraftTimer } from './use-draft-timer';
import { useDraftPool } from './use-draft-pool';
import { useDraftTeams } from './use-draft-teams';
import { useDraftAutoPickers } from './use-draft-auto-pickers';
import { useDraftMute } from './use-draft-mute';
import { usePickAnimationQueue } from './use-pick-animation-queue';
import { draftReducer, generateSnakeSlots } from './draft-reducer';

const DEFAULT_TIMER = 30;
const BANNED_SET = new Set(BANNED);

// Re-export so existing callers (e.g. control bar) keep working.
export { generateSnakeSlots };

interface UseDraftStateOptions {
  /** Initial draft source. 'server' for the live route, 'simulator' for /draft/practice. */
  source?: DraftSource;
}

/**
 * Top-level draft hook. Wires the reducer, WS sync, simulator AI, and derived
 * lookups together. Kept thin — heavy lifting lives in:
 *   - draft-reducer.ts
 *   - use-draft-pool.ts
 *   - use-draft-teams.ts
 *   - use-draft-timer.ts
 *   - use-draft-auto-pickers.ts
 *   - use-draft-websocket.ts
 */
export function useDraftState({ source = 'server' }: UseDraftStateOptions = {}) {
  const league = useLeague();
  const { players, standings, transactions } = useLeagueData();
  const { user } = useAuth();

  // ─── Presence tracking ───────────────────────────────────────────
  const [presence, setPresence] = useState<DraftPresenceData>({ players: [], spectators: [] });

  // ─── Draft settings from admin ──────────────────────────────────
  const { draftTimerEnabled, draftDemoVisible } = useDraftSettings();

  // ─── Season data (historical picks from API) ─────────────────────
  const [draftPicks, setDraftPicks] = useState<ApiDraftPick[]>([]);

  useEffect(() => {
    api.getDraftPicks(league.id).then(setDraftPicks);
  }, [league.id]);

  const seasonPicks = useMemo(
    () => draftPicks.length > 0 ? generateDraftOrder(standings, draftPicks) : [],
    [standings, draftPicks],
  );

  const trades = useMemo(() => transactionsToTrades(transactions), [transactions]);

  // ─── Reducer ──────────────────────────────────────────────────────
  const initialState: DraftState = {
    view: 'history',
    status: 'idle',
    source,
    allPicks: seasonPicks,
    trades,
    snakeOrder: [],
    currentPickIndex: seasonPicks.length,
    speed: 1,
    timerSeconds: DEFAULT_TIMER,
    timerDuration: DEFAULT_TIMER,
    timerPaused: false,
    userTeamId: null,
    viewMode: 'grid',
    selectedTeamId: null,
    filters: DEFAULT_FILTERS,
    detailPokemon: null,
    pointCap: 110,
    draftQueue: [],
    autoDraftQueue: false,
    liveTimerExpiresAt: null,
  };

  const [state, dispatch] = useReducer(draftReducer, initialState);

  // Sync season data when it loads
  useEffect(() => {
    if (seasonPicks.length > 0) {
      dispatch({ type: 'SYNC_DATA', allPicks: seasonPicks, trades });
    }
  }, [seasonPicks, trades]);

  // Simulator (practice) source: auto-enter the active+configuring view on
  // mount so the pre-start config panel (team picker, timer) is the first
  // thing the user sees. The default initial state is view=history; without
  // this nudge the simulator route would render the season recap.
  const didEnterSimulatorActive = useRef(false);
  useEffect(() => {
    if (source !== 'simulator') return;
    if (didEnterSimulatorActive.current) return;
    if (state.view === 'active') return;
    didEnterSimulatorActive.current = true;
    dispatch({ type: 'SET_VIEW', view: 'active', source: 'simulator' });
  }, [source, state.view]);

  // ─── Pool, ownership, lookups ────────────────────────────────────
  const { rosterLookup, playerLookup, ownershipMap, filteredPool, poolByTier }
    = useDraftPool(state, players);

  // ─── Team-derived data (rosters, points, picks-left, drafted set) ─
  const {
    draftedSet, demoTeamPoints, demoTeamRosterNames, picksLeftByTeam,
    teamRosters, teamPoints, draftOrder,
  } = useDraftTeams(state, players, standings, ownershipMap);

  // ─── Timer derive ────────────────────────────────────────────────
  const { displayTimerSeconds } = useDraftTimer(state, dispatch);

  const teraCaptainSlots = league.season.teraCaptainSlots ?? 0;

  // ─── Pick animation queue (presentational) ────────────────────────
  // Serializes pick celebrations so batched picks (reconnect catch-up, fast
  // auto-picks) play one at a time. Owns cry playback on the landing-phase
  // boundary — draft-board.tsx no longer plays cries eagerly.
  // Mute is read here; both useDraftMute call-sites share the same key.
  const { muted } = useDraftMute();
  const pickQueue = usePickAnimationQueue({ mute: muted });
  const { enqueue: enqueuePickAnimation, queueIdle } = pickQueue;

  // ─── Auto-pickers (simulator AI + queue auto-draft + your-turn toast) ──
  // Gated on queueIdle so picks land one at a time without overlapping.
  const { currentSlot, isUserTurn, buildConflictRoster } = useDraftAutoPickers({
    state, dispatch, draftedSet,
    demoTeamPoints, demoTeamRosterNames, picksLeftByTeam,
    teraCaptainSlots, queueIdle,
  });

  // ─── Enqueue new picks into the animation queue ──────────────────
  // Watches state.allPicks length and pushes any new tail entries. Works for
  // both sources (simulator dispatches PICK_LANDED; server applies LIVE_SYNC
  // which also grows allPicks) without double-counting.
  const lastEnqueuedCountRef = useRef(0);
  useEffect(() => {
    // Only animate during an active draft. Season-mode hydration / view swaps
    // shouldn't replay every historical pick.
    const draftActive = state.view === 'active' && state.status === 'running';
    if (!draftActive) {
      lastEnqueuedCountRef.current = state.allPicks.length;
      return;
    }
    const prev = lastEnqueuedCountRef.current;
    const cur = state.allPicks.length;
    if (cur <= prev) {
      // Sync down (state reset / shrink) — re-baseline.
      lastEnqueuedCountRef.current = cur;
      return;
    }
    for (let i = prev; i < cur; i++) {
      const p = state.allPicks[i];
      if (!p?.pokemonName) continue;
      enqueuePickAnimation({
        pokemonName: p.pokemonName,
        tier: p.tier,
        playerId: p.playerId,
        overallPick: p.overallPick,
      });
    }
    lastEnqueuedCountRef.current = cur;
  }, [state.allPicks, state.view, state.status, enqueuePickAnimation]);

  const isDraftComplete = state.view === 'active' && state.status === 'complete';

  // ─── Server-source: WebSocket connection ──────────────────────────
  const wsEnabled = state.source === 'server' && state.view === 'active';

  const { connected: wsConnected, sendPick: wsSendPick, identify: wsIdentify } = useDraftWebSocket({
    leagueId: league.id,
    enabled: wsEnabled,
    onState: useCallback((snapshot: ApiDraftState) => {
      dispatch({ type: 'LIVE_SYNC', snapshot });
    }, []),
    onPickMade: useCallback((data) => {
      // Server is authoritative — apply the post-pick snapshot. The animation
      // signal is implicit via state.allPicks growing; downstream effects in
      // draft-board.tsx watch that to fire cries / pick-log freshness.
      if (data.snapshot) {
        dispatch({ type: 'LIVE_SYNC', snapshot: data.snapshot });
      } else {
        // Defensive fallback when snapshot missing: append from confirmed pick.
        dispatch({
          type: 'PICK_LANDED',
          pokemonName: data.pick.pokemonName,
          tier: data.pick.tier,
          playerId: data.pick.teamId,
        });
      }
    }, []),
    onPresence: useCallback((data: DraftPresenceData) => {
      setPresence(data);
    }, []),
    onError: useCallback((error: string, meta) => {
      console.error('[Draft WS]', error, meta);
      // 'pending_send' is informational (we'll replay on reconnect), not a hard failure.
      if (meta?.code === 'pending_send') {
        toast.info(error);
        return;
      }
      // Pick-validation errors come back with structured codes — surface the
      // server's human message so the user understands why their pick was
      // rejected (dup_natdex, captain_reserve_violation, etc.).
      toast.error(error);
    }, []),
  });

  // Identify ourselves when connected
  useEffect(() => {
    if (!wsConnected || !user) return;
    const teamId = state.userTeamId || null;
    wsIdentify(teamId, user.username, user.role);
  }, [wsConnected, user, state.userTeamId, wsIdentify]);

  // Fetch initial draft state when entering server-sourced active view
  useEffect(() => {
    if (state.source !== 'server' || state.view !== 'active') return;
    api.getDraftState(league.id).then(snapshot => {
      if (snapshot.status && snapshot.status !== 'not_started') {
        dispatch({ type: 'LIVE_SYNC', snapshot });
      }
    }).catch(() => {});
  }, [state.source, state.view, league.id]);

  // Server-source: handle user pick via WS
  const handleLivePick = useCallback((pokemonName: string) => {
    if (state.source !== 'server' || !isUserTurn || !state.userTeamId) return;
    wsSendPick(pokemonName, state.userTeamId);
  }, [state.source, isUserTurn, state.userTeamId, wsSendPick]);

  // ─── User pick handler ────────────────────────────────────────────
  const handleUserPick = useCallback((pokemonName: string) => {
    if (!isUserTurn) return;

    if (state.source === 'server') {
      // Backend is authoritative; let it surface errors via WS error events.
      handleLivePick(pokemonName);
      return;
    }

    // Simulator path. Validation mirrors backend draft-engine.validatePick so
    // the user gets immediate feedback on illegal picks.
    if (draftedSet.has(pokemonName)) {
      toast.error(`${pokemonName} is already drafted`);
      return;
    }
    if (BANNED_SET.has(pokemonName)) {
      toast.error(`${pokemonName} is banned`);
      return;
    }

    const entry = TIER_LIST.find(e => e.name === pokemonName);
    if (!entry) {
      toast.error(`${pokemonName} not found in tier list`);
      return;
    }

    const ctx = state.userTeamId ? buildConflictRoster(state.userTeamId) : undefined;
    if (ctx) {
      const conflict = findPickConflict(pokemonName, entry.tier, ctx, state.pointCap);
      if (conflict) {
        toast.error(describeConflict(conflict));
        return;
      }
    }

    dispatch({ type: 'PICK_LANDED', pokemonName, tier: entry.tier });
  }, [state.source, isUserTurn, draftedSet, buildConflictRoster, state.userTeamId, state.pointCap, handleLivePick]);

  // ─── Current pick info ───────────────────────────────────────────
  const currentPick = useMemo((): DraftPickEntry | null => {
    if (state.view !== 'active') return null;
    if (state.status !== 'running') return null;
    const slot = currentSlot;
    if (!slot) return null;
    // Return a placeholder pick entry for the on-the-clock banner
    return {
      round: slot.round,
      pick: slot.pick,
      overallPick: slot.overallPick,
      playerId: slot.teamId,
      pokemonName: '', // not yet picked
      tier: 0,
      isTeraCaptain: false,
    };
  }, [state.view, state.status, currentSlot]);

  // Conflict context for the user's roster — used by pool grid + popover to flag
  // picks that would fail validation (mega cap / dup species / over budget / reserve).
  const userConflictRoster = useMemo<ConflictInputRoster | undefined>(() => {
    if (!state.userTeamId) return undefined;
    return buildConflictRoster(state.userTeamId);
  }, [state.userTeamId, buildConflictRoster]);

  // Highest tier the user can pick right now, accounting for picks-left × min-cost
  // and captain reserve. Falls back to raw remaining when no draft context exists.
  const userMaxAffordableCost = useMemo(() => {
    if (!userConflictRoster) return undefined;
    const remaining = state.pointCap - userConflictRoster.pointsUsed;
    if (userConflictRoster.picksLeft == null) return remaining;
    const futureSlots = Math.max(0, userConflictRoster.picksLeft - 1);
    const reserve = futureSlots + (userConflictRoster.captainReserve ?? 0);
    return Math.max(0, remaining - reserve);
  }, [userConflictRoster, state.pointCap]);

  // Raw remaining (unreserved) — kept around for status displays that show
  // budget literally rather than max pickable.
  const userBudgetRemaining = useMemo(() => {
    if (!state.userTeamId) return undefined;
    const spent = teamPoints.get(state.userTeamId) ?? 0;
    return state.pointCap - spent;
  }, [state.userTeamId, teamPoints, state.pointCap]);

  // Aria-live string: announces each pick once on the landing phase. Empty
  // most of the time — screen readers see one event per pick rather than on
  // every state churn.
  const pickAnnouncement = useMemo(() => {
    const cur = pickQueue.current;
    if (!cur || pickQueue.phase !== 'landing') return '';
    const player = playerLookup.get(cur.playerId);
    const abbrev = player?.teamAbbrev ?? cur.playerId;
    return `Pick ${cur.overallPick}: ${abbrev} drafted ${cur.pokemonName} (tier ${cur.tier})`;
  }, [pickQueue.current, pickQueue.phase, playerLookup]);

  return {
    state,
    dispatch,
    league,
    players,
    ownershipMap,
    filteredPool,
    poolByTier,
    currentPick,
    teamRosters,
    teamPoints,
    rosterLookup,
    playerLookup,
    isUserTurn,
    isDraftComplete,
    draftOrder,
    handleUserPick,
    draftedSet,
    wsConnected,
    presence,
    userBudgetRemaining,
    userMaxAffordableCost,
    userConflictRoster,
    draftTimerEnabled,
    draftDemoVisible,
    /**
     * Seconds-remaining to display in UI. In server source, derived from the
     * server deadline (state.liveTimerExpiresAt) every second. In simulator,
     * the reducer decrements state.timerSeconds directly.
     */
    displayTimerSeconds,
    /**
     * Serialized animation queue for pick celebrations. Consumers (sprite
     * morph, pick-log highlight, aria-live) render off pickQueue.current /
     * pickQueue.phase. Auto-pickers internally gate on pickQueue.queueIdle.
     */
    pickQueue,
    /**
     * Aria-live announcement string. Empty except briefly on the landing
     * phase of each pick. Render via <span className="sr-only" aria-live="polite">.
     */
    pickAnnouncement,
  };
}
