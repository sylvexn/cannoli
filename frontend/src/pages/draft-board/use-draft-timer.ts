import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { DraftAction, DraftState } from './types';

/**
 * Derives the timer value to display in the UI.
 *
 * Demo mode: a 1Hz interval dispatches DEMO_TICK so the reducer decrements
 * `state.timerSeconds` directly (and the timer-expiry effect in the parent
 * hook can react to it).
 *
 * Live mode: the server is authoritative; we don't mutate state.timerSeconds
 * client-side. Instead we re-render at 1Hz and re-derive seconds-remaining
 * from `state.liveTimerExpiresAt` so the countdown advances visibly between
 * server syncs without drifting from the deadline.
 */
export function useDraftTimer(state: DraftState, dispatch: Dispatch<DraftAction>) {
  const demoTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Timer tick for demo mode — runs whenever draft is active (isPlaying OR user's turn)
  const demoTimerActive = state.mode === 'demo' && state.demoStarted && !state.timerPaused
    && state.currentPickIndex < state.snakeOrder.length;

  useEffect(() => {
    if (!demoTimerActive) {
      clearInterval(demoTimerRef.current);
      return;
    }

    demoTimerRef.current = setInterval(() => {
      dispatch({ type: 'DEMO_TICK' });
    }, 1000);

    return () => clearInterval(demoTimerRef.current);
  }, [demoTimerActive, dispatch]);

  // Live mode: timer is server-driven. We re-derive seconds-remaining each tick
  // from the last LIVE_SYNC's timerExpiresAt so we display, not drive, the deadline.
  // We don't mutate state via DEMO_TICK (that's demo-only); instead we force a
  // re-render at 1Hz so the derived countdown advances visibly between syncs.
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const liveTimerActive = state.mode === 'live' && state.demoStarted && !state.timerPaused
    && state.currentPickIndex < state.snakeOrder.length;

  useEffect(() => {
    if (!liveTimerActive) return;
    const interval = setInterval(() => setLiveNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [liveTimerActive]);

  // Display value: clamped seconds-remaining computed from server deadline.
  const liveTimerSeconds = useMemo(() => {
    if (state.mode !== 'live' || !state.liveTimerExpiresAt) return state.timerSeconds;
    const ms = new Date(state.liveTimerExpiresAt).getTime() - liveNow;
    return Math.max(0, Math.floor(ms / 1000));
  }, [state.mode, state.liveTimerExpiresAt, state.timerSeconds, liveNow]);

  // Effective timerSeconds for UI: live mode uses server-derived value, else state.
  const displayTimerSeconds = state.mode === 'live' ? liveTimerSeconds : state.timerSeconds;

  return { displayTimerSeconds };
}
