/**
 * Resolves team IDs (e.g. `s1-sapphire-t2`) to human-readable team info.
 *
 * Admin surfaces (Matches list, match action dialogs) deal in raw team IDs
 * because the match payload only carries IDs. This hook eagerly loads every
 * league's team roster once and exposes a synchronous resolver so those
 * surfaces can render team names instead of IDs.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useAppData } from './app-data-context';

export interface ResolvedTeam {
  id: string;
  leagueId: string;
  name: string;
  abbrev: string;
  color: string;
}

export interface TeamNameResolver {
  /** Resolved team for an ID, or null if not yet loaded / unknown. */
  get: (teamId: string | null | undefined) => ResolvedTeam | null;
  /** Display name for an ID — falls back to the raw ID when unresolved. */
  name: (teamId: string | null | undefined) => string;
  /** All resolved teams in a league, sorted by name (for team selectors). */
  list: (leagueId: string | null | undefined) => ResolvedTeam[];
  loading: boolean;
}

export function useTeamNames(): TeamNameResolver {
  const { leagues } = useAppData();
  const [teams, setTeams] = useState<Map<string, ResolvedTeam>>(new Map());
  const [loading, setLoading] = useState(true);

  // Stable league-id key so the effect doesn't refire on every render.
  const leagueKey = leagues.map(l => l.id).sort().join(',');

  useEffect(() => {
    if (leagues.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(leagues.map(l => api.getTeams(l.id).then(
      ts => ({ leagueId: l.id, ts }),
      () => ({ leagueId: l.id, ts: [] }),
    )))
      .then(results => {
        if (cancelled) return;
        const map = new Map<string, ResolvedTeam>();
        for (const { leagueId, ts } of results) {
          for (const t of ts) {
            map.set(t.id, {
              id: t.id,
              leagueId,
              name: t.teamName,
              abbrev: t.teamAbbrev,
              color: t.teamColor,
            });
          }
        }
        setTeams(map);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueKey]);

  return useMemo<TeamNameResolver>(() => ({
    get: id => (id ? teams.get(id) ?? null : null),
    name: id => (id ? teams.get(id)?.name ?? id : '—'),
    list: leagueId => (leagueId
      ? [...teams.values()].filter(t => t.leagueId === leagueId).sort((a, b) => a.name.localeCompare(b.name))
      : []),
    loading,
  }), [teams, loading]);
}
