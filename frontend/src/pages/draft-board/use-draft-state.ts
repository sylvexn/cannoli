import { useReducer, useMemo, useEffect, useState } from 'react';
import { TIER_LIST } from '@/data/tier-list';
import { getPokemonData } from '@/data/pokemon-data';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { api } from '@/lib/api';
import type { ApiDraftPick } from '@/lib/api';
import type { Player, RosterPokemon } from '@/lib/types';
import { generateDraftOrder, transactionsToTrades } from './generate-draft-order';
import type {
  DraftState, DraftAction, PoolOwnership, Acquisition, DraftPickEntry,
} from './types';

const PICK_TIMER_BASE = 30; // seconds per pick at 1x

function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'SET_MODE': {
      if (action.mode === 'live') {
        return { ...state, mode: 'live', currentPickIndex: 0, isPlaying: false, timerSeconds: PICK_TIMER_BASE, userPicks: {} };
      }
      return { ...state, mode: 'season', currentPickIndex: state.allPicks.length, isPlaying: false };
    }
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode };
    case 'SET_PICK_INDEX':
      return { ...state, currentPickIndex: Math.max(0, Math.min(action.index, state.allPicks.length)) };
    case 'STEP_FORWARD': {
      if (state.currentPickIndex >= state.allPicks.length) return state;
      const nextIndex = state.currentPickIndex + 1;
      // If it's the user's turn, pause
      const nextPick = state.allPicks[nextIndex];
      const shouldPause = nextPick && nextPick.playerId === state.userTeamId;
      return { ...state, currentPickIndex: nextIndex, timerSeconds: PICK_TIMER_BASE, isPlaying: shouldPause ? false : state.isPlaying };
    }
    case 'STEP_BACK':
      return { ...state, currentPickIndex: Math.max(0, state.currentPickIndex - 1), timerSeconds: PICK_TIMER_BASE };
    case 'PLAY':
      return { ...state, isPlaying: true };
    case 'PAUSE':
      return { ...state, isPlaying: false };
    case 'SET_SPEED':
      return { ...state, speed: action.speed };
    case 'TICK_TIMER': {
      if (state.timerSeconds <= 1) {
        // Timer expired — auto-advance
        if (state.currentPickIndex >= state.allPicks.length) {
          return { ...state, isPlaying: false, timerSeconds: 0 };
        }
        const nextIndex = state.currentPickIndex + 1;
        const nextPick = state.allPicks[nextIndex];
        const shouldPause = nextPick && nextPick.playerId === state.userTeamId;
        return {
          ...state,
          currentPickIndex: nextIndex,
          timerSeconds: PICK_TIMER_BASE,
          isPlaying: shouldPause ? false : (nextIndex < state.allPicks.length),
        };
      }
      return { ...state, timerSeconds: state.timerSeconds - 1 };
    }
    case 'USER_PICK': {
      const userPicks = { ...state.userPicks, [state.currentPickIndex]: action.pokemonName };
      const nextIndex = state.currentPickIndex + 1;
      const shouldPlay = nextIndex < state.allPicks.length;
      return { ...state, userPicks, currentPickIndex: nextIndex, timerSeconds: PICK_TIMER_BASE, isPlaying: shouldPlay };
    }
    case 'SET_USER_TEAM':
      return { ...state, userTeamId: action.teamId };
    case 'SELECT_TEAM':
      return { ...state, selectedTeamId: state.selectedTeamId === action.teamId ? null : action.teamId };
    case 'UPDATE_FILTERS':
      return { ...state, filters: { ...state.filters, ...action.filters } };
    case 'SET_DETAIL':
      return { ...state, detailPokemon: action.name };
    case 'RESET_LIVE':
      return { ...state, currentPickIndex: 0, isPlaying: false, timerSeconds: PICK_TIMER_BASE, userPicks: {} };
    case 'SYNC_DATA':
      return {
        ...state,
        allPicks: action.allPicks,
        trades: action.trades,
        currentPickIndex: state.mode === 'season' ? action.allPicks.length : state.currentPickIndex,
      };
    default:
      return state;
  }
}

