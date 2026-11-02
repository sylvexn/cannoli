import { useEffect, useMemo, useState } from 'react';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { useAuth } from '@/lib/auth-context';
import { preloadSprites } from '@/components/pokemon-sprite';
import { LoadingSprite } from '@/components/loading-sprite';
import { SectionHeading } from '@/components/section-heading';
import { ResultsRevealQuickAction } from '@/components/results-reveal-quick-action';
import { cn } from '@/lib/utils';
import type { Player } from '@/lib/types';
import { PlayoffBracket } from './schedule/playoff-bracket';
import { PhaseBanner } from './standings/phase-banner';
import { YourMatch } from './standings/your-match';
import { StandingsTable } from './standings/standings-table';
import { TeamPeek } from './standings/team-peek';
import { ThisWeek, LastWeek } from './standings/week-panels';

type View = 'standings' | 'playoffs';

export function StandingsPage() {
  const league = useLeague();
  const { user } = useAuth();
  const { players, standings, matches, getWeekMatches, loading, refresh } = useLeagueData();
  const season = league.season;

  const [view, setView] = useState<View>('standings');
  const [peek, setPeek] = useState<Player | null>(null);
  const [peekOpen, setPeekOpen] = useState(false);

  // The bracket is offered once playoff fixtures exist (or the phase is playoffs);
  // the page still opens on the regular standings.
  const showBracket = season.phase === 'playoffs' || matches.some(m => m.phase === 'playoffs');
  // Ordering/playoff line only mean something once regular play has begun.
  const ranked = season.phase === 'regular' || season.phase === 'playoffs' || season.phase === 'offseason';

  const byId = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);
  const me = useMemo(
    () => (user ? players.find(p => p.userId != null && String(p.userId) === user.id) ?? null : null),
    [players, user],
  );
  const rankOf = (id: string) => standings.findIndex(p => p.id === id) + 1;

  const thisWeek = Math.max(1, season.currentWeek);
  const thisMatches = useMemo(() => getWeekMatches(thisWeek), [getWeekMatches, thisWeek]);
  // Most recent earlier week that has any played fixture.
  const lastWeek = useMemo(() => {
    for (let w = thisWeek - 1; w > 0; w--) {
      if (getWeekMatches(w).some(m => m.status === 'completed' || m.homeScore != null)) return w;
    }
    return 0;
  }, [getWeekMatches, thisWeek]);
  const myMatch = me && season.phase === 'regular'
    ? thisMatches.find(m => m.homePlayer === me.id || m.awayPlayer === me.id)
    : undefined;
  const opp = myMatch ? byId.get(myMatch.homePlayer === me!.id ? myMatch.awayPlayer : myMatch.homePlayer) : undefined;

  useEffect(() => {
    preloadSprites(players.flatMap(p => p.roster.map(m => m.name)));
  }, [players]);

  if (loading) return <LoadingSprite />;

  const select = (p: Player) => { setPeek(p); setPeekOpen(true); };

  return (
    <div className="space-y-5">
      <PhaseBanner />

      {(
        <div className="flex items-center justify-end gap-3 flex-wrap empty:hidden">
          <ResultsRevealQuickAction league={league} onRevealed={refresh} />
          {showBracket && (['standings', 'playoffs'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'text-sm px-1 py-0.5 border-b-2 transition-colors',
                view === v ? 'border-gem text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary',
              )}
            >
              {v === 'standings' ? 'Standings' : 'Playoffs'}
            </button>
          ))}
        </div>
      )}

      {view === 'playoffs' && showBracket ? (
        <section>
          <SectionHeading>Playoff bracket</SectionHeading>
          <PlayoffBracket />
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-x-8 gap-y-6">
          <div className="space-y-6 min-w-0">
            {me && opp && myMatch && <YourMatch me={me} opp={opp} week={myMatch.week} rank={rankOf} />}
            <section>
              <SectionHeading meta={`${standings.length} teams`}>Standings</SectionHeading>
              {standings.length === 0 ? (
                <p className="text-sm text-text-muted py-3">No teams yet.</p>
              ) : (
                <StandingsTable
                  standings={standings}
                  myTeamId={me?.id ?? null}
                  playoffCount={league.playoffTeamCount || 8}
                  ranked={ranked}
                  onSelect={select}
                />
              )}
            </section>
          </div>
          <div className="space-y-6 min-w-0">
            <ThisWeek week={thisWeek} matches={thisMatches} byId={byId} myTeamId={me?.id ?? null} />
            {lastWeek > 0 && <LastWeek week={lastWeek} matches={getWeekMatches(lastWeek)} byId={byId} />}
          </div>
        </div>
      )}

      <TeamPeek
        player={peek}
        open={peekOpen}
        rank={peek ? rankOf(peek.id) : 0}
        onClose={() => setPeekOpen(false)}
      />
    </div>
  );
}
