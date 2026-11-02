import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { SectionHeading } from '@/components/section-heading';
import { YourMatch } from '@/pages/standings/your-match';
import { DraftCta, PlayoffsPanel } from '@/pages/standings/phase-cta';
import { panelFor, myPlayoffMatch } from '@/pages/standings/phase-panels';

/** The signed-in coach's slab for their league, phase-aware (needs League + LeagueData providers). */
export function HomeMatch() {
  const { user } = useAuth();
  const league = useLeague();
  const { players, standings, matches, getWeekMatches } = useLeagueData();
  const me = useMemo(
    () => (user ? players.find(p => p.userId != null && String(p.userId) === user.id) ?? null : null),
    [players, user],
  );
  if (!me) return null;

  const panel = panelFor(league.season);
  if (panel === 'draft') return <DraftCta />;

  const teamLink = (
    <Link to={`/league/${league.id}/teams/${me.id}`} className="text-gem-ink hover:underline">Your team page</Link>
  );
  const meta = `${me.teamName} · ${league.name.replace(' League', '')}`;
  if (panel === 'complete') {
    return (
      <>
        <SectionHeading meta={meta}>Season complete</SectionHeading>
        <p className="py-3 text-sm text-text-secondary">
          Final record {me.record.wins}–{me.record.losses}. {teamLink}
        </p>
      </>
    );
  }

  const m = panel === 'playoffs'
    ? myPlayoffMatch(matches, me.id)
    : getWeekMatches(Math.max(1, league.season.currentWeek)).find(x => x.homePlayer === me.id || x.awayPlayer === me.id);
  const opp = m ? players.find(p => p.id === (m.homePlayer === me.id ? m.awayPlayer : m.homePlayer)) : undefined;
  const rankOf = (id: string) => standings.findIndex(p => p.id === id) + 1;

  if (panel === 'playoffs' && !(m && opp)) return <PlayoffsPanel note="Playoffs in progress." />;

  return (
    <>
      <SectionHeading meta={meta}>Your match</SectionHeading>
      {m && opp
        ? <YourMatch me={me} opp={opp} week={m.week} rank={rankOf} />
        : <p className="py-3 text-sm text-text-secondary">No match for you this week. {teamLink}</p>}
    </>
  );
}
