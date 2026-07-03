import { useState, useEffect, useMemo } from 'react';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { rosterPointsUsed } from '@/lib/roster';
import { getStandingsNarrative, type StandingsChip } from '@/lib/standings-narrative';
import type { Player, Match, LeagueSeason } from '@/lib/types';
import { TeamLogo } from '@/components/team-logo';
import { TeamLogoSwap } from '@/components/team-logo-swap';
import { RecordDisplay } from '@/components/record-display';
import { KDDisplay } from '@/components/kd-display';
import { PointCapBar } from '@/components/point-cap-bar';
import { PokemonSprite, preloadSprites } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TeraIndicator } from '@/components/tera-indicator';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { ChevronDown, ArrowLeftRight, ListOrdered, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useLeagueUrl } from '@/lib/use-league-url';
import { Skeleton } from '@/components/ui/skeleton';
import { StandingsTableSkeleton, MatchListSkeleton } from '@/components/skeletons';
import { EmptyState } from '@/components/empty-state';
import { TeamCoach } from '@/components/team-coach';
import { PokemonNickname } from '@/components/pokemon-nickname';
import { PlayoffBracket } from './schedule/playoff-bracket';
import { TiebreakerBadge, TradeHistoryRow } from './standings-parts';
import { ResultsRevealQuickAction } from '@/components/results-reveal-quick-action';

type StandingsView = 'standings' | 'playoffs';

