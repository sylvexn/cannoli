/**
 * Draft cry mute toggle — persisted to localStorage so the user's preference
 * survives reloads. Default unmuted (cry plays for everyone on every pick).
 *
 * Same-tab toggles broadcast through a module-level subscriber set so multiple
 * call-sites of this hook (e.g. the top-bar mute button + the animation queue's
 * cry gate) stay in sync. Cross-tab changes still arrive via the 'storage'
 * event listener, which DOES fire only across tabs per the HTML spec.
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

let currentMuted = readBool(MUTED_KEY);
let currentHint = readBool(HINT_KEY);
const mutedSubs = new Set<(v: boolean) => void>();
const hintSubs = new Set<(v: boolean) => void>();

function broadcastMuted(value: boolean) {
  if (currentMuted === value) return;
  currentMuted = value;
  writeBool(MUTED_KEY, value);
  mutedSubs.forEach(cb => cb(value));
}

function broadcastHint(value: boolean) {
  if (currentHint === value) return;
  currentHint = value;
  writeBool(HINT_KEY, value);
  hintSubs.forEach(cb => cb(value));
}

export function useDraftMute() {
  const [muted, setMuted] = useState<boolean>(() => currentMuted);
  const [hintShown, setHintShown] = useState<boolean>(() => currentHint);

  useEffect(() => {
    mutedSubs.add(setMuted);
    hintSubs.add(setHintShown);
    function onStorage(e: StorageEvent) {
      if (e.key === MUTED_KEY) broadcastMuted(e.newValue === '1');
      if (e.key === HINT_KEY) broadcastHint(e.newValue === '1');
    }
    window.addEventListener('storage', onStorage);
    return () => {
      mutedSubs.delete(setMuted);
      hintSubs.delete(setHintShown);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const toggleMuted = useCallback(() => {
    broadcastMuted(!currentMuted);
  }, []);

  const markHintShown = useCallback(() => {
    broadcastHint(true);
  }, []);

  return { muted, toggleMuted, hintShown, markHintShown };
}
