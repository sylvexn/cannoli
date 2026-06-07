import { useState, useEffect, useMemo } from 'react';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { rosterPointsUsed } from '@/lib/roster';
import { getStandingsNarrative, type StandingsChip } from '@/lib/standings-narrative';
import type { Player, Trade, Match, LeagueSeason } from '@/lib/types';
import { TeamLogo } from '@/components/team-logo';
import { RecordDisplay } from '@/components/record-display';
import { KDDisplay } from '@/components/kd-display';
import { PointCapBar } from '@/components/point-cap-bar';
import { PokemonSprite, preloadSprites } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { TeraIndicator } from '@/components/tera-indicator';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { ChevronDown, ArrowLeftRight, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useLeagueUrl } from '@/lib/use-league-url';
import { Skeleton } from '@/components/ui/skeleton';
import { StandingsTableSkeleton, MatchListSkeleton } from '@/components/skeletons';
import { EmptyState } from '@/components/empty-state';
import { TeamCoach } from '@/components/team-coach';
import { PokemonNickname } from '@/components/pokemon-nickname';

export function StandingsPage() {
  const leagueUrl = useLeagueUrl();
  const league = useLeague();
  const { players, standings, getWeekMatches, loading } = useLeagueData();
  const currentSeason = league.season;

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
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-win">League</span>{' '}
          <span className="text-text-primary">Hub</span>
        </h1>
        <p className="text-sm text-text-muted">
          Season {currentSeason.seasonNumber} &middot; Week {currentSeason.currentWeek} of {currentSeason.totalWeeks}
        </p>
      </div>

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
                isQualifyLine={i + 1 === league.playoffTeamCount}
              />
            ))}
            <div className="px-4 py-1.5 text-[10px] text-text-muted uppercase tracking-wider border-t border-border-subtle">
              Top {league.playoffTeamCount} qualify for playoffs
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
                      <TeamLogo abbrev={home.teamAbbrev} color={home.teamColor} size="sm" />
                      <span className="text-sm font-medium text-text-primary group-hover/home:text-neon transition-colors">{home.teamAbbrev}</span>
                    </Link>
                    <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider px-3">vs</span>
                    <Link to={leagueUrl(`/teams/${away.id}`)} viewTransition className="flex items-center gap-2 justify-end group/away">
                      <span className="text-sm font-medium text-text-primary group-hover/away:text-pink transition-colors">{away.teamAbbrev}</span>
                      <TeamLogo abbrev={away.teamAbbrev} color={away.teamColor} size="sm" />
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
                const homeWon = (match.homeScore ?? 0) > (match.awayScore ?? 0);
                return (
                  <div
                    key={match.id}
                    className="grid grid-cols-[1fr_auto_1fr] items-center py-2 px-3 rounded-md transition-all duration-200 hover:bg-surface-overlay/60"
                  >
                    <Link to={leagueUrl(`/teams/${home.id}`)} viewTransition className="flex items-center gap-2 group/home">
                      <TeamLogo abbrev={home.teamAbbrev} color={home.teamColor} size="sm" />
                      <span className={`text-sm font-medium transition-colors ${homeWon ? 'text-win' : 'text-text-secondary'} group-hover/home:text-neon`}>
                        {home.teamAbbrev}
                      </span>
                    </Link>
                    <div className="flex items-center gap-2 px-3">
                      <span className={`text-sm tabular-nums font-bold ${homeWon ? 'text-win' : 'text-text-muted'}`}>
                        {match.homeScore}
                      </span>
                      <span className="text-[10px] text-text-muted">—</span>
                      <span className={`text-sm tabular-nums font-bold ${!homeWon ? 'text-win' : 'text-text-muted'}`}>
                        {match.awayScore}
                      </span>
                    </div>
                    <Link to={leagueUrl(`/teams/${away.id}`)} viewTransition className="flex items-center gap-2 justify-end group/away">
                      <span className={`text-sm font-medium transition-colors ${!homeWon ? 'text-win' : 'text-text-secondary'} group-hover/away:text-neon`}>
                        {away.teamAbbrev}
                      </span>
                      <TeamLogo abbrev={away.teamAbbrev} color={away.teamColor} size="sm" />
                    </Link>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StandingsRow({
  player, rank, index, leagueUrl, standings, season, playoffCount, isQualifyLine,
}: {
  player: Player;
  rank: number;
  index: number;
  leagueUrl: (p: string) => string;
  standings: Player[];
  season: LeagueSeason;
  playoffCount: number;
  isQualifyLine: boolean;
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
        'stagger-item row-interactive border-b border-border-subtle/50 last:border-b-0',
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
            <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
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

        {/* Narrative chip — at most one, only when meaningful */}
        {narrativeChip && (
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
            <div className="flex items-center gap-4 mb-3 pb-2 border-b border-border-subtle/20">
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
                <div key={mon.name} className="flex items-center gap-2 py-1.5 border-b border-border-subtle/20 last:border-b-0 hover:bg-surface-overlay/30 rounded px-1 -mx-1 transition-colors">
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
                  <span className="tabular-nums text-[10px] shrink-0 w-12 text-right">
                    <span className="text-win">{mon.seasonStats.kills}</span>
                    <span className="text-text-muted">/</span>
                    <span className="text-loss">{mon.seasonStats.deaths}</span>
                  </span>
                </div>
              ))}
            </div>

            {/* Trade history */}
            {completedTrades.length > 0 && (
              <div className="mt-3 pt-2 border-t border-border-subtle/30">
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

function TiebreakerBadge({ tiebreaker }: { tiebreaker: Player['tiebreaker'] }) {
  if (!tiebreaker) return null;
  const RULE_LABEL: Record<string, string> = {
    h2h: 'H2H',
    diff: 'Diff',
    kills: 'PF',
    id: '—',
  };
  const RULE_DESC: Record<string, string> = {
    h2h: 'Head-to-head record vs tied teams',
    diff: 'Point differential',
    kills: 'Total kills (points for)',
    id: 'Stable tiebreak (team id)',
  };
  const label = RULE_LABEL[tiebreaker.rule] ?? tiebreaker.rule;
  const desc = RULE_DESC[tiebreaker.rule] ?? '';
  // Format value differently per rule
  let valueStr: string;
  if (tiebreaker.rule === 'diff') {
    const v = Number(tiebreaker.value);
    valueStr = v > 0 ? `+${v}` : String(v);
  } else if (tiebreaker.rule === 'h2h') {
    valueStr = String(tiebreaker.value);
  } else {
    valueStr = String(tiebreaker.value);
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          onClick={e => e.stopPropagation()}
          className="hidden md:inline-flex items-center gap-0.5 shrink-0 px-2 py-0.5 rounded-full border border-border-subtle bg-surface-overlay/40 text-[9px] font-mono text-text-muted cursor-help"
        >
          <span className="font-semibold text-text-secondary">{label}</span>
          <span className="tabular-nums">{valueStr}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-xs">
        <div className="font-medium text-text-primary mb-0.5">Tiebreaker: {label}</div>
        <div className="text-text-muted">{desc}</div>
      </TooltipContent>
    </Tooltip>
  );
}

function TradeHistoryRow({ trade, teamId }: { trade: Trade; teamId: string }) {
  const isFreeAgent = trade.recipient === 'pool';
  const isProposer = trade.proposer === teamId;
  const sent = isProposer ? trade.offering : trade.requesting;
  const received = isProposer ? trade.requesting : trade.offering;

  return (
    <div className="flex items-center gap-2 text-[10px] text-text-secondary py-0.5">
      <Badge variant="outline" className="text-[9px] px-1 py-0 border-border-subtle shrink-0">
        W{trade.week}
      </Badge>
      {isFreeAgent ? (
        <UserPlus size={10} className="text-neon shrink-0" />
      ) : (
        <ArrowLeftRight size={10} className="text-text-muted shrink-0" />
      )}
      <span className="truncate">
        <span className="text-win">+{received.join(', ')}</span>
        <span className="text-text-muted mx-1">/</span>
        <span className="text-loss">-{sent.join(', ')}</span>
      </span>
    </div>
  );
}
