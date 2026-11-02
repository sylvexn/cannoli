import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { SectionHeading } from '@/components/section-heading';
import { YourMatch } from '@/pages/standings/your-match';

/** The signed-in coach's match this week (needs League + LeagueData providers). */
export function HomeMatch() {
  const { user } = useAuth();
  const league = useLeague();
  const { players, standings, getWeekMatches } = useLeagueData();
  const me = useMemo(
    () => (user ? players.find(p => p.userId != null && String(p.userId) === user.id) ?? null : null),
    [players, user],
  );
  if (!me) return null;

  const { phase, currentWeek } = league.season;
  const week = Math.max(1, currentWeek);
  const m = phase === 'regular'
    ? getWeekMatches(week).find(x => x.homePlayer === me.id || x.awayPlayer === me.id)
    : undefined;
  const opp = m ? players.find(p => p.id === (m.homePlayer === me.id ? m.awayPlayer : m.homePlayer)) : undefined;
  const rankOf = (id: string) => standings.findIndex(p => p.id === id) + 1;

  return (
    <>
      <SectionHeading meta={`${me.teamName} · ${league.name.replace(' League', '')}`}>Your match</SectionHeading>
      {m && opp
        ? <YourMatch me={me} opp={opp} week={m.week} rank={rankOf} />
        : (
          <p className="py-3 text-sm text-text-secondary">
            No match for you this week.{' '}
            <Link to={`/league/${league.id}/teams/${me.id}`} className="text-gem-ink hover:underline">Your team page</Link>
          </p>
        )}
    </>
  );
}
