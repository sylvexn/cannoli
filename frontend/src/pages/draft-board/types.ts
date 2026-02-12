import type { PokemonType } from '@/lib/pokemon';

/** Acquisition method for a Pokemon on a team's roster */
export type AcquisitionMethod = 'drafted' | 'traded' | 'free-agent';

/** Tracks how a Pokemon ended up on a team */
export interface Acquisition {
  method: AcquisitionMethod;
  /** Round/pick if drafted */
  round?: number;
  pick?: number;
  /** Week of trade/acquisition */
  week?: number;
  /** Previous owner if traded */
  fromTeamId?: string;
}

/** A single draft pick in the pick sequence */
export interface DraftPickEntry {
  round: number;
  pick: number;
  overallPick: number;
  playerId: string;
  pokemonName: string;
  tier: number;
  isTeraCaptain: boolean;
}

/** Mock trade for season history */
export interface MockTrade {
  week: number;
  fromTeamId: string;
  toTeamId: string;
  pokemonName: string;
}

/** Current ownership info for a Pokemon in the pool */
export interface PoolOwnership {
  teamId: string;
  acquisition: Acquisition;
}

/** Filter state for the pool */
export interface DraftFilters {
  search: string;
  tierMin: number;
  tierMax: number;
  types: PokemonType[];
  ownership: 'all' | 'owned' | 'free-agent';
  sortBy: 'tier-desc' | 'tier-asc' | 'name-asc' | 'name-desc';
}

export const DEFAULT_FILTERS: DraftFilters = {
  search: '',
  tierMin: 5,
  tierMax: 20,
  types: [],
  ownership: 'all',
  sortBy: 'tier-desc',
};

/** Draft state for the page */
export interface DraftState {
  mode: 'season' | 'live';
  allPicks: DraftPickEntry[];
  trades: MockTrade[];
  /** In live mode: how many picks have been made so far (0..allPicks.length) */
  currentPickIndex: number;
  isPlaying: boolean;
  speed: 1 | 2 | 5;
  timerSeconds: number;
  userTeamId: string | null;
  /** User overrides of auto-picks in live mode: pickIndex -> pokemonName */
  userPicks: Record<number, string>;
  viewMode: 'grid' | 'table';
  selectedTeamId: string | null;
  filters: DraftFilters;
  detailPokemon: string | null;
}

export type DraftAction =
  | { type: 'SET_MODE'; mode: 'season' | 'live' }
  | { type: 'SET_VIEW_MODE'; mode: 'grid' | 'table' }
  | { type: 'SET_PICK_INDEX'; index: number }
  | { type: 'STEP_FORWARD' }
  | { type: 'STEP_BACK' }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SET_SPEED'; speed: 1 | 2 | 5 }
  | { type: 'TICK_TIMER' }
  | { type: 'USER_PICK'; pokemonName: string }
  | { type: 'SET_USER_TEAM'; teamId: string | null }
  | { type: 'SELECT_TEAM'; teamId: string | null }
  | { type: 'UPDATE_FILTERS'; filters: Partial<DraftFilters> }
  | { type: 'SET_DETAIL'; name: string | null }
  | { type: 'RESET_LIVE' }
  | { type: 'SYNC_DATA'; allPicks: DraftPickEntry[]; trades: MockTrade[] };
