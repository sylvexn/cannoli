import type { DraftAction, DraftPickEntry, DraftState, SnakeSlot } from './types';
import { DEFAULT_FILTERS } from './types';

/**
 * Central reducer for the draft board.
 *
 * State model is three orthogonal axes (see types.ts):
 *   - view:   'history' | 'active'
 *   - status: 'idle' | 'configuring' | 'running' | 'complete'
 *   - source: 'server' | 'simulator'
 *
 * Notable transitions:
 *   - SET_VIEW history    → status='idle'
 *   - SET_VIEW active     → status='configuring' (clears any previous draft state)
 *   - DRAFT_START         → status='running'
 *   - PICK_LANDED final   → status='complete' (when last snake slot fills)
 *   - DRAFT_RESET         → status='configuring'
 *
 * PICK_LANDED is the unified pick action — both client-side simulator picks and
 * server-confirmed (WS) picks dispatch the same action; only the action source
 * differs, never the reducer behavior.
 */
export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'SET_VIEW': {
      if (action.view === 'history') {
        return {
          ...state,
          view: 'history',
          status: 'idle',
          filters: DEFAULT_FILTERS,
        };
      }
      // Active view: reset any previous draft state. The page will re-hydrate
      // (LIVE_SYNC for server source, or DRAFT_START dispatch for simulator).
      return {
        ...state,
        view: 'active',
        status: 'configuring',
        source: action.source ?? state.source,
        allPicks: [],
        snakeOrder: [],
        currentPickIndex: 0,
        timerSeconds: state.timerDuration,
        timerPaused: false,
        draftQueue: [],
        liveTimerExpiresAt: null,
      };
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

    // ─── History view: sync season data ───────────────────────────────
    case 'SYNC_DATA':
      // Trades are always tracked (the team sidebar surfaces them outside an
      // active draft too), but historical picks must NEVER overwrite an active
      // draft's picks — that would clobber the simulator/server state.
      if (state.view !== 'history') {
        return { ...state, trades: action.trades };
      }
      return {
        ...state,
        allPicks: action.allPicks,
        trades: action.trades,
        currentPickIndex: action.allPicks.length,
      };

    // ─── Active draft lifecycle ───────────────────────────────────────
    case 'DRAFT_START':
      return {
        ...state,
        view: 'active',
        status: 'running',
        snakeOrder: action.snakeOrder,
        userTeamId: action.userTeamId,
        timerDuration: action.timerDuration,
        timerSeconds: action.timerDuration,
        pointCap: action.pointCap,
        allPicks: [],
        currentPickIndex: 0,
        timerPaused: false,
        // Auto-switch to free-agent filter for drafting
        filters: { ...state.filters, ownership: 'free-agent' },
      };

    case 'PICK_LANDED': {
      const slot = state.snakeOrder[state.currentPickIndex];
      if (!slot) return state;

      const newPick: DraftPickEntry = {
        round: slot.round,
        pick: slot.pick,
        overallPick: slot.overallPick,
        playerId: action.playerId ?? slot.teamId,
        pokemonName: action.pokemonName,
        tier: action.tier,
        isTeraCaptain: false,
      };

      const newPicks = [...state.allPicks, newPick];
      const nextIndex = state.currentPickIndex + 1;
      const isComplete = nextIndex >= state.snakeOrder.length;

      return {
        ...state,
        allPicks: newPicks,
        currentPickIndex: nextIndex,
        timerSeconds: state.timerDuration,
        status: isComplete ? 'complete' : state.status,
        // Remove drafted Pokemon from queue
        draftQueue: state.draftQueue.filter(n => n !== action.pokemonName),
      };
    }

    case 'TIMER_TICK': {
      if (state.timerSeconds <= 1) {
        // Timer expired — auto-pick effects react to timerSeconds === 0
        return { ...state, timerSeconds: 0 };
      }
      return { ...state, timerSeconds: state.timerSeconds - 1 };
    }

    case 'DRAFT_RESET':
      return {
        ...state,
        status: 'configuring',
        allPicks: [],
        currentPickIndex: 0,
        snakeOrder: [],
        timerSeconds: state.timerDuration,
        timerPaused: false,
        draftQueue: [],
        liveTimerExpiresAt: null,
      };

    // ─── Server-source authoritative sync (WS / state fetch) ───────────
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

      // Translate server status → client status enum.
      let status: DraftState['status'] = state.status;
      if (snap.status === 'in_progress') status = 'running';
      else if (snap.status === 'completed') status = 'complete';
      else if (snap.status === 'not_started') status = 'configuring';

      return {
        ...state,
        view: 'active',
        source: 'server',
        status,
        snakeOrder,
        allPicks,
        currentPickIndex: snap.currentPickIndex,
        timerDuration: snap.timerDuration,
        timerSeconds,
        liveTimerExpiresAt: snap.timerExpiresAt ?? null,
        pointCap: 110,
      };
    }

    // ─── Timer controls (admin/dev) ──────────────────────────────────
    case 'SET_TIMER_DURATION': {
      const draftActive = state.view === 'active' && state.status !== 'idle' && state.status !== 'configuring';
      return {
        ...state,
        timerDuration: action.duration,
        timerSeconds: draftActive ? state.timerSeconds : action.duration,
      };
    }

    case 'PAUSE_TIMER':
      return { ...state, timerPaused: true };

    case 'RESUME_TIMER':
      return { ...state, timerPaused: false };

    case 'ADD_TIME':
      return { ...state, timerSeconds: state.timerSeconds + action.seconds };

    // ─── Draft queue ──────────────────────────────────────────────────
    case 'QUEUE_ADD': {
      if (state.draftQueue.length >= 3 || state.draftQueue.includes(action.name)) return state;
      return { ...state, draftQueue: [...state.draftQueue, action.name] };
    }

    case 'QUEUE_REMOVE':
      return { ...state, draftQueue: state.draftQueue.filter(n => n !== action.name) };

    case 'QUEUE_REORDER':
      return { ...state, draftQueue: action.queue };

    case 'TOGGLE_AUTO_DRAFT_QUEUE':
      return { ...state, autoDraftQueue: !state.autoDraftQueue };

    default:
      return state;
  }
}

/** Snake order generation (client-side) — used by simulator start path. */
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
