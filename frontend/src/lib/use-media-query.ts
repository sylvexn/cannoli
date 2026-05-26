/**
 * useMediaQuery — subscribe to a CSS media query.
 *
 * Returns `true` whenever the query currently matches. Designed for layout
 * mode switching (e.g. drawer / rail / pinned sidebar across breakpoints).
 *
 * On SSR / before hydration the initial value is `false`. Consumers that need
 * a different default should branch on it themselves.
 */

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    // Sync once in case the value changed between SSR and mount.
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
