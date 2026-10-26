import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api, type ApiPatch } from './api';
import { useAuth } from './auth-context';

/**
 * Shared patch-notes store: one fetch feeds the sidebar badge and the
 * /patch-notes page, and marking seen updates both. Unread = published
 * top-level patches dated after the seen stamp (server `changelog_seen_at`
 * for users, localStorage for guests).
 */
const GUEST_KEY = 'cannoli:changelogSeenAt';

interface State { patches: ApiPatch[]; seenAt: string | null; loaded: boolean }
let state: State = { patches: [], seenAt: null, loaded: false };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getState = () => state;

function readGuestStamp(): string | null {
  try { return localStorage.getItem(GUEST_KEY); } catch { return null; }
}

export function usePatchNotes() {
  const { user } = useAuth();
  const s = useSyncExternalStore(subscribe, getState);
  const userId = user?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    api.getPatchNotes()
      .then(res => {
        if (cancelled) return;
        set({ patches: res.patches, seenAt: userId ? res.lastSeenAt : readGuestStamp(), loaded: true });
      })
      .catch(() => { if (!cancelled) set({ loaded: true }); });
    return () => { cancelled = true; };
  }, [userId]);

  const unread = s.patches.filter(p => !s.seenAt || p.date > s.seenAt).length;

  const markSeen = useCallback(() => {
    const newest = state.patches[0]?.date ?? '';
    const now = new Date().toISOString();
    const stamp = newest > now ? newest : now;
    if (userId) {
      api.markChangelogSeen().then(r => set({ seenAt: r.seenAt })).catch(() => {});
    } else {
      try { localStorage.setItem(GUEST_KEY, stamp); } catch { /* ignore */ }
      set({ seenAt: stamp });
    }
  }, [userId]);

  return { patches: s.patches, seenAt: s.seenAt, loaded: s.loaded, unread, markSeen };
}
