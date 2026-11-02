import { useEffect, useRef, useState } from 'react';
import type { Draft } from './logic';

const KEY = 'cannoli:season-setup-draft';

function load(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return d && d.v === 1 && Array.isArray(d.leagues) ? d : null;
  } catch { return null; }
}

/** Draft state autosaved to localStorage; `init` runs only when nothing is saved. */
export function useDraft(init: () => Draft) {
  const saved = useRef(load());
  const [restored, setRestored] = useState(!!saved.current);
  const [draft, setDraft] = useState<Draft>(() => saved.current ?? init());
  const dead = useRef(false);

  useEffect(() => {
    if (dead.current) return;
    try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch { /* quota: draft just won't persist */ }
  }, [draft]);

  return {
    draft,
    patch: (p: Partial<Draft>) => setDraft(d => ({ ...d, ...p })),
    restored,
    discard: () => { localStorage.removeItem(KEY); setDraft(init()); setRestored(false); },
    clear: () => { dead.current = true; localStorage.removeItem(KEY); },
  };
}