export function useDraftState() {
  const league = useLeague();
  const { players, standings, transactions } = useLeagueData();
  const [draftPicks, setDraftPicks] = useState<ApiDraftPick[]>([]);

  // Fetch draft picks from API
  useEffect(() => {
    api.getDraftPicks(league.id).then(setDraftPicks);
  }, [league.id]);

  const allPicks = useMemo(
    () => draftPicks.length > 0 ? generateDraftOrder(standings, draftPicks) : [],
    [standings, draftPicks],
  );

  const trades = useMemo(() => transactionsToTrades(transactions), [transactions]);

  const initialState: DraftState = {
    mode: 'season',
    allPicks,
    trades,
    currentPickIndex: allPicks.length, // season mode shows all picks
    isPlaying: false,
    speed: 1,
    timerSeconds: PICK_TIMER_BASE,
    userTeamId: null,
    userPicks: {},
    viewMode: 'grid',
    selectedTeamId: null,
    filters: {
      search: '',
      tierMin: 5,
      tierMax: 20,
      types: [],
      ownership: 'all',
      sortBy: 'tier-desc',
    },
    detailPokemon: null,
  };

  const [state, dispatch] = useReducer(draftReducer, initialState);

  // Sync picks + trades when they load from API
  useEffect(() => {
    if (allPicks.length > 0) {
      dispatch({ type: 'SYNC_DATA', allPicks, trades });
    }
  }, [allPicks, trades]);

  // Timer tick for live mode
  useEffect(() => {
    if (!state.isPlaying || state.mode !== 'live') return;
    const interval = setInterval(() => {
      dispatch({ type: 'TICK_TIMER' });
    }, 1000 / state.speed);
    return () => clearInterval(interval);
  }, [state.isPlaying, state.speed, state.mode]);

  // Build roster lookup: pokemonName → RosterPokemon (from all players' rosters)
  const rosterLookup = useMemo(() => {
    const map = new Map<string, RosterPokemon>();
    for (const player of players) {
      for (const mon of player.roster) {
        map.set(mon.name, mon);
      }
    }
    return map;
  }, [players]);

  // Build player lookup
  const playerLookup = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) map.set(p.id, p);
    return map;
  }, [players]);

  // Ownership map: pokemonName → PoolOwnership
  // In season mode: shows current ownership (draft + trades applied)
  // In live mode: shows ownership up to currentPickIndex
  const ownershipMap = useMemo(() => {
    const map = new Map<string, PoolOwnership>();
    const picksToShow = state.mode === 'season' ? state.allPicks.length : state.currentPickIndex;

    // Apply draft picks
    for (let i = 0; i < picksToShow; i++) {
      const pick = state.allPicks[i];
      const pokemonName = state.userPicks[i] ?? pick.pokemonName;
      map.set(pokemonName, {
        teamId: pick.playerId,
        acquisition: {
          method: 'drafted',
          round: pick.round,
          pick: pick.pick,
        },
      });
    }

    // In season mode, apply trades on top
    if (state.mode === 'season') {
      for (const trade of state.trades) {
        const existing = map.get(trade.pokemonName);
        if (existing) {
          map.set(trade.pokemonName, {
            teamId: trade.toTeamId,
            acquisition: {
              method: 'traded',
              week: trade.week,
              fromTeamId: trade.fromTeamId,
            },
          });
        }
      }
    }

    return map;
  }, [state.allPicks, state.currentPickIndex, state.mode, state.trades, state.userPicks]);

  // Filtered + sorted pool
  const filteredPool = useMemo(() => {
    let pool = TIER_LIST.filter(entry => {
      // Tier range
      if (entry.tier < state.filters.tierMin || entry.tier > state.filters.tierMax) return false;

      // Search
      if (state.filters.search) {
        const q = state.filters.search.toLowerCase();
        if (!entry.name.toLowerCase().includes(q)) return false;
      }

      // Ownership filter
      const owned = ownershipMap.has(entry.name);
      if (state.filters.ownership === 'owned' && !owned) return false;
      if (state.filters.ownership === 'free-agent' && owned) return false;

      // Type filter — cross-reference roster data or pokedex
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

    // Sort
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

  // Group by tier for grid view
  const poolByTier = useMemo(() => {
    const groups = new Map<number, typeof filteredPool>();
    for (const entry of filteredPool) {
      const group = groups.get(entry.tier) ?? [];
      group.push(entry);
      groups.set(entry.tier, group);
    }
    // Sort tiers descending
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [filteredPool]);

  // Current pick info (live mode)
  const currentPick = useMemo((): DraftPickEntry | null => {
    if (state.mode !== 'live') return null;
    return state.allPicks[state.currentPickIndex] ?? null;
  }, [state.mode, state.currentPickIndex, state.allPicks]);

  // Team rosters derived from ownership map
  const teamRosters = useMemo(() => {
    const rosters = new Map<string, { name: string; tier: number; acquisition: Acquisition }[]>();
    for (const p of players) rosters.set(p.id, []);

    for (const [pokemonName, ownership] of ownershipMap) {
      const entry = rosters.get(ownership.teamId);
      const tierEntry = TIER_LIST.find(t => t.name === pokemonName);
      if (entry) {
        entry.push({
          name: pokemonName,
          tier: tierEntry?.tier ?? 0,
          acquisition: ownership.acquisition,
        });
      }
    }

    // Sort each roster by tier descending
    for (const [, roster] of rosters) {
      roster.sort((a, b) => b.tier - a.tier);
    }

    return rosters;
  }, [players, ownershipMap]);

  // Points used per team
  const teamPoints = useMemo(() => {
    const points = new Map<string, number>();
    for (const [teamId, roster] of teamRosters) {
      points.set(teamId, roster.reduce((sum, mon) => sum + mon.tier, 0));
    }
    return points;
  }, [teamRosters]);

  const isUserTurn = state.mode === 'live' && currentPick?.playerId === state.userTeamId;

  // Draft order: worst record picks first (same as generate-draft-order.ts)
  const draftOrder = useMemo(() => [...standings].reverse(), [standings]);

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
    draftOrder,
  };
}