export function StandingsPage() {
  const leagueUrl = useLeagueUrl();
  const league = useLeague();
  const { players, standings, getWeekMatches, matches, loading, refresh } = useLeagueData();
  const currentSeason = league.season;

  // Playoffs-final view: when the league has actually generated a playoff
  // bracket, surface it as a first-class view on the standings page. We auto-
  // select it once the league enters the playoffs/offseason phase so coaches
  // landing on the hub see the live bracket instead of a stale regular-season
  // table. The toggle stays visible so the regular-season table remains one
  // click away (final seeding, tiebreakers, qualify-line context).
  const hasPlayoffs = useMemo(
    () => matches.some(m => m.phase === 'playoffs'),
    [matches],
  );
  const isPlayoffPhase =
    currentSeason.phase === 'playoffs' ||
    currentSeason.phase === 'offseason' ||
    currentSeason.archived === true;
  const [view, setView] = useState<StandingsView>('standings');
  useEffect(() => {
    if (hasPlayoffs && isPlayoffPhase) setView('playoffs');
  }, [hasPlayoffs, isPlayoffPhase]);

  // Find the last completed week and next upcoming week
  const { recentWeek, upcomingWeek } = useMemo(() => {
    // Walk backwards from currentWeek to find last week with scores
    let recent = currentSeason.currentWeek;
    while (recent > 0) {
      const wm = getWeekMatches(recent);
      if (wm.length > 0 && wm.some(m => m.homeScore !== undefined)) break;
      recent--;
    }
    // Upcoming is the first week after recent without scores
    let upcoming = recent + 1;
    const um = getWeekMatches(upcoming);
    if (um.length === 0) upcoming = 0; // no upcoming
    return { recentWeek: recent, upcomingWeek: upcoming };
  }, [getWeekMatches, currentSeason.currentWeek]);

  const recentMatches = useMemo(() => recentWeek > 0 ? getWeekMatches(recentWeek) : [], [getWeekMatches, recentWeek]);
  const upcomingMatches = useMemo(() => upcomingWeek > 0 ? getWeekMatches(upcomingWeek) : [], [getWeekMatches, upcomingWeek]);

  // The regular season is only truly "complete" when the league has advanced
  // out of regular play. `upcomingMatches.length === 0` is a flaky proxy: it
  // also fires before the schedule for the next week is generated mid-season,
  // which used to mislabel the card as "Season Complete" / "Final". Use the
  // league phase + currentWeek vs totalWeeks as the real signal.
  const isSeasonComplete =
    currentSeason.phase === 'playoffs' ||
    currentSeason.phase === 'offseason' ||
    currentSeason.archived === true ||
    currentSeason.currentWeek > currentSeason.totalWeeks;

  // Before the season starts (predraft/draft) every record is 0-0 and the
  // ordering is meaningless, so the qualify line and the per-row narrative
  // chips are noise. They only carry meaning once regular play begins.
  const standingsAreRanked =
    currentSeason.phase === 'regular' ||
    currentSeason.phase === 'playoffs' ||
    currentSeason.phase === 'offseason';

  function findPlayer(id: string) {
    return players.find(p => p.id === id);
  }

  useEffect(() => {
    preloadSprites(players.flatMap(p => p.roster.map(m => m.name)));
  }, [players]);

  if (loading) return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-40 bg-surface-overlay/50 mb-2" />
        <Skeleton className="h-4 w-56 bg-surface-overlay/50" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <StandingsTableSkeleton rows={10} />
        <div className="space-y-6">
          <MatchListSkeleton count={5} />
          <MatchListSkeleton count={5} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span className="text-win">League</span>{' '}
            <span className="text-text-primary">Hub</span>
          </h1>
          <p className="text-sm text-text-muted">
            Season {currentSeason.seasonNumber} &middot; Week {currentSeason.currentWeek} of {currentSeason.totalWeeks}
            {isPlayoffPhase && (
              <span className="ml-2 text-pink font-medium">&middot; Playoffs</span>
            )}
          </p>
        </div>

        {/* Header controls — spoiler-free toggle always available; the view
         *  toggle only when a playoff bracket exists. Defaults to the playoffs
         *  view in playoff/offseason phase; falls back to the regular standings
         *  table otherwise. */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <ResultsRevealQuickAction league={league} onRevealed={refresh} />
          {hasPlayoffs && (
            <div className="flex rounded-lg border border-border-default overflow-hidden">
              <button
                onClick={() => setView('standings')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                  view === 'standings'
                    ? 'bg-surface-overlay text-text-primary'
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
                )}
              >
                <ListOrdered size={13} />
                Standings
              </button>
              <button
                onClick={() => setView('playoffs')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                  view === 'playoffs'
                    ? 'bg-pink/10 text-pink'
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
                )}
              >
                <Trophy size={13} />
                Playoffs
              </button>
            </div>
          )}
        </div>
      </div>

      {view === 'playoffs' && hasPlayoffs ? (
        <PlayoffsFinalView />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Standings — takes 2 columns */}
        <Card className="lg:col-span-2 bg-surface-raised border-border-default">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-text-primary">Standings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {standings.map((player, i) => (
              <StandingsRow
                key={player.id}
                player={player}
                rank={i + 1}
                index={i}
                leagueUrl={leagueUrl}
                standings={standings}
                season={currentSeason}
                playoffCount={league.playoffTeamCount}
                isQualifyLine={standingsAreRanked && i + 1 === league.playoffTeamCount}
                showNarrative={standingsAreRanked}
              />
            ))}
            <div className="px-4 py-1.5 text-[10px] text-text-muted uppercase tracking-wider border-t border-border-subtle">
              {standingsAreRanked
                ? `Top ${league.playoffTeamCount} qualify for playoffs`
                : 'Standings begin once the season starts'}
            </div>
          </CardContent>
        </Card>

        {/* Right column — upcoming & recent */}
        <div className="space-y-6">
          <Card className="bg-surface-raised border-border-default">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-text-primary">
                  {upcomingWeek > 0
                    ? `Week ${upcomingWeek}`
                    : isSeasonComplete
                      ? 'Season Complete'
                      : `Week ${currentSeason.currentWeek + 1}`}
                </CardTitle>
                <Badge
                  variant="outline"
                  className={
                    upcomingWeek > 0
                      ? 'text-neon border-neon/30 text-[10px]'
                      : isSeasonComplete
                        ? 'text-text-muted border-border-default text-[10px]'
                        : 'text-text-muted border-border-default text-[10px]'
                  }
                >
                  {upcomingWeek > 0 ? 'Upcoming' : isSeasonComplete ? 'Final' : 'Pending'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {upcomingMatches.length > 0 ? upcomingMatches.map(match => {
                const home = findPlayer(match.homePlayer);
                const away = findPlayer(match.awayPlayer);
                if (!home || !away) return null;
                return (
                  <div
                    key={match.id}
                    className="grid grid-cols-[1fr_auto_1fr] items-center py-2 px-3 rounded-md transition-all duration-200 hover:bg-surface-overlay/60"
                  >
                    <Link to={leagueUrl(`/teams/${home.id}`)} viewTransition className="flex items-center gap-2 group/home">
                      <TeamLogoSwap
                        team={{ leagueId: league.id, teamId: home.id, teamAbbrev: home.teamAbbrev, teamColor: home.teamColor, logoPath: home.logoPath, owner: home.owner }}
                        size="sm"
                        static
                      />
                      <span className="text-sm font-medium text-text-primary group-hover/home:text-neon transition-colors">{home.teamAbbrev}</span>
                    </Link>
                    <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider px-3">vs</span>
                    <Link to={leagueUrl(`/teams/${away.id}`)} viewTransition className="flex items-center gap-2 justify-end group/away">
                      <span className="text-sm font-medium text-text-primary group-hover/away:text-pink transition-colors">{away.teamAbbrev}</span>
                      <TeamLogoSwap
                        team={{ leagueId: league.id, teamId: away.id, teamAbbrev: away.teamAbbrev, teamColor: away.teamColor, logoPath: away.logoPath, owner: away.owner }}
                        size="sm"
                        static
                      />
                    </Link>
                  </div>
                );
              }) : isSeasonComplete ? (
                <EmptyState
                  variant="season-done"
                  title="Regular season's done."
                  subtitle="Playoffs next."
                  spriteSize="md"
                  padding="sm"
                />
              ) : (
                <EmptyState
                  variant="quiet"
                  title="No matches scheduled yet."
                  subtitle="Check back when the next week's bracket goes live."
                  spriteSize="md"
                  padding="sm"
                />
              )}
            </CardContent>
          </Card>

          <Card className="bg-surface-raised border-border-default">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-text-primary">
                  Week {recentWeek}
                </CardTitle>
                <Badge variant="outline" className="text-text-muted border-border-default text-[10px]">
                  Results
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {recentMatches.map(match => {
                const home = findPlayer(match.homePlayer);
                const away = findPlayer(match.awayPlayer);
                if (!home || !away) return null;
                // A week can be partially played (some fixtures still pending).
                // Only matches with BOTH scores recorded are real results — gate
                // the W/L badges + score on that, else show "vs" like an upcoming
                // fixture so unplayed games don't render a bogus loss/win.
                const completed = match.homeScore != null && match.awayScore != null;
                const homeWon = completed && (match.homeScore ?? 0) > (match.awayScore ?? 0);
                const awayWon = completed && (match.awayScore ?? 0) > (match.homeScore ?? 0);
                return (
                  <div
                    key={match.id}
                    className="grid grid-cols-[1fr_auto_1fr] items-center py-2 px-3 rounded-md transition-all duration-200 hover:bg-surface-overlay/60"
                  >
                    <Link to={leagueUrl(`/teams/${home.id}`)} viewTransition className="flex items-center gap-2 group/home">
                      <TeamLogoSwap
                        team={{ leagueId: league.id, teamId: home.id, teamAbbrev: home.teamAbbrev, teamColor: home.teamColor, logoPath: home.logoPath, owner: home.owner }}
                        size="sm"
                        static
                      />
                      <span className={`text-sm font-medium transition-colors ${homeWon ? 'text-win' : 'text-text-secondary'} group-hover/home:text-neon`}>
                        {home.teamAbbrev}
                      </span>
                      {completed && (
                        <span className={`text-[10px] font-mono font-bold tabular-nums ${homeWon ? 'text-win' : 'text-loss'}`}>
                          {homeWon ? 'W' : 'L'}
                        </span>
                      )}
                    </Link>
                    {completed ? (
                      <span className="flex items-center gap-2 px-3">
                        <span className={`text-sm tabular-nums font-bold ${homeWon ? 'text-win' : 'text-text-muted'}`}>
                          {match.homeScore}
                        </span>
                        <span className="text-[10px] text-text-muted">—</span>
                        <span className={`text-sm tabular-nums font-bold ${awayWon ? 'text-win' : 'text-text-muted'}`}>
                          {match.awayScore}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider px-3">vs</span>
                    )}
                    <Link to={leagueUrl(`/teams/${away.id}`)} viewTransition className="flex items-center gap-2 justify-end group/away">
                      {completed && (
                        <span className={`text-[10px] font-mono font-bold tabular-nums ${awayWon ? 'text-win' : 'text-loss'}`}>
                          {awayWon ? 'W' : 'L'}
                        </span>
                      )}
                      <span className={`text-sm font-medium transition-colors ${awayWon ? 'text-win' : 'text-text-secondary'} group-hover/away:text-neon`}>
                        {away.teamAbbrev}
                      </span>
                      <TeamLogoSwap
                        team={{ leagueId: league.id, teamId: away.id, teamAbbrev: away.teamAbbrev, teamColor: away.teamColor, logoPath: away.logoPath, owner: away.owner }}
                        size="sm"
                        static
                      />
                    </Link>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
      )}
    </div>
  );
}

/** Playoffs-final view — full-width bracket render with a champion banner once
 *  the finals have a result. Re-uses the schedule page's PlayoffBracket so the
 *  visual + connector logic stays in lockstep across both surfaces. */
function PlayoffsFinalView() {
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-text-primary flex items-center gap-2">
            <Trophy size={14} className="text-pink" />
            Playoff Bracket
          </CardTitle>
          <Badge variant="outline" className="text-pink border-pink/30 text-[10px]">
            Final
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <PlayoffBracket />
      </CardContent>
    </Card>
  );
}

