import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { mapLeagues } from '@/lib/app-data-context';
import type { League } from '@/lib/types';

/** Leagues across EVERY season (incl. archived) — rulesets + the past-teams browser. */
let cache: Promise<League[]> | null = null;

function load(): Promise<League[]> {
  cache ??= api.getLeagues(true).then(mapLeagues).catch(err => { cache = null; throw err; });
  return cache;
}

export function useAllLeagues(): { leagues: League[]; loading: boolean } {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    load()
      .then(l => { if (!cancelled) setLeagues(l); })
      .catch(() => { /* leave empty: the default ruleset still works */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return { leagues, loading };
}
