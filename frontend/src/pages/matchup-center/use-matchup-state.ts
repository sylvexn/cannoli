import { useReducer, useMemo } from 'react';
import type { RosterPokemon } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';

export interface TeamSource {
  type: 'league' | 'custom';
  leagueId?: string;
  teamId?: string;
  label?: string;
}

export interface SpeedCalcSlot {
  id: string;
  pokemonName: string;
  level: number;
  evs: number;
  ivs: number;
  nature: 'positive' | 'neutral' | 'negative';
  boosts: number;
}

export type MatchupTab = 'overview' | 'typechart' | 'stats' | 'speed' | 'moves';

export interface MatchupState {
  teamA: RosterPokemon[];
  teamB: RosterPokemon[];
  teamASource: TeamSource | null;
  teamBSource: TeamSource | null;
  subTeamA: Set<string>;
  subTeamB: Set<string>;
  activeTab: MatchupTab;
  speedCalcSlots: SpeedCalcSlot[];
}

type MatchupAction =
  | { type: 'SET_TEAM_A'; roster: RosterPokemon[]; source: TeamSource }
  | { type: 'SET_TEAM_B'; roster: RosterPokemon[]; source: TeamSource }
  | { type: 'TOGGLE_SUB_A'; name: string }
  | { type: 'TOGGLE_SUB_B'; name: string }
  | { type: 'SET_TAB'; tab: MatchupTab }
  | { type: 'ADD_SPEED_SLOT' }
  | { type: 'REMOVE_SPEED_SLOT'; id: string }
  | { type: 'UPDATE_SPEED_SLOT'; id: string; updates: Partial<SpeedCalcSlot> }
  | { type: 'RESET_SUB_TEAMS' }
  | { type: 'INIT_SPEED_SLOTS'; teamA: RosterPokemon[]; teamB: RosterPokemon[] };

function toggleInSet(set: Set<string>, name: string, maxSize: number): Set<string> {
  const next = new Set(set);
  if (next.has(name)) {
    next.delete(name);
  } else if (next.size < maxSize) {
    next.add(name);
  }
  return next;
}

function reducer(state: MatchupState, action: MatchupAction): MatchupState {
  switch (action.type) {
    case 'SET_TEAM_A':
      return { ...state, teamA: action.roster, teamASource: action.source, subTeamA: new Set() };
    case 'SET_TEAM_B':
      return { ...state, teamB: action.roster, teamBSource: action.source, subTeamB: new Set() };
    case 'TOGGLE_SUB_A':
      return { ...state, subTeamA: toggleInSet(state.subTeamA, action.name, 6) };
    case 'TOGGLE_SUB_B':
      return { ...state, subTeamB: toggleInSet(state.subTeamB, action.name, 6) };
    case 'SET_TAB':
      return { ...state, activeTab: action.tab };
    case 'ADD_SPEED_SLOT':
      return {
        ...state,
        speedCalcSlots: [...state.speedCalcSlots, {
          id: String(Date.now()),
          pokemonName: '',
          level: 100,
          evs: 252,
          ivs: 31,
          nature: 'positive',
          boosts: 0,
        }],
      };
    case 'REMOVE_SPEED_SLOT':
      return { ...state, speedCalcSlots: state.speedCalcSlots.filter(s => s.id !== action.id) };
    case 'UPDATE_SPEED_SLOT':
      return {
        ...state,
        speedCalcSlots: state.speedCalcSlots.map(s =>
          s.id === action.id ? { ...s, ...action.updates } : s
        ),
      };
    case 'RESET_SUB_TEAMS':
      return { ...state, subTeamA: new Set(), subTeamB: new Set() };
    case 'INIT_SPEED_SLOTS': {
      const pickA = action.teamA.length > 0 ? action.teamA[Math.floor(Math.random() * action.teamA.length)] : null;
      const pickB = action.teamB.length > 0 ? action.teamB[Math.floor(Math.random() * action.teamB.length)] : null;
      const slots: SpeedCalcSlot[] = [];
      if (pickA) slots.push({ id: '1', pokemonName: pickA.name, level: 100, evs: 252, ivs: 31, nature: 'positive', boosts: 0 });
      if (pickB) slots.push({ id: '2', pokemonName: pickB.name, level: 100, evs: 252, ivs: 31, nature: 'positive', boosts: 0 });
      if (slots.length === 0) slots.push({ id: '1', pokemonName: '', level: 100, evs: 252, ivs: 31, nature: 'positive', boosts: 0 });
      return { ...state, speedCalcSlots: slots };
    }
    default:
      return state;
  }
}

function makeInitialSpeedSlots(teamA: RosterPokemon[], teamB: RosterPokemon[]): SpeedCalcSlot[] {
  const pickA = teamA.length > 0 ? teamA[Math.floor(Math.random() * teamA.length)] : null;
  const pickB = teamB.length > 0 ? teamB[Math.floor(Math.random() * teamB.length)] : null;
  const slots: SpeedCalcSlot[] = [];
  if (pickA) slots.push({ id: '1', pokemonName: pickA.name, level: 100, evs: 252, ivs: 31, nature: 'positive', boosts: 0 });
  if (pickB) slots.push({ id: '2', pokemonName: pickB.name, level: 100, evs: 252, ivs: 31, nature: 'positive', boosts: 0 });
  if (slots.length === 0) slots.push({ id: '1', pokemonName: '', level: 100, evs: 252, ivs: 31, nature: 'positive', boosts: 0 });
  return slots;
}

export function useMatchupState() {
  // Try to auto-populate Team A with user's team
  const { user } = useAuth();
  const { leagues } = useAppData();
  const initialTeamA = useMemo(() => {
    if (!user) return { roster: [] as RosterPokemon[], source: null as TeamSource | null };
    // Find user's team in any league (mock: match username to a player)
    for (const league of leagues) {
      if (!league.hasData) continue;
      // In mock data, we just pick the first team for the logged-in user
      // In production, this would check user→team assignment
      const player = league.players[0];
      if (player) {
        return {
          roster: player.roster,
          source: {
            type: 'league' as const,
            leagueId: league.id,
            teamId: player.id,
            label: `${player.teamName} (${league.name.replace(' League', '')})`,
          },
        };
      }
    }
    return { roster: [] as RosterPokemon[], source: null as TeamSource | null };
  }, [user, leagues]);

  const [state, dispatch] = useReducer(reducer, {
    teamA: initialTeamA.roster,
    teamB: [],
    teamASource: initialTeamA.source,
    teamBSource: null,
    subTeamA: new Set<string>(),
    subTeamB: new Set<string>(),
    activeTab: 'overview',
    speedCalcSlots: makeInitialSpeedSlots(initialTeamA.roster, []),
  });

  // Derived: active rosters (sub-team if selected, otherwise full)
  const activeTeamA = useMemo(
    () => state.subTeamA.size > 0
      ? state.teamA.filter(p => state.subTeamA.has(p.name))
      : state.teamA,
    [state.teamA, state.subTeamA],
  );

  const activeTeamB = useMemo(
    () => state.subTeamB.size > 0
      ? state.teamB.filter(p => state.subTeamB.has(p.name))
      : state.teamB,
    [state.teamB, state.subTeamB],
  );

  return { state, dispatch, activeTeamA, activeTeamB };
}
