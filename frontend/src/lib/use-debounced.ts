/**
 * useDebounced — debounce a fast-changing value (e.g. a search input) so that
 * downstream effects / memos don't re-run on every keystroke.
 *
 * Returns a value that lags `value` by `ms` milliseconds. The first render
 * returns the initial value immediately (no delay) so initial paints don't
 * flicker through an empty debounced state.
 */

import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, ms: number = 200): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);

  return debounced;
}
