/**
 * usePointerTilt — pointer-tracked 3D tilt for the sidebar league gems.
 *
 * Returns handlers to spread on the element that should tilt (the `.league-banner`
 * inside a `.gem-3d` wrapper). On move it writes `--mx`/`--my` (0–1, relative to
 * the element) and adds `.tilt`; CSS turns that into a `rotateX/rotateY` and a
 * specular highlight at the cursor (see the `.gem-3d` block in index.css).
 *
 * Under `prefers-reduced-motion` it returns no handlers — the gem stays flat
 * (CSS also nulls the transform as a second guard). This is a cheap, hover-only
 * effect (no continuous loop), so it is NOT gated on GPU tier.
 */

import { useMemo } from 'react';
import type { PointerEvent } from 'react';
import { useMediaQuery } from './use-media-query';

export interface PointerTiltHandlers {
  onPointerMove?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
}

export function usePointerTilt(): PointerTiltHandlers {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  return useMemo<PointerTiltHandlers>(() => {
    if (reduced) return {};
    return {
      onPointerMove(e) {
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        el.style.setProperty('--mx', ((e.clientX - r.left) / r.width).toFixed(3));
        el.style.setProperty('--my', ((e.clientY - r.top) / r.height).toFixed(3));
        if (!el.classList.contains('tilt')) el.classList.add('tilt');
      },
      onPointerLeave(e) {
        const el = e.currentTarget;
        el.style.removeProperty('--mx');
        el.style.removeProperty('--my');
        el.classList.remove('tilt');
      },
    };
  }, [reduced]);
}
