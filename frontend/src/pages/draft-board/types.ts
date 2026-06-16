import type { PokemonType } from '@/lib/pokemon';
import type { SearchChip } from '@/lib/pool-search';

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
  /** Broad-OR free text — matches Pokemon name, ability, or learned move. */
  search: string;
  tierMin: number;
  tierMax: number;
  types: PokemonType[];
  /** When multiple types selected: 'or' = has either type, 'and' = has both types */
  typeMode: 'or' | 'and';
  /** Refine chips: stacked exact filters (AND) for a specific Pokemon, ability,
   *  or move chosen from the unified search dropdown. Layered on top of the
   *  broad-OR `search` free text. */
  searchChips: SearchChip[];
  ownership: 'all' | 'owned' | 'free-agent';
  /** When true (active draft only), hide Pokemon whose tier exceeds the user's
   *  current effective budget (raw remaining minus min-cost reserve for
   *  remaining picks). Captain markup is treated as a soft warning, not a filter. */
  affordableOnly: boolean;
  sortBy: 'tier-desc' | 'tier-asc' | 'name-asc' | 'name-desc';
}

export const DEFAULT_FILTERS: DraftFilters = {
  search: '',
  tierMin: 5,
  tierMax: 20,
  types: [],
  typeMode: 'or',
  searchChips: [],
  ownership: 'all',
  affordableOnly: false,
  sortBy: 'tier-desc',
};

/**
 * Three orthogonal axes that replace the old `mode: 'season'|'demo'|'live'`:
 *
 * - `view`:   what the user is looking at — historical season recap vs. an
 *             active draft (current or future).
 * - `status`: where the active draft is in its lifecycle.
 * - `source`: which engine drives an active draft — server (WS-backed live) or
 *             simulator (client-side practice).
 *
 * `view === 'history'` always implies `status === 'idle'` and ignores `source`.
 */
export type DraftView = 'history' | 'active';
export type DraftStatus = 'idle' | 'configuring' | 'running' | 'complete';
export type DraftSource = 'server' | 'simulator';

/** Draft state for the page */
export interface DraftState {
  view: DraftView;
  status: DraftStatus;
  source: DraftSource;
  /** History view: historical picks. Active view: picks made so far. */
  allPicks: DraftPickEntry[];
  /** History view only: trades to overlay on draft ownership */
  trades: MockTrade[];
  /** Snake draft slot sequence (active view) */
  snakeOrder: SnakeSlot[];
  /** In active view: how many picks have been made (0..totalPicks) */
  currentPickIndex: number;
  speed: 1 | 2 | 5;
  timerSeconds: number;
  timerDuration: number;
  timerPaused: boolean;
  userTeamId: string | null;
  viewMode: 'grid' | 'table';
  selectedTeamId: string | null;
  filters: DraftFilters;
  detailPokemon: string | null;
  /** Point cap for validation */
  pointCap: number;
  /** Queued Pokemon names the user wants to draft (max 3, priority order) */
  draftQueue: string[];
  /** Auto-draft the first available queued Pokemon when it's user's turn */
  autoDraftQueue: boolean;
  /** Server-source only: server-broadcast deadline (ISO). UI derives countdown from this. */
  liveTimerExpiresAt: string | null;
}

export type DraftAction =
  | { type: 'SET_VIEW'; view: DraftView; source?: DraftSource }
  | { type: 'SET_VIEW_MODE'; mode: 'grid' | 'table' }
  | { type: 'SELECT_TEAM'; teamId: string | null }
  | { type: 'UPDATE_FILTERS'; filters: Partial<DraftFilters> }
  | { type: 'SET_DETAIL'; name: string | null }
  // History view: sync historical data
  | { type: 'SYNC_DATA'; allPicks: DraftPickEntry[]; trades: MockTrade[] }
  // Active draft lifecycle
  | { type: 'DRAFT_START'; snakeOrder: SnakeSlot[]; userTeamId: string; timerDuration: number; pointCap: number }
  | { type: 'PICK_LANDED'; pokemonName: string; tier: number; playerId?: string }
  | { type: 'TIMER_TICK' }
  | { type: 'DRAFT_RESET' }
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
  // Server-source authoritative snapshot
  | { type: 'LIVE_SYNC'; snapshot: import('@/lib/api').ApiDraftState };
