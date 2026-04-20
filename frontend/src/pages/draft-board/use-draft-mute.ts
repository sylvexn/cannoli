/**
 * Draft cry mute toggle — persisted to localStorage so the user's preference
 * survives reloads. Default unmuted (cry plays for everyone on every pick).
 *
 * The hint flag tracks whether the first-time "Sound on — click to mute" chip
 * has been shown. Once dismissed (or auto-dismissed) it never reappears.
 */

import { useCallback, useEffect, useState } from 'react';

const MUTED_KEY = 'cannoli:draft:muted';
const HINT_KEY = 'cannoli:draft:hint-shown';

function readBool(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function writeBool(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* ignore */ }
}

export function useDraftMute() {
  const [muted, setMuted] = useState<boolean>(() => readBool(MUTED_KEY));
  const [hintShown, setHintShown] = useState<boolean>(() => readBool(HINT_KEY));

  const toggleMuted = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      writeBool(MUTED_KEY, next);
      return next;
    });
  }, []);

  const markHintShown = useCallback(() => {
    setHintShown(true);
    writeBool(HINT_KEY, true);
  }, []);

  // Listen for storage changes from other tabs so a toggle in one window
  // mirrors into the other.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === MUTED_KEY) setMuted(e.newValue === '1');
      if (e.key === HINT_KEY) setHintShown(e.newValue === '1');
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { muted, toggleMuted, hintShown, markHintShown };
}
