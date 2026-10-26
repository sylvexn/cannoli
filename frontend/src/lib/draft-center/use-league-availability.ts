import { useEffect, useMemo, useState } from 'react';
import { api, type ApiTeam } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { useAuth } from '@/lib/auth-context';
import { buildOwnerMap, defaultLeagueId, type OwnerMap } from './availability';

const cache = new Map<string, Promise<ApiTeam[]>>();
const load = (id: string) => {
  let p = cache.get(id);
  if (!p) { p = api.getTeams(id).catch(err => { cache.delete(id); throw err; }); cache.set(id, p); }
  return p;
};

/**
 * League context for the editor: active (non-archived) leagues, the selected one
 * (defaults to the league the user coaches in), and its ownership map. Reuses the
 * public `GET /api/leagues/:id/teams` rosters.
 */
export function useLeagueAvailability() {
  const { leagues } = useAppData();
  const { user } = useAuth();
  const active = useMemo(() => leagues.filter(l => !l.season.archived), [leagues]);
  const [teamsByLeague, setTeamsByLeague] = useState<Record<string, ApiTeam[]>>({});
  const [choice, setChoice] = useState<string | null | undefined>(undefined); // undefined = auto

  const key = active.map(l => l.id).join(',');
  useEffect(() => {
    let cancelled = false;
    for (const id of key ? key.split(',') : []) {
      load(id).then(t => { if (!cancelled) setTeamsByLeague(p => ({ ...p, [id]: t })); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [key]);

  const leagueId = choice === undefined ? defaultLeagueId(teamsByLeague, user?.id) : choice;
  const owners: OwnerMap | null = useMemo(
    () => (leagueId && teamsByLeague[leagueId] ? buildOwnerMap(teamsByLeague[leagueId], user?.id) : null),
    [leagueId, teamsByLeague, user?.id],
  );
  return { leagues: active, leagueId, setLeagueId: setChoice, owners };
}
