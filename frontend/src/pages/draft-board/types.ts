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

/** A slot in the snake-draft order (before a pick is made) */
export interface SnakeSlot {
  round: number;
  pick: number;
  overallPick: number;
  teamId: string;
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

/**
 * Draft modes:
 * - season: historical view of completed draft + trades
 * - demo: client-side simulated draft with AI auto-picks
 * - live: real-time draft via WebSocket (future)
 */
export type DraftMode = 'season' | 'demo' | 'live';

/** Draft state for the page */
export interface DraftState {
  mode: DraftMode;
  /** Season mode: historical picks. Demo/live: picks made so far. */
  allPicks: DraftPickEntry[];
  /** Season mode only: trades to overlay on draft ownership */
  trades: MockTrade[];
  /** Snake draft slot sequence (demo/live mode) */
  snakeOrder: SnakeSlot[];
  /** In demo/live: how many picks have been made (0..totalPicks) */
  currentPickIndex: number;
  isPlaying: boolean;
  speed: 1 | 2 | 5;
  timerSeconds: number;
  timerDuration: number;
  timerPaused: boolean;
  userTeamId: string | null;
  viewMode: 'grid' | 'table';
  selectedTeamId: string | null;
  filters: DraftFilters;
  detailPokemon: string | null;
  /** Demo mode: whether the draft has started */
  demoStarted: boolean;
  /** Point cap for validation */
  pointCap: number;
  /** Queued Pokemon names the user wants to draft (max 3, priority order) */
  draftQueue: string[];
  /** Auto-draft the first available queued Pokemon when it's user's turn */
  autoDraftQueue: boolean;
}

export type DraftAction =
  | { type: 'SET_MODE'; mode: DraftMode }
  | { type: 'SET_VIEW_MODE'; mode: 'grid' | 'table' }
  | { type: 'SELECT_TEAM'; teamId: string | null }
  | { type: 'UPDATE_FILTERS'; filters: Partial<DraftFilters> }
  | { type: 'SET_DETAIL'; name: string | null }
  // Season mode: sync historical data
  | { type: 'SYNC_DATA'; allPicks: DraftPickEntry[]; trades: MockTrade[] }
  // Demo mode actions
  | { type: 'DEMO_START'; snakeOrder: SnakeSlot[]; userTeamId: string; timerDuration: number; pointCap: number }
  | { type: 'DEMO_PICK'; pokemonName: string; tier: number }
  | { type: 'DEMO_TICK' }
  | { type: 'DEMO_RESET' }
  | { type: 'SET_USER_TEAM'; teamId: string | null }
  // Timer controls (admin/dev)
  | { type: 'SET_TIMER_DURATION'; duration: number }
  | { type: 'PAUSE_TIMER' }
  | { type: 'RESUME_TIMER' }
  | { type: 'ADD_TIME'; seconds: number }
  // Draft queue
  | { type: 'QUEUE_ADD'; name: string }
  | { type: 'QUEUE_REMOVE'; name: string }
  | { type: 'QUEUE_REORDER'; queue: string[] }
  | { type: 'TOGGLE_AUTO_DRAFT_QUEUE' }
  // Live mode actions (future)
  | { type: 'LIVE_SYNC'; snapshot: import('@/lib/api').ApiDraftState }
  | { type: 'LIVE_PICK_MADE'; pick: DraftPickEntry };
