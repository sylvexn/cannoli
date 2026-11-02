import { useEffect, useRef, useState } from 'react';
import { isTypingTarget } from './pool-palette';

/**
 * Local open state for the pool palette.
 *  - `turnKey` is the overall pick number while it is the user's turn (else null):
 *    the palette opens each time a new user turn starts and closes when it ends,
 *    so the pick lands visibly on the board.
 *  - `P` toggles it any time (ignored while typing or with modifiers).
 */
export function usePaletteOpen(turnKey: number | null) {
  const [open, setOpen] = useState(false);
  const prevKey = useRef<number | null>(null);

  useEffect(() => {
    const prev = prevKey.current;
    prevKey.current = turnKey;
    if (turnKey != null && turnKey !== prev) setOpen(true);
    else if (turnKey == null && prev != null) setOpen(false);
  }, [turnKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'p' && e.key !== 'P') || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setOpen(o => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return [open, setOpen] as const;
}