function StandingsRow({
  player, rank, index, leagueUrl, standings, season, playoffCount, isQualifyLine,
  showNarrative,
}: {
  player: Player;
  rank: number;
  index: number;
  leagueUrl: (p: string) => string;
  standings: Player[];
  season: LeagueSeason;
  playoffCount: number;
  isQualifyLine: boolean;
  /** Whether the season has progressed far enough for the ordering (and thus
   *  the per-row narrative chip) to be meaningful. False pre-regular. */
  showNarrative: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { getTeamTrades, getTeamMatches } = useLeagueData();
  const { openSideCard } = usePokemonSideCard();
  const { user } = useAuth();
  const isMe = user?.id != null && player.userId != null && String(player.userId) === user.id;
  const isPlayoff = rank <= playoffCount;
  const points = useMemo(() => rosterPointsUsed(player.roster), [player.roster]);
  const completedTrades = useMemo(() => getTeamTrades(player.id).filter(t => t.status === 'accepted'), [player.id, getTeamTrades]);
  const totalKills = player.roster.reduce((s, m) => s + m.seasonStats.kills, 0);
  const totalDeaths = player.roster.reduce((s, m) => s + m.seasonStats.deaths, 0);

  const narrativeChip = useMemo<StandingsChip | null>(() => {
    const teamMatches: Match[] = getTeamMatches(player.id);
    return getStandingsNarrative(player, {
      rank,
      standings,
      teamMatches,
      totalRegularWeeks: season.totalWeeks,
      playoffSize: playoffCount,
      currentWeek: season.currentWeek,
    });
  }, [player, rank, standings, getTeamMatches, season.totalWeeks, season.currentWeek]);

  return (
    <div
      className={cn(
        'stagger-item row-interactive border-b border-border-default last:border-b-0',
        isQualifyLine && 'border-b-neon/40 border-b-2',
        isMe && 'identity-glow-soft',
      )}
      style={{
        ['--i' as never]: Math.min(index, 20),
        ['--card-accent' as never]: player.teamColor,
        ['--identity-color' as never]: player.teamColor,
        // Ambient team-color bleed — left-side gradient that fades to nothing
        // by ~40% across. Each row visibly belongs to its team without breaking
        // the dark base. The user's own row gets a stronger bleed.
        background: isMe
          ? `linear-gradient(90deg, ${player.teamColor}24 0%, ${player.teamColor}12 25%, ${player.teamColor}04 60%, transparent 100%)`
          : `linear-gradient(90deg, ${player.teamColor}12 0%, ${player.teamColor}06 18%, transparent 45%)`,
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-overlay/60 transition-all duration-200 cursor-pointer group"
      >
        {/* Rank */}
        <div className="w-6 shrink-0 text-center">
          {rank <= 3 ? (
            <span className={`rank-badge rank-badge-${rank} w-6 h-6 text-[10px]`}>{rank}</span>
          ) : (
            <span className={`text-sm font-bold tabular-nums ${isPlayoff ? 'text-neon' : 'text-text-muted'}`}>{rank}</span>
          )}
        </div>

        {/* Team */}
        <div className="flex items-center gap-2.5 min-w-0" style={{ flex: '1 1 0', minWidth: 0 }}>
          <Link
            to={leagueUrl(`/teams/${player.id}`)} viewTransition
            onClick={e => e.stopPropagation()}
            className="group/team transition-transform duration-200 hover:scale-110"
          >
            <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" logoPath={player.logoPath} />
          </Link>
          <div className="min-w-0 text-left">
            <Link
              to={leagueUrl(`/teams/${player.id}`)} viewTransition
              onClick={e => e.stopPropagation()}
              className="text-sm font-medium text-text-primary hover:text-neon transition-colors truncate block leading-snug"
            >
              {player.teamName}
            </Link>
            <span onClick={e => e.stopPropagation()} className="flex items-center gap-1.5 leading-snug text-left text-[10px]">
              <TeamCoach player={player} size="xs" showAvatar avatarSize="sm" />
            </span>
          </div>
        </div>

        {/* Tiebreaker badge — only when this team is in a tied wins-bucket */}
        <TiebreakerBadge tiebreaker={player.tiebreaker ?? null} />

        {/* Record */}
        <div className="shrink-0">
          <RecordDisplay
            wins={player.record.wins}
            losses={player.record.losses}
            differential={player.record.differential}
            className="text-xs"
          />
        </div>

        {/* Narrative chip — at most one, only when meaningful and once the
            season has actually started (ordering is moot pre-regular). */}
        {showNarrative && narrativeChip && (
          <span
            className={cn(
              'shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider',
              narrativeChip.bgClass,
              narrativeChip.textClass,
            )}
          >
            <narrativeChip.icon size={10} />
            {narrativeChip.label}
          </span>
        )}

        {/* Chevron */}
        <ChevronDown
          size={14}
          className={cn(
            'text-text-muted transition-transform duration-200 shrink-0',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {/* Expanded detail */}
      <div className={cn(
        'grid transition-all duration-200 ease-out',
        expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}>
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-1 ml-9">
            {/* Stats + Point cap bar */}
            <div className="flex items-center gap-4 mb-3 pb-2 border-b border-border-subtle">
              <KDDisplay kills={totalKills} deaths={totalDeaths} className="text-xs" />
              <PointCapBar used={points} className="flex-1 max-w-[200px]" />
              {completedTrades.length > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-text-muted">
                  <ArrowLeftRight size={10} />
                  {completedTrades.length} trade{completedTrades.length > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Roster table */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0">
              {player.roster.map(mon => (
                <div key={mon.name} className="flex items-center gap-2 py-1.5 border-b border-border-subtle last:border-b-0 hover:bg-surface-overlay/50 rounded px-1 -mx-1 transition-colors">
                  <button type="button" onClick={() => openSideCard(mon.name)} className="shrink-0 cursor-pointer">
                    <PokemonSprite name={mon.name} size="xs" />
                  </button>
                  <div className="flex flex-col min-w-0 flex-1">
                    <TeraIndicator
                      name={mon.name}
                      isTeraCaptain={mon.isTeraCaptain}
                      teraTypes={mon.teraTypes}
                      className="text-xs font-medium truncate"
                      asLink
                    />
                    {mon.nickname ? (
                      <PokemonNickname nickname={mon.nickname} className="leading-none" />
                    ) : null}
                  </div>
                  <TypeChip types={mon.types} size="xs" />
                  <TierBadge points={mon.tier} />
                  <span className="shrink-0 w-12 justify-end tabular-nums text-[10px] text-right">
                    <span className="text-win">{mon.seasonStats.kills}</span>
                    <span className="text-text-muted">/</span>
                    <span className="text-loss">{mon.seasonStats.deaths}</span>
                  </span>
                </div>
              ))}
            </div>

            {/* Trade history */}
            {completedTrades.length > 0 && (
              <div className="mt-3 pt-2 border-t border-border-subtle">
                <h4 className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Transactions</h4>
                <div className="space-y-1">
                  {completedTrades.map(trade => (
                    <TradeHistoryRow key={trade.id} trade={trade} teamId={player.id} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

