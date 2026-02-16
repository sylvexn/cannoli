import { useReducer, useMemo, useEffect, useCallback, useRef, useState } from 'react';
import { TIER_LIST, BANNED } from '@/data/tier-list';
import { getPokemonData } from '@/data/pokemon-data';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { api } from '@/lib/api';
import type { ApiDraftPick, ApiDraftState } from '@/lib/api';
import { useDraftWebSocket } from './use-draft-websocket';
import type { Player, RosterPokemon } from '@/lib/types';
import { generateDraftOrder, transactionsToTrades } from './generate-draft-order';
import type {
  DraftState, DraftAction, PoolOwnership, Acquisition, DraftPickEntry, SnakeSlot,
} from './types';
import { DEFAULT_FILTERS } from './types';

const DEMO_TIMER_DEFAULT = 30;
const BANNED_SET = new Set(BANNED);

// ─── Demo AI: pick a random valid Pokemon ───────────────────────────────────

function demoAutoPick(
  drafted: Set<string>,
  teamPoints: number,
  pointCap: number,
): { name: string; tier: number } | null {
  const remaining = pointCap - teamPoints;
  const available = TIER_LIST.filter(
    e => !drafted.has(e.name) && !BANNED_SET.has(e.name) && e.tier > 0 && e.tier <= remaining
  );
  if (available.length === 0) return null;

  // Pick from top 3 tiers available, weighted random
  available.sort((a, b) => b.tier - a.tier);
  const topTier = available[0].tier;
  const candidates = available.filter(e => e.tier >= topTier - 2);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ─── Snake order generation (client-side) ───────────────────────────────────

export function generateSnakeSlots(teamIds: string[], rounds: number): SnakeSlot[] {
  const slots: SnakeSlot[] = [];
  for (let round = 1; round <= rounds; round++) {
    const order = round % 2 === 1 ? teamIds : [...teamIds].reverse();
    for (let i = 0; i < order.length; i++) {
      slots.push({
        round,
        pick: i + 1,
        overallPick: slots.length + 1,
        teamId: order[i],
      });
    }
  }
  return slots;
}

// ─── Reducer ────────────────────────────────────────────────────────────────

function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'SET_MODE': {
      if (action.mode === 'season') {
        return { ...state, mode: 'season', demoStarted: false, isPlaying: false, filters: DEFAULT_FILTERS };
      }
      if (action.mode === 'demo') {
        return {
          ...state,
          mode: 'demo',
          allPicks: [],
          currentPickIndex: 0,
          isPlaying: false,
          timerSeconds: state.timerDuration,
          demoStarted: false,
        };
      }
      return { ...state, mode: action.mode };
    }

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode };

    case 'SELECT_TEAM':
      return { ...state, selectedTeamId: state.selectedTeamId === action.teamId ? null : action.teamId };

    case 'UPDATE_FILTERS':
      return { ...state, filters: { ...state.filters, ...action.filters } };

    case 'SET_DETAIL':
      return { ...state, detailPokemon: action.name };

    case 'SET_USER_TEAM':
      return { ...state, userTeamId: action.teamId };

    // ─── Season mode ──────────────────────────────────────────────────
    case 'SYNC_DATA':
      return {
        ...state,
        allPicks: action.allPicks,
        trades: action.trades,
        currentPickIndex: state.mode === 'season' ? action.allPicks.length : state.currentPickIndex,
      };

    // ─── Demo mode ────────────────────────────────────────────────────
    case 'DEMO_START':
      return {
        ...state,
        mode: 'demo',
        snakeOrder: action.snakeOrder,
        userTeamId: action.userTeamId,
        timerDuration: action.timerDuration,
        timerSeconds: action.timerDuration,
        pointCap: action.pointCap,
        allPicks: [],
        currentPickIndex: 0,
        isPlaying: true,
        demoStarted: true,
        timerPaused: false,
        // Auto-switch to free-agent filter for drafting
        filters: { ...state.filters, ownership: 'free-agent' },
      };

    case 'DEMO_PICK': {
      const slot = state.snakeOrder[state.currentPickIndex];
      if (!slot) return state;

      const newPick: DraftPickEntry = {
        round: slot.round,
        pick: slot.pick,
        overallPick: slot.overallPick,
        playerId: slot.teamId,
        pokemonName: action.pokemonName,
        tier: action.tier,
        isTeraCaptain: false,
      };

      const newPicks = [...state.allPicks, newPick];
      const nextIndex = state.currentPickIndex + 1;
      const isComplete = nextIndex >= state.snakeOrder.length;
      const nextSlot = state.snakeOrder[nextIndex];
      const isUserNext = nextSlot?.teamId === state.userTeamId;

      return {
        ...state,
        allPicks: newPicks,
        currentPickIndex: nextIndex,
        timerSeconds: state.timerDuration,
        isPlaying: isComplete ? false : !isUserNext,
      };
    }

    case 'DEMO_TICK': {
      if (state.timerSeconds <= 1) {
        // Timer expired — will be handled by the effect (auto-pick)
        return { ...state, timerSeconds: 0 };
      }
      return { ...state, timerSeconds: state.timerSeconds - 1 };
    }

    case 'DEMO_RESET':
      return {
        ...state,
        allPicks: [],
        currentPickIndex: 0,
        isPlaying: false,
        timerSeconds: state.timerDuration,
        timerPaused: false,
        demoStarted: false,
      };

    // ─── Live mode ─────────────────────────────────────────────────────
    case 'LIVE_SYNC': {
      const snap = action.snapshot;
      const snakeOrder: SnakeSlot[] = (snap.snakeOrder ?? []).map(s => ({
        round: s.round,
        pick: s.pick,
        overallPick: s.overallPick,
        teamId: s.teamId,
      }));
      const allPicks: DraftPickEntry[] = (snap.picks ?? []).map((p, i) => {
        const slot = snakeOrder[i];
        return {
          round: slot?.round ?? 1,
          pick: slot?.pick ?? 1,
          overallPick: i + 1,
          playerId: p.teamId,
          pokemonName: p.pokemonName,
          tier: p.tier,
          isTeraCaptain: false,
        };
      });

      // Compute timer from server expiry
      let timerSeconds = state.timerDuration;
      if (snap.timerExpiresAt) {
        const remaining = Math.max(0, Math.floor((new Date(snap.timerExpiresAt).getTime() - Date.now()) / 1000));
        timerSeconds = remaining;
      }

      return {
        ...state,
        mode: 'live',
        snakeOrder,
        allPicks,
        currentPickIndex: snap.currentPickIndex,
        timerDuration: snap.timerDuration,
        timerSeconds,
        demoStarted: snap.status === 'in_progress' || snap.status === 'completed',
        isPlaying: snap.status === 'in_progress',
        pointCap: 110,
      };
    }

    case 'LIVE_PICK_MADE': {
      const pick = action.pick;
      const slot = state.snakeOrder[state.allPicks.length];
      const newPick: DraftPickEntry = {
        round: slot?.round ?? 1,
        pick: slot?.pick ?? 1,
        overallPick: state.allPicks.length + 1,
        playerId: pick.playerId,
        pokemonName: pick.pokemonName,
        tier: pick.tier,
        isTeraCaptain: false,
      };
      return {
        ...state,
        allPicks: [...state.allPicks, newPick],
        currentPickIndex: state.currentPickIndex + 1,
        timerSeconds: state.timerDuration,
      };
    }

    // ─── Timer controls (admin/dev) ──────────────────────────────────
    case 'SET_TIMER_DURATION':
      return { ...state, timerDuration: action.duration, timerSeconds: state.demoStarted ? state.timerSeconds : action.duration };

    case 'PAUSE_TIMER':
      return { ...state, timerPaused: true };

    case 'RESUME_TIMER':
      return { ...state, timerPaused: false };

    case 'ADD_TIME':
      return { ...state, timerSeconds: state.timerSeconds + action.seconds };

    default:
      return state;
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useDraftState() {
  const league = useLeague();
  const { players, standings, transactions } = useLeagueData();

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
    mode: 'season',
    allPicks: seasonPicks,
    trades,
    snakeOrder: [],
    currentPickIndex: seasonPicks.length,
    isPlaying: false,
    speed: 1,
    timerSeconds: DEMO_TIMER_DEFAULT,
    timerDuration: DEMO_TIMER_DEFAULT,
    timerPaused: false,
    userTeamId: null,
    viewMode: 'grid',
    selectedTeamId: null,
    filters: DEFAULT_FILTERS,
    detailPokemon: null,
    demoStarted: false,
    pointCap: 110,
  };

  const [state, dispatch] = useReducer(draftReducer, initialState);

  // Sync season data when it loads
  useEffect(() => {
    if (seasonPicks.length > 0) {
      dispatch({ type: 'SYNC_DATA', allPicks: seasonPicks, trades });
    }
  }, [seasonPicks, trades]);

  // ─── Demo mode: AI auto-pick effect ──────────────────────────────
  const demoTimerRef = useRef<ReturnType<typeof setInterval>>();

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

  // Timer tick for demo mode
  useEffect(() => {
    if (state.mode !== 'demo' || !state.demoStarted || !state.isPlaying || state.timerPaused) {
      clearInterval(demoTimerRef.current);
      return;
    }

    demoTimerRef.current = setInterval(() => {
      dispatch({ type: 'DEMO_TICK' });
    }, 1000);

    return () => clearInterval(demoTimerRef.current);
  }, [state.mode, state.demoStarted, state.isPlaying, state.timerPaused]);

  // Timer tick for live mode (decrement client-side between WS syncs)
  useEffect(() => {
    if (state.mode !== 'live' || !state.demoStarted || !state.isPlaying || state.timerPaused) return;

    const interval = setInterval(() => {
      dispatch({ type: 'DEMO_TICK' }); // Reuse same tick action
    }, 1000);

    return () => clearInterval(interval);
  }, [state.mode, state.demoStarted, state.isPlaying, state.timerPaused]);

  // AI auto-pick: when it's not the user's turn and demo is playing, auto-pick
  const currentSlot = (state.mode === 'demo' || state.mode === 'live') && state.demoStarted
    ? state.snakeOrder[state.currentPickIndex] ?? null
    : null;

  const isUserTurn = (state.mode === 'demo' || state.mode === 'live') && currentSlot?.teamId === state.userTeamId;
  const isDemoComplete = (state.mode === 'demo' || state.mode === 'live') && state.demoStarted && state.currentPickIndex >= state.snakeOrder.length;

  useEffect(() => {
    if (state.mode !== 'demo' || !state.demoStarted || isDemoComplete) return;
    if (!currentSlot || isUserTurn) return;

    // AI picks after a short delay (simulates thinking)
    const delay = setTimeout(() => {
      const teamPts = demoTeamPoints.get(currentSlot.teamId) ?? 0;
      const pick = demoAutoPick(draftedSet, teamPts, state.pointCap);
      if (pick) {
        dispatch({ type: 'DEMO_PICK', pokemonName: pick.name, tier: pick.tier });
      }
    }, 300 + Math.random() * 700); // 300-1000ms thinking time

    return () => clearTimeout(delay);
  }, [state.mode, state.demoStarted, currentSlot, isUserTurn, isDemoComplete, demoTeamPoints, draftedSet, state.pointCap]);

  // Auto-pick for user on timer expiry
  useEffect(() => {
    if (state.mode !== 'demo' || !state.demoStarted || !isUserTurn) return;
    if (state.timerSeconds > 0) return;

    // Timer expired for user — auto-pick
    const teamPts = demoTeamPoints.get(state.userTeamId!) ?? 0;
    const pick = demoAutoPick(draftedSet, teamPts, state.pointCap);
    if (pick) {
      dispatch({ type: 'DEMO_PICK', pokemonName: pick.name, tier: pick.tier });
    }
  }, [state.mode, state.demoStarted, isUserTurn, state.timerSeconds, demoTeamPoints, draftedSet, state.pointCap, state.userTeamId]);

  // ─── Live mode: WebSocket connection ──────────────────────────────
  const wsEnabled = state.mode === 'live';

  const { connected: wsConnected, sendPick: wsSendPick } = useDraftWebSocket({
    leagueId: league.id,
    enabled: wsEnabled,
    onState: useCallback((snapshot: ApiDraftState) => {
      dispatch({ type: 'LIVE_SYNC', snapshot });
    }, []),
    onPickMade: useCallback((data) => {
      dispatch({
        type: 'LIVE_PICK_MADE',
        pick: {
          playerId: data.pick.teamId,
          pokemonName: data.pick.pokemonName,
          tier: data.pick.tier,
          round: 0,
          pick: 0,
          overallPick: 0,
          isTeraCaptain: false,
        },
      });
      if (data.snapshot) {
        dispatch({ type: 'LIVE_SYNC', snapshot: data.snapshot });
      }
    }, []),
    onError: useCallback((error: string) => {
      console.error('[Draft WS]', error);
    }, []),
  });

  // Fetch initial draft state when switching to live mode
  useEffect(() => {
    if (state.mode !== 'live') return;
    api.getDraftState(league.id).then(snapshot => {
      if (snapshot.status && snapshot.status !== 'not_started') {
        dispatch({ type: 'LIVE_SYNC', snapshot });
      }
    }).catch(() => {});
  }, [state.mode, league.id]);

  // Live mode: handle user pick via WS
  const handleLivePick = useCallback((pokemonName: string) => {
    if (state.mode !== 'live' || !isUserTurn || !state.userTeamId) return;
    wsSendPick(pokemonName, state.userTeamId);
  }, [state.mode, isUserTurn, state.userTeamId, wsSendPick]);

  // ─── User pick handler ────────────────────────────────────────────
  const handleUserPick = useCallback((pokemonName: string) => {
    if (!isUserTurn) return;

    if (state.mode === 'live') {
      handleLivePick(pokemonName);
      return;
    }

    if (state.mode !== 'demo') return;

    // Validate for demo mode
    if (draftedSet.has(pokemonName)) return;
    if (BANNED_SET.has(pokemonName)) return;

    const entry = TIER_LIST.find(e => e.name === pokemonName);
    if (!entry) return;

    const teamPts = demoTeamPoints.get(state.userTeamId!) ?? 0;
    if (teamPts + entry.tier > state.pointCap) return;

    dispatch({ type: 'DEMO_PICK', pokemonName, tier: entry.tier });
  }, [state.mode, isUserTurn, draftedSet, demoTeamPoints, state.userTeamId, state.pointCap, handleLivePick]);

  // ─── Shared lookups ──────────────────────────────────────────────

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

  // ─── Ownership map ───────────────────────────────────────────────
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

  // ─── Filtered pool ───────────────────────────────────────────────
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
          const hasType = state.filters.types.some(t => types.includes(t));
          if (!hasType) return false;
        }
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

  // ─── Current pick info ───────────────────────────────────────────
  const currentPick = useMemo((): DraftPickEntry | null => {
    if (state.mode === 'season') return null;
    if (!state.demoStarted) return null;
    const slot = state.snakeOrder[state.currentPickIndex];
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
  }, [state.mode, state.demoStarted, state.snakeOrder, state.currentPickIndex]);

  // ─── Team rosters from ownership ─────────────────────────────────
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

  // User's remaining budget for affordability checks
  const userBudgetRemaining = useMemo(() => {
    if (!state.userTeamId) return undefined;
    const spent = teamPoints.get(state.userTeamId) ?? 0;
    return state.pointCap - spent;
  }, [state.userTeamId, teamPoints, state.pointCap]);

  return {
    state,
    dispatch,
    ownershipMap,
    filteredPool,
    poolByTier,
    currentPick,
    teamRosters,
    teamPoints,
    rosterLookup,
    playerLookup,
    isUserTurn,
    isDemoComplete,
    draftOrder,
    handleUserPick,
    draftedSet,
    wsConnected,
    userBudgetRemaining,
  };
}

