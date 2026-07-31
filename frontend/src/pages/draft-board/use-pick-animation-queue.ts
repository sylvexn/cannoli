/**
 * Serialized animation queue for draft picks.
 *
 * Each enqueued pick walks through:
 *   flying  (450ms) → landing (250ms) → cooldown (150ms) = ~850ms total
 *
 * Two real problems this solves:
 *   1. Batched picks (reconnect catch-up, fast successive auto-picks) collapsing
 *      into one visible event — they now play one at a time.
 *   2. Auto-draft firing the next pick on top of the previous celebration —
 *      auto-pickers gate on `queueIdle` instead of a fixed timeout.
 *
 * The queue is presentational: it does NOT mutate draft state. It only
 * tracks which pick is "currently being celebrated" so consumers (sprite
 * morph, pick-log highlight, aria-live) can render off it.
 *
 * Backlog acceleration: when more than three picks are stacked (e.g. a
 * reconnect dumps the missed picks all at once), each pick collapses to
 * 250ms total and skips the cry, until the backlog drains back down to one.
 *
 * Cries play on the *landing* phase boundary, not on enqueue, so a pile of
 * picks gets cries spaced at the queue cadence rather than overlapping.
 */

import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import * as React from 'react';
import { playCry } from '@/lib/pokemon';

// ViewTransition feature-detect
// React 19.2.4 stable doesn't yet ship the ViewTransition runtime export
// (it lives in canary). Types come from @types/react canary.d.ts so we can
// reference it during typechecking, but at runtime we fall back to
// React.Fragment (which renders children as-is — no morph, just a no-op).
// Phase 2b / a future React upgrade will pick up the real component
// automatically; nothing else needs to change.
type VTComponent = React.ComponentType<{
  name?: string;
  /** Maps to `view-transition-class` on the snapshot pseudo-elements so CSS
   *  can target this transition specifically (`::view-transition-new(.cls)`). */
  className?: string;
  children: React.ReactNode;
}>;
const ReactAny = React as any;
export const ViewTransitionShim: VTComponent =
  ReactAny.ViewTransition ?? React.Fragment as unknown as VTComponent;
export const addPickTransitionType: ((type: string) => void) | null =
  typeof ReactAny.addTransitionType === 'function' ? ReactAny.addTransitionType : null;

export type PickEvent = {
  pokemonName: string;
  tier: number;
  playerId: string;
  overallPick: number;
};

export type AnimationPhase = 'idle' | 'flying' | 'landing' | 'cooldown';

export type PickQueueAPI = {
  enqueue(event: PickEvent): void;
  current: PickEvent | null;
  phase: AnimationPhase;
  /** True when nothing is playing AND nothing is queued — gate for auto-pickers. */
  queueIdle: boolean;
  /** Picks waiting in line (excludes the one currently playing). */
  backlog: number;
};

const PHASE_MS = {
  flying: 450,
  landing: 250,
  cooldown: 150,
} as const;

const FAST_PHASE_MS = {
  flying: 100,
  landing: 100,
  cooldown: 50,
} as const;

const FAST_THRESHOLD = 3; // backlog > this → accelerate
const FAST_RESUME_AT = 1; // drain to ≤ this before normal pace resumes

export function usePickAnimationQueue(opts: { mute?: boolean } = {}): PickQueueAPI {
  const { mute = false } = opts;

  const [current, setCurrent] = useState<PickEvent | null>(null);
  const [phase, setPhase] = useState<AnimationPhase>('idle');
  const [backlog, setBacklog] = useState(0);

  const queueRef = useRef<PickEvent[]>([]);
  const playingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const muteRef = useRef(mute);
  muteRef.current = mute;
  // Track fast-mode separately: enter on backlog > FAST_THRESHOLD, only exit
  // on drain to <= FAST_RESUME_AT — this hysteresis stops us flickering between
  // 250ms / 850ms paces while a queue oscillates around the threshold.
  const fastModeRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      playingRef.current = false;
      // Drain to idle inside startTransition so a final view-transition can
      // fire (sprite landing in its slot) before the next regular setState.
      startTransition(() => {
        setCurrent(null);
        setPhase('idle');
        setBacklog(0);
      });
      fastModeRef.current = false;
      return;
    }

    playingRef.current = true;

    // Decide pace for THIS pick.
    if (queueRef.current.length > FAST_THRESHOLD) {
      fastModeRef.current = true;
    } else if (queueRef.current.length <= FAST_RESUME_AT) {
      fastModeRef.current = false;
    }
    const fast = fastModeRef.current;
    const ms = fast ? FAST_PHASE_MS : PHASE_MS;

    // Wrap in startTransition so React activates the View Transition on the
    // setCurrent → wrapper-swap commit (regular setState does not animate).
    startTransition(() => {
      setBacklog(queueRef.current.length);
      setCurrent(next);
      setPhase('flying');
    });

    clearTimer();
    timerRef.current = setTimeout(() => {
      startTransition(() => setPhase('landing'));
      // Cry plays exactly when the sprite "lands" — skip in fast/catch-up mode
      // so a reconnect doesn't blast 20 cries at once, and skip when muted.
      if (!fast && !muteRef.current && next.pokemonName) {
        playCry(next.pokemonName, 0.15);
      }

      timerRef.current = setTimeout(() => {
        startTransition(() => setPhase('cooldown'));

        timerRef.current = setTimeout(() => {
          // Recurse into the next item (or drain to idle).
          playNext();
        }, ms.cooldown);
      }, ms.landing);
    }, ms.flying);
  }, []);

  const enqueue = useCallback((event: PickEvent) => {
    queueRef.current.push(event);
    if (!playingRef.current) {
      playNext();
    } else {
      setBacklog(queueRef.current.length);
    }
  }, [playNext]);

  // Cleanup timers on unmount — never leak a pending setTimeout into a
  // disposed component.
  useEffect(() => {
    return () => {
      clearTimer();
      playingRef.current = false;
      queueRef.current = [];
    };
  }, []);

  return {
    enqueue,
    current,
    phase,
    // `phase === 'idle'` is set only by playNext() when the queue is fully
    // drained, so it's a sufficient signal for auto-pickers to re-fire.
    queueIdle: phase === 'idle',
    backlog,
  };
}
