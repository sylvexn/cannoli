/**
 * useLocalStorageState — useState-style hook backed by localStorage.
 *
 * Reads the initial value from localStorage on mount (falling back to
 * `initial` if missing or unparseable), and persists every update. Listens for
 * cross-tab `storage` events so multiple windows stay in sync. Designed to
 * mirror the pattern used in `pages/draft-board/use-draft-mute.ts`.
 */

import { useCallback, useEffect, useState } from 'react';

function read<T>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return initial;
    return JSON.parse(raw) as T;
  } catch {
    return initial;
  }
}

function write<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export function useLocalStorageState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, initial));

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      write(key, resolved);
      return resolved;
    });
  }, [key]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== key) return;
      if (e.newValue == null) { setValue(initial); return; }
      try { setValue(JSON.parse(e.newValue) as T); } catch { /* ignore */ }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, set];
}
