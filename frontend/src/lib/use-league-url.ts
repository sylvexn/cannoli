import { useLeague } from './league-context';

/** Build a league-scoped URL. e.g. leagueUrl('/teams/sas') → '/league/sapphire/teams/sas' */
export function useLeagueUrl() {
  const league = useLeague();
  return (path: string) => `/league/${league.id}${path.startsWith('/') ? path : `/${path}`}`;
}
