import { useState, useEffect, useMemo } from 'react';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { rosterPointsUsed } from '@/lib/roster';
import type { Player, Trade } from '@/lib/types';
import { TeamLogo } from '@/components/team-logo';
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
import { ChevronDown, ArrowLeftRight, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLeagueUrl } from '@/lib/use-league-url';
import { Skeleton } from '@/components/ui/skeleton';
import { StandingsTableSkeleton, MatchListSkeleton } from '@/components/skeletons';

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
          <span className="text-win">League</span>
          <span className="text-text-primary ml-1">Hub</span>
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
              <StandingsRow key={player.id} player={player} rank={i + 1} leagueUrl={leagueUrl} />
            ))}
            <div className="px-4 py-1.5 text-[10px] text-text-muted uppercase tracking-wider border-t border-border-subtle">
              Top 8 qualify for playoffs
            </div>
          </CardContent>
        </Card>

        {/* Right column — upcoming & recent */}
        <div className="space-y-6">
          <Card className="bg-surface-raised border-border-default">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-text-primary">
                  {upcomingWeek > 0 ? `Week ${upcomingWeek}` : 'Season Complete'}
                </CardTitle>
                <Badge variant="outline" className={upcomingWeek > 0 ? 'text-neon border-neon/30 text-[10px]' : 'text-text-muted border-border-default text-[10px]'}>
                  {upcomingWeek > 0 ? 'Upcoming' : 'Final'}
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
                    <Link to={leagueUrl(`/teams/${home.id}`)} className="flex items-center gap-2 group/home">
                      <TeamLogo abbrev={home.teamAbbrev} color={home.teamColor} size="sm" />
                      <span className="text-sm font-medium text-text-primary group-hover/home:text-neon transition-colors">{home.teamAbbrev}</span>
                    </Link>
                    <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider px-3">vs</span>
                    <Link to={leagueUrl(`/teams/${away.id}`)} className="flex items-center gap-2 justify-end group/away">
                      <span className="text-sm font-medium text-text-primary group-hover/away:text-pink transition-colors">{away.teamAbbrev}</span>
                      <TeamLogo abbrev={away.teamAbbrev} color={away.teamColor} size="sm" />
                    </Link>
                  </div>
                );
              }) : (
                <div className="text-center py-4 text-text-muted text-sm">
                  Regular season complete — playoffs next
                </div>
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
                    <Link to={leagueUrl(`/teams/${home.id}`)} className="flex items-center gap-2 group/home">
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
                    <Link to={leagueUrl(`/teams/${away.id}`)} className="flex items-center gap-2 justify-end group/away">
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

function StandingsRow({ player, rank, leagueUrl }: { player: Player; rank: number; leagueUrl: (p: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const { getTeamTrades } = useLeagueData();
  const { openSideCard } = usePokemonSideCard();
  const isPlayoff = rank <= 8;
  const points = useMemo(() => rosterPointsUsed(player.roster), [player.roster]);
  const completedTrades = useMemo(() => getTeamTrades(player.id).filter(t => t.status === 'accepted'), [player.id, getTeamTrades]);
  const totalKills = player.roster.reduce((s, m) => s + m.seasonStats.kills, 0);
  const totalDeaths = player.roster.reduce((s, m) => s + m.seasonStats.deaths, 0);

  return (
    <div className="border-b border-border-subtle/50 last:border-b-0">
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
        <Link
          to={leagueUrl(`/teams/${player.id}`)}
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-2.5 min-w-0 group/team"
          style={{ flex: '1 1 0', minWidth: 0 }}
        >
          <div className="transition-transform duration-200 group-hover/team:scale-110">
            <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
          </div>
          <div className="min-w-0 text-left">
            <span className="text-sm font-medium text-text-primary group-hover/team:text-neon transition-colors truncate block leading-snug">
              {player.teamName}
            </span>
            <span className="text-[10px] text-text-muted/60 block leading-snug text-left">{player.name}</span>
          </div>
        </Link>

        {/* Record */}
        <div className="shrink-0">
          <RecordDisplay
            wins={player.record.wins}
            losses={player.record.losses}
            differential={player.record.differential}
            className="text-xs"
          />
        </div>

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
                <div key={mon.name} className="flex items-center gap-2 py-1.5 border-b border-border-subtle/20 last:border-b-0 cursor-pointer hover:bg-surface-overlay/30 rounded px-1 -mx-1 transition-colors" onClick={() => openSideCard(mon.name)}>
                  <PokemonSprite name={mon.name} size="xs" className="shrink-0" />
                  <TeraIndicator
                    name={mon.name}
                    isTeraCaptain={mon.isTeraCaptain}
                    teraTypes={mon.teraTypes}
                    className="text-xs font-medium truncate flex-1"
                  />
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
