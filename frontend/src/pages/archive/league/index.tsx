import { useEffect, useState, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ChampionBanner } from '@/components/champion-banner';
import { StandingsTab } from './tabs/standings';
import { ScheduleTab } from './tabs/schedule';
import { DraftTab } from './tabs/draft';
import { TransactionsTab } from './tabs/transactions';
import { LeaderboardsTab } from './tabs/leaderboards';
import { BracketTab } from './tabs/bracket';
import { AwardsTab } from './tabs/awards';
import { ListOrdered, Calendar, BookmarkPlus, Repeat, BarChart3, Trophy, Award } from 'lucide-react';
import type { FullLeagueData } from './types';

/**
 * League deep-dive at /archive/:seasonId/:leagueId. Pulls one /full
 * payload (~5 SQL round-trips) and partitions it across 7 tabs. Tab
 * state lives in ?tab=… so deep-links survive a refresh.
 */

const TAB_ORDER = ['standings', 'schedule', 'draft', 'transactions', 'leaderboards', 'bracket', 'awards'] as const;
type TabKey = (typeof TAB_ORDER)[number];

export function ArchiveLeaguePage() {
  const { seasonId, leagueId } = useParams<{ seasonId: string; leagueId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState<FullLeagueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeTab: TabKey = useMemo(() => {
    const t = searchParams.get('tab') as TabKey | null;
    return t && TAB_ORDER.includes(t) ? t : 'standings';
  }, [searchParams]);

  useEffect(() => {
    if (!leagueId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/archive/leagues/${leagueId}/full`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((d: FullLeagueData) => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [leagueId]);

  // Champion derivation — finals winner. Mirrors archive-mint.ts logic so
  // the banner shows what the auto-minter would award.
  const championInfo = useMemo(() => {
    if (!data) return null;
    const finals = data.schedule.filter(m => m.phase === 'playoffs' && m.playoffRound === 'f' && m.homeScore != null && m.awayScore != null);
    if (finals.length === 0) return null;
    let homeSum = 0, awaySum = 0;
    for (const f of finals) {
      homeSum += f.homeScore ?? 0;
      awaySum += f.awayScore ?? 0;
    }
    if (homeSum === awaySum) return null;
    const ref = finals[0];
    const winnerId = homeSum > awaySum ? ref.homeTeamId : ref.awayTeamId;
    const loserId = homeSum > awaySum ? ref.awayTeamId : ref.homeTeamId;
    const winner = data.teams.find(t => t.id === winnerId);
    const loser = data.teams.find(t => t.id === loserId);
    if (!winner) return null;
    return {
      winner,
      loser,
      score: { winner: Math.max(homeSum, awaySum), loser: Math.min(homeSum, awaySum) },
    };
  }, [data]);

  if (loading) return <div className="text-text-muted py-20 text-center text-sm">Loading league archive…</div>;
  if (error) return <div className="text-text-muted py-20 text-center">Couldn't load league ({error}).</div>;
  if (!data) return <div className="text-text-muted py-20 text-center">League not found.</div>;

  const { league, teams, schedule, draft, transactions } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span style={{ color: league.color }}>{league.name.split(' ')[0]}</span>{' '}
            <span className="text-text-primary">League</span>
          </h1>
          <p className="text-sm text-text-muted">
            Season {league.seasonNumber}
            {' · '}{teams.length} teams
            {' · '}{schedule.length} matches
            {' · '}{draft.length} draft picks
            {' · '}{transactions.length} txns
          </p>
        </div>
      </div>

      {championInfo && (
        <ChampionBanner
          team={{
            id: championInfo.winner.id,
            coachName: championInfo.winner.coachName,
            teamName: championInfo.winner.teamName,
            teamAbbrev: championInfo.winner.teamAbbrev,
            teamColor: championInfo.winner.teamColor,
            coachUsername: championInfo.winner.coachName.toLowerCase().replace(/\s+/g, ''),
          }}
          league={{
            id: league.id,
            name: league.name,
            color: league.color,
            seasonNumber: league.seasonNumber,
            seasonId: league.seasonId,
          }}
          finalScore={championInfo.score}
          runnerUp={championInfo.loser ? {
            id: championInfo.loser.id,
            teamAbbrev: championInfo.loser.teamAbbrev,
            teamName: championInfo.loser.teamName,
            teamColor: championInfo.loser.teamColor,
          } : null}
          roster={championInfo.winner.roster.map(r => ({ name: r.name, isTeraCaptain: r.isTeraCaptain }))}
        />
      )}

      <Tabs
        value={activeTab}
        onValueChange={v => {
          // Keep the rest of the query string intact so any future filters
          // survive tab-switching; we only mutate `tab`.
          const next = new URLSearchParams(searchParams);
          next.set('tab', v as TabKey);
          setSearchParams(next, { replace: true });
        }}
        className="flex flex-col gap-3"
      >
        <div className="border-b border-border-subtle overflow-x-auto">
          <TabsList variant="line" className="w-max h-9">
            <TabsTrigger value="standings" className="text-[11px] gap-1 px-3">
              <ListOrdered size={12} /> Standings
            </TabsTrigger>
            <TabsTrigger value="schedule" className="text-[11px] gap-1 px-3">
              <Calendar size={12} /> Schedule
            </TabsTrigger>
            <TabsTrigger value="draft" className="text-[11px] gap-1 px-3">
              <BookmarkPlus size={12} /> Draft
            </TabsTrigger>
            <TabsTrigger value="transactions" className="text-[11px] gap-1 px-3">
              <Repeat size={12} /> Transactions
            </TabsTrigger>
            <TabsTrigger value="leaderboards" className="text-[11px] gap-1 px-3">
              <BarChart3 size={12} /> Leaderboards
            </TabsTrigger>
            <TabsTrigger value="bracket" className="text-[11px] gap-1 px-3">
              <Trophy size={12} /> Bracket
            </TabsTrigger>
            <TabsTrigger value="awards" className="text-[11px] gap-1 px-3">
              <Award size={12} /> Awards
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="standings" className="mt-0"><StandingsTab data={data} /></TabsContent>
        <TabsContent value="schedule" className="mt-0"><ScheduleTab data={data} /></TabsContent>
        <TabsContent value="draft" className="mt-0"><DraftTab data={data} /></TabsContent>
        <TabsContent value="transactions" className="mt-0"><TransactionsTab data={data} /></TabsContent>
        <TabsContent value="leaderboards" className="mt-0"><LeaderboardsTab data={data} /></TabsContent>
        <TabsContent value="bracket" className="mt-0"><BracketTab data={data} /></TabsContent>
        <TabsContent value="awards" className="mt-0"><AwardsTab data={data} /></TabsContent>
      </Tabs>
    </div>
  );
}
