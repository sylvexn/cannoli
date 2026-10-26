import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CopyPlus, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CoachLink } from '@/components/coach-link';
import { api, type ApiTeam } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useRulesetCatalog } from '@/lib/draft-center/use-ruleset-catalog';
import { picksFromRoster } from '@/lib/draft-center/roster';
import { useDraftCenter } from '@/lib/draft-center/store';
import { useAllLeagues } from '@/lib/draft-center/use-all-leagues';
import { ReadOnlyView } from './read-only-view';

/**
 * Read-only preview of a real team from any season, with the same analysis
 * panels. "Clone to my teams" copies roster + captains + tera types into a new
 * editable team (no link back to the original).
 */
export function PastTeamPage() {
  const { leagueId = '', teamId = '' } = useParams();
  const nav = useNavigate();
  const store = useDraftCenter();
  const { leagues, loading: leaguesLoading } = useAllLeagues();
  const [team, setTeam] = useState<ApiTeam | null | undefined>(undefined);
  const [finish, setFinish] = useState<string | null>(null);
  const [champion, setChampion] = useState(false);

  const league = leagues.find(l => l.id === leagueId);

  useEffect(() => {
    let cancelled = false;
    api.getTeams(leagueId)
      .then(ts => { if (!cancelled) setTeam(ts.find(t => t.id === teamId) ?? null); })
      .catch(() => { if (!cancelled) setTeam(null); });
    return () => { cancelled = true; };
  }, [leagueId, teamId]);

  // Placement lives on the season endpoint, keyed by the league's season.
  const seasonId = league ? Number(league.season.id) : NaN;
  useEffect(() => {
    if (!Number.isFinite(seasonId)) return;
    let cancelled = false;
    api.getSeasonLeagues(seasonId).then(ls => {
      if (cancelled) return;
      const l = ls.find(x => x.id === leagueId);
      setFinish(l?.teams.find(t => t.id === teamId)?.finishLabel ?? null);
      setChampion(l?.champion === teamId);
    }).catch(() => { /* placement is garnish */ });
    return () => { cancelled = true; };
  }, [seasonId, leagueId, teamId]);

  const { resolve, loading: rulesetsLoading } = useRulesetCatalog([{ leagueId }]);
  const ruleset = useMemo(() => resolve({ leagueId }), [resolve, leagueId]);
  const roster = useMemo(() => picksFromRoster(team?.roster ?? []), [team]);

  if (team === undefined || leaguesLoading || rulesetsLoading || store.loading) return <div className="p-8 text-sm text-text-muted">Loading...</div>;
  if (!team) {
    return (
      <div className="max-w-md mx-auto p-8 text-center flex flex-col gap-3">
        <p className="text-sm text-text-secondary">Team not found.</p>
        <Button variant="outline" nativeButton={false} render={<Link to="/draft-center" />}>Back to Draft Center</Button>
      </div>
    );
  }

  async function clone() {
    try {
      const t = await store.createTeam({ name: `${team!.teamName} (${ruleset.label.split(' — ')[0]})`.slice(0, 60), rulesetId: ruleset.id ?? null, leagueId, roster: structuredClone(roster) });
      toast.success('Cloned to your teams');
      nav(`/draft-center/team/${t.id}`);
    } catch (e) { toast.error(getErrorMessage(e)); }
  }

  const r = team.record;
  return (
    <ReadOnlyView
      title={team.teamName}
      backTo="/draft-center"
      roster={roster}
      ruleset={ruleset}
      meta={<>
        <span>{ruleset.label}</span>
        {team.owner && <CoachLink coach={team.owner} />}
        <span className="font-mono tabular-nums">{r.wins}-{r.losses}{r.kills != null ? ` - ${r.kills} kills` : ''}</span>
        {finish && <span className={champion ? 'text-amber-400' : ''}>{champion && <Trophy size={11} className="inline mr-1 -mt-0.5" />}{finish}</span>}
        <Link to={`/league/${leagueId}/teams/${team.id}`} className="text-neon hover:underline">Team page</Link>
      </>}
      actions={<Button size="sm" onClick={clone}><CopyPlus size={13} /> Clone to my teams</Button>}
    />
  );
}
