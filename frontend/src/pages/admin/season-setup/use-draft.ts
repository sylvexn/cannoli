import { useEffect, useRef, useState } from 'react';
import type { Draft } from './logic';

const KEY = 'cannoli:season-setup-draft';

function load(valid: (d: Draft) => boolean): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (d && d.v === 1 && Array.isArray(d.leagues) && valid(d)) return d;
    if (d) localStorage.removeItem(KEY); // stale / unusable: drop it
  } catch { /* corrupt JSON: treat as none */ }
  return null;
}

/**
 * Draft state autosaved to localStorage once it differs from the fresh draft.
 * `init` builds the fresh draft; `valid` rejects a saved draft that no longer fits the server defaults.
 */
export function useDraft(init: () => Draft, valid: (d: Draft) => boolean) {
  const [boot] = useState(() => {
    const fresh = init();
    const saved = load(valid);
    return { saved, draft: saved ?? fresh, baseline: JSON.stringify(fresh) };
  });
  const [restored, setRestored] = useState(!!boot.saved);
  const [draft, setDraft] = useState<Draft>(boot.draft);
  const dead = useRef(false);

  useEffect(() => {
    if (dead.current || JSON.stringify(draft) === boot.baseline) return;
    try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch { /* quota: draft just won't persist */ }
  }, [draft, boot.baseline]);

  return {
    draft,
    patch: (p: Partial<Draft>) => setDraft(d => ({ ...d, ...p })),
    restored,
    discard: () => { localStorage.removeItem(KEY); setDraft(init()); setRestored(false); },
    clear: () => { dead.current = true; localStorage.removeItem(KEY); },
  };
}
