import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import { leagueGem } from '@/lib/constants';
import type { League } from '@/lib/types';
import { AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from './budget-bar';

export function NotAManagerRedirect({
  currentLeagueId,
  currentLeagueName,
}: {
  currentLeagueId: string;
  currentLeagueName: string;
}) {
  const { user } = useAuth();
  const { leagues } = useAppData();
  const [managedLeagues, setManagedLeagues] = useState<League[] | null>(null);

  useEffect(() => {
    if (!user || leagues.length === 0) {
      setManagedLeagues([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      leagues.map(l =>
        api.getTeams(l.id)
          .then(teams => ({ league: l, teams }))
          .catch(() => ({ league: l, teams: [] as Awaited<ReturnType<typeof api.getTeams>> })),
      ),
    ).then(results => {
      if (cancelled) return;
      const managed = results
        .filter(({ league, teams }) => {
          if (league.id === currentLeagueId) return false;
          if (league.season.phase === 'predraft' || league.season.phase === 'draft') return false;
          return teams.some(t => t.userId != null && String(t.userId) === user.id);
        })
        .map(({ league }) => league);
      setManagedLeagues(managed);
    });
    return () => { cancelled = true; };
  }, [user, leagues, currentLeagueId]);

  if (managedLeagues === null) {
    return (
      <EmptyState
        icon={<AlertCircle className="text-text-muted" size={28} />}
        title="Not a manager in this league"
        message="Checking your other leagues..."
      />
    );
  }

  if (managedLeagues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[40vh] gap-4 text-center px-6">
        <AlertCircle className="text-text-muted" size={28} />
        <div className="text-base font-semibold text-text-primary">Not a manager in this league</div>
        <div className="text-sm text-text-muted max-w-md">
          You must be the manager of a team in {currentLeagueName} to pick up free agents.
        </div>
        <Link
          to="/"
          className="text-xs font-semibold px-3 py-1.5 rounded border border-border-subtle hover:border-neon/40 hover:text-neon text-text-secondary transition-colors"
        >
          Browse leagues
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[40vh] gap-4 text-center px-6">
      <AlertCircle className="text-text-muted" size={28} />
      <div className="text-base font-semibold text-text-primary">Not a manager in {currentLeagueName}</div>
      <div className="text-sm text-text-muted max-w-md">
        You don't manage a team here, but free agency is open in {managedLeagues.length === 1 ? 'this league' : 'these leagues'} where you do:
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        {managedLeagues.map(l => (
          <Link
            key={l.id}
            to={`/league/${l.id}/market/free-agents`}
            className="gem-wrapper w-full flex items-center gap-1.5 py-1 px-1 transition-all duration-150"
          >
            <div className={`league-banner league-banner-${leagueGem(l.id)} flex-1 min-w-0`}>
              <span className="league-banner-text text-white truncate">
                {l.name.replace(' League', '')}
              </span>
            </div>
          </Link>
        ))}
      </div>
      <Link
        to="/"
        className="text-[11px] text-text-muted hover:text-text-secondary mt-1 transition-colors"
      >
        Browse all leagues
      </Link>
    </div>
  );
}
