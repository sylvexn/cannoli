import { useCallback, useEffect, useState } from 'react';
import { fetchJson, mutateJson, api } from '@/lib/api';
import type { Player } from '@/lib/types';

export interface DraftOrderHistoryEntry {
  actor: string;
  at: string;
  order: string[];
  locked: boolean | null;
}

/** Fisher-Yates using crypto.getRandomValues (rejection sampling avoids modulo bias). */
export function shuffled<T>(items: readonly T[]): T[] {
  const a = [...items];
  const buf = new Uint32Array(1);
  for (let i = a.length - 1; i > 0; i--) {
    const range = i + 1;
    const limit = Math.floor(0xffffffff / range) * range;
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    const j = buf[0] % range;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pick numbers (1-based overall) for a 1-based seat in an N-team snake. */
export function snakePicks(seat: number, teams: number, rounds: number): number[] {
  return Array.from({ length: rounds }, (_, r) => r * teams + (r % 2 === 0 ? seat : teams + 1 - seat));
}

export function useDraftOrderApi(leagueId: string) {
  const save = useCallback(
    (order: string[], locked: boolean) =>
      mutateJson<{ success: true; draftOrderLocked: boolean }>(
        'POST', `/api/leagues/${leagueId}/draft-order`, { order, locked },
      ),
    [leagueId],
  );
  const loadHistory = useCallback(
    () => fetchJson<DraftOrderHistoryEntry[]>(`/api/leagues/${leagueId}/draft-order/history`),
    [leagueId],
  );
  return { save, loadHistory };
}

/**
 * Previous-season reverse standings: worst finisher picks first. Matches teams
 * to last season's by coach name within the same-named league. Resolves to
 * `null` when no previous season / league / usable finish data exists.
 */
export function usePrevSeasonReverse(leagueName: string, seasonNumber: number | undefined, teams: Player[]) {
  const [finish, setFinish] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    if (!seasonNumber) return;
    let off = false;
    (async () => {
      try {
        const seasons = await api.getSeasons();
        const prev = seasons.find(s => s.seasonNumber === seasonNumber - 1);
        if (!prev) return;
        const leagues = await api.getSeasonLeagues(prev.id);
        const lg = leagues.find(l => l.name.toLowerCase() === leagueName.toLowerCase());
        if (!lg) return;
        const m = new Map<string, number>();
        for (const t of lg.teams) {
          if (t.finishPosition != null) m.set(t.coachName.toLowerCase(), t.finishPosition);
        }
        if (!off && m.size) setFinish(m);
      } catch { /* button simply stays hidden */ }
    })();
    return () => { off = true; };
  }, [leagueName, seasonNumber]);

  const key = (p: Player) => [p.owner?.username, p.owner?.displayName, p.name].map(s => s?.toLowerCase());
  const pos = (p: Player) => {
    for (const k of key(p)) if (k && finish?.has(k)) return finish.get(k)!;
    return null;
  };
  const matched = finish ? teams.filter(t => pos(t) != null).length : 0;
  if (!finish || matched < Math.ceil(teams.length / 2)) return null;
  // Worst finish (largest position) first; unmatched teams (new coaches) go last.
  return () => [...teams].sort((a, b) => (pos(b) ?? -1) - (pos(a) ?? -1)).map(t => t.id);
}
