import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { DraftAction, DraftState } from './types';

/**
 * Derives the timer value to display in the UI.
 *
 * Simulator source: a 1Hz interval dispatches TIMER_TICK so the reducer
 * decrements `state.timerSeconds` directly (and the timer-expiry effect in the
 * auto-pickers hook can react to it).
 *
 * Server source: the server is authoritative; we don't mutate state.timerSeconds
 * client-side. Instead we re-render at 1Hz and re-derive seconds-remaining
 * from `state.liveTimerExpiresAt` so the countdown advances visibly between
 * server syncs without drifting from the deadline.
 */
export function useDraftTimer(state: DraftState, dispatch: Dispatch<DraftAction>) {
  const simTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const isRunning = state.view === 'active' && state.status === 'running';

  // Simulator tick — runs whenever the simulator draft is running and not paused.
  const simTimerActive = state.source === 'simulator' && isRunning && !state.timerPaused
    && state.currentPickIndex < state.snakeOrder.length;

  useEffect(() => {
    if (!simTimerActive) {
      clearInterval(simTimerRef.current);
      return;
    }

    simTimerRef.current = setInterval(() => {
      dispatch({ type: 'TIMER_TICK' });
    }, 1000);

    return () => clearInterval(simTimerRef.current);
  }, [simTimerActive, dispatch]);

  // Server source: timer is server-driven. We re-derive seconds-remaining each
  // tick from the last LIVE_SYNC's timerExpiresAt so we display, not drive, the
  // deadline. We don't dispatch TIMER_TICK here.
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const liveTimerActive = state.source === 'server' && isRunning && !state.timerPaused
    && state.currentPickIndex < state.snakeOrder.length;

  useEffect(() => {
    if (!liveTimerActive) return;
    const interval = setInterval(() => setLiveNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [liveTimerActive]);

  // Display value: clamped seconds-remaining computed from server deadline.
  const liveTimerSeconds = useMemo(() => {
    if (state.source !== 'server' || !state.liveTimerExpiresAt) return state.timerSeconds;
    const ms = new Date(state.liveTimerExpiresAt).getTime() - liveNow;
    return Math.max(0, Math.floor(ms / 1000));
  }, [state.source, state.liveTimerExpiresAt, state.timerSeconds, liveNow]);

  // Effective timerSeconds for UI: server source uses server-derived value, else state.
  const displayTimerSeconds = state.source === 'server' ? liveTimerSeconds : state.timerSeconds;

  return { displayTimerSeconds };
}
