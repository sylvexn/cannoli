import type { PersistedState, QueueEntry, StreamPhase } from './stream-types';

/**
 * Single source of truth for the broadcast cockpit's state machine.
 *
 * Slices that genuinely move together (queue, phase, modals, persisted
 * preferences) live here. Pure scratch UI — drag-hover index, idle-fade
 * visibility — stays as useState in the component because it doesn't
 * interact with anything else in the machine.
 */
export interface StreamState {
  entries: QueueEntry[];
  loading: boolean;
  streamMode: 'lobby' | 'live';
  phase: StreamPhase;
  activeIndex: number;
  featured: Set<string>;
  prerollDelayMs: number;
  prerollHeld: boolean;
  showLowerThird: boolean;
  resumePromptOpen: boolean;
  pendingState: PersistedState | null;
  endConfirmOpen: boolean;
}

export const initialStreamState: StreamState = {
  entries: [],
  loading: true,
  streamMode: 'lobby',
  phase: 'preroll',
  activeIndex: 0,
  featured: new Set<string>(),
  prerollDelayMs: 5000,
  prerollHeld: false,
  showLowerThird: false,
  resumePromptOpen: false,
  pendingState: null,
  endConfirmOpen: false,
};

export type StreamAction =
  | { type: 'start-loading' }
  | { type: 'entries-loaded'; entries: QueueEntry[] }
  | { type: 'prompt-resume'; pending: PersistedState }
  | { type: 'apply-persisted-order'; persisted: PersistedState }
  | { type: 'accept-resume' }
  | { type: 'decline-resume' }
  | { type: 'set-resume-open'; open: boolean }
  | { type: 'set-end-confirm-open'; open: boolean }
  | { type: 'start-stream' }
  | { type: 'next-match' }
  | { type: 'prev-match' }
  | { type: 'set-phase'; phase: StreamPhase }
  | { type: 'replay-preroll' }
  | { type: 'set-preroll-held'; held: boolean }
  | { type: 'toggle-preroll-held' }
  | { type: 'toggle-lower-third' }
  | { type: 'toggle-featured'; id: string }
  | { type: 'set-preroll-delay'; delayMs: number }
  | { type: 'reorder-entries'; from: number; to: number }
  | { type: 'end-stream' };

function reorder(entries: QueueEntry[], state: PersistedState): QueueEntry[] {
  const map = new Map(entries.map(e => [e.id, e]));
  const out: QueueEntry[] = [];
  for (const id of state.order) {
    const e = map.get(id);
    if (e) {
      out.push(e);
      map.delete(id);
    }
  }
  for (const remaining of map.values()) out.push(remaining);
  return out;
}

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case 'start-loading':
      return { ...state, loading: true };

    case 'entries-loaded':
      return { ...state, entries: action.entries, loading: false };

    case 'prompt-resume':
      return { ...state, pendingState: action.pending, resumePromptOpen: true };

    case 'apply-persisted-order':
      return {
        ...state,
        entries: reorder(state.entries, action.persisted),
        featured: new Set(action.persisted.featured),
        prerollDelayMs: action.persisted.prerollDelayMs,
      };

    case 'accept-resume': {
      if (!state.pendingState) return state;
      return {
        ...state,
        entries: reorder(state.entries, state.pendingState),
        featured: new Set(state.pendingState.featured),
        prerollDelayMs: state.pendingState.prerollDelayMs,
        activeIndex: state.pendingState.index,
        phase: 'preroll',
        streamMode: 'live',
        resumePromptOpen: false,
        pendingState: null,
      };
    }

    case 'decline-resume': {
      const next: StreamState = {
        ...state,
        resumePromptOpen: false,
        pendingState: null,
      };
      if (state.pendingState) {
        next.entries = reorder(state.entries, state.pendingState);
        next.featured = new Set(state.pendingState.featured);
        next.prerollDelayMs = state.pendingState.prerollDelayMs;
      }
      return next;
    }

    case 'set-resume-open':
      return { ...state, resumePromptOpen: action.open };

    case 'set-end-confirm-open':
      return { ...state, endConfirmOpen: action.open };

    case 'start-stream':
      if (state.entries.length === 0) return state;
      return {
        ...state,
        activeIndex: 0,
        phase: 'preroll',
        prerollHeld: false,
        streamMode: 'live',
      };

    case 'next-match':
      if (state.activeIndex >= state.entries.length - 1) return state;
      return {
        ...state,
        activeIndex: state.activeIndex + 1,
        phase: 'preroll',
        prerollHeld: false,
      };

    case 'prev-match':
      if (state.activeIndex === 0) return state;
      return {
        ...state,
        activeIndex: state.activeIndex - 1,
        phase: 'preroll',
        prerollHeld: false,
      };

    case 'set-phase':
      return { ...state, phase: action.phase };

    case 'replay-preroll':
      return { ...state, phase: 'preroll', prerollHeld: false };

    case 'set-preroll-held':
      return { ...state, prerollHeld: action.held };

    case 'toggle-preroll-held':
      return { ...state, prerollHeld: !state.prerollHeld };

    case 'toggle-lower-third':
      return { ...state, showLowerThird: !state.showLowerThird };

    case 'toggle-featured': {
      const next = new Set(state.featured);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, featured: next };
    }

    case 'set-preroll-delay':
      return { ...state, prerollDelayMs: action.delayMs };

    case 'reorder-entries': {
      const { from, to } = action;
      if (from === to || from < 0 || to < 0 || from >= state.entries.length) return state;
      const next = state.entries.slice();
      const [moved] = next.splice(from, 1);
      if (!moved) return state;
      next.splice(to, 0, moved);
      return { ...state, entries: next };
    }

    case 'end-stream':
      return { ...state, endConfirmOpen: false, streamMode: 'lobby' };

    default:
      return state;
  }
}
