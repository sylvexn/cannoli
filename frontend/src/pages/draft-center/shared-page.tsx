import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CopyPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CoachLink } from '@/components/coach-link';
import { api } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { resolveRuleset } from '@/lib/draft-center/ruleset';
import { useDraftCenter } from '@/lib/draft-center/store';
import { useAllLeagues } from '@/lib/draft-center/use-all-leagues';
import type { DcSharedTeam } from '@/lib/draft-center/types';
import { ReadOnlyView } from './read-only-view';

/** Public read-only page behind a share token (no login required). */
export function SharedTeamPage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const store = useDraftCenter();
  const { leagues, loading: leaguesLoading } = useAllLeagues();
  const [team, setTeam] = useState<DcSharedTeam | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api.dcGetShared(token)
      .then(t => { if (!cancelled) setTeam(t); })
      .catch(() => { if (!cancelled) setTeam(null); });
    return () => { cancelled = true; };
  }, [token]);

  const ruleset = useMemo(() => resolveRuleset(team?.leagueId ?? null, leagues), [team?.leagueId, leagues]);

  if (team === undefined || leaguesLoading) return <div className="p-8 text-sm text-text-muted">Loading...</div>;
  if (!team) {
    return (
      <div className="max-w-md mx-auto p-8 text-center flex flex-col gap-3">
        <p className="text-sm text-text-secondary">This link isn't valid - the team may have been deleted or sharing was turned off.</p>
        <Button variant="outline" nativeButton={false} render={<Link to="/draft-center" />}>Open Draft Center</Button>
      </div>
    );
  }

  async function clone() {
    try {
      const t = await store.createTeam({ name: `${team!.name} (copy)`.slice(0, 60), leagueId: team!.leagueId, roster: structuredClone(team!.roster) });
      toast.success('Copied to your teams');
      nav(`/draft-center/team/${t.id}`);
    } catch (e) { toast.error(getErrorMessage(e)); }
  }

  return (
    <ReadOnlyView
      title={team.name}
      roster={team.roster}
      ruleset={ruleset}
      meta={<>
        <span>{ruleset.label}</span>
        <CoachLink coach={{ username: team.owner.username, displayName: team.owner.displayName, primaryColor: team.owner.primaryColor }} />
        <span className="text-text-muted">read-only</span>
      </>}
      actions={<Button size="sm" onClick={clone}><CopyPlus size={13} /> Copy to my teams</Button>}
    />
  );
}
