import { standings, players } from '@/mocks/players';
import { currentSeason, recentMatches, upcomingMatches } from '@/mocks/season';
import { TeamLogo } from '@/components/team-logo';
import { RecordDisplay } from '@/components/record-display';
import { TeamPopover } from '@/components/team-popover';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

function findPlayer(id: string) {
  return players.find(p => p.id === id);
}

export function StandingsPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-heading font-bold text-text-primary">League Hub</h1>
        <p className="text-sm text-text-muted">
          Season {currentSeason.seasonNumber} &middot; Week {currentSeason.currentWeek} of {currentSeason.totalWeeks}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Standings table — takes 2 columns */}
        <Card className="lg:col-span-2 bg-surface-raised border-border-default">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-text-primary">Standings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle text-[11px] uppercase text-text-muted">
                  <th className="px-4 py-2 text-left w-10">#</th>
                  <th className="px-4 py-2 text-left">Team</th>
                  <th className="px-4 py-2 text-right">Record</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((player, i) => {
                  const isPlayoff = i < 8;
                  return (
                    <tr
                      key={player.id}
                      className="group border-b border-border-subtle/50 transition-all duration-200 hover:bg-surface-overlay/60 hover:shadow-[inset_2px_0_0_var(--color-neon)]"
                    >
                      <td className="px-4 py-2.5">
                        {i < 3 ? (
                          <span className={`rank-badge rank-badge-${i + 1} w-6 h-6 text-[10px]`}>
                            {i + 1}
                          </span>
                        ) : (
                          <span className={`text-sm font-bold tabular-nums ${isPlayoff ? 'text-neon' : 'text-text-muted'}`}>
                            {i + 1}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <div className="transition-transform duration-200 group-hover:scale-110">
                            <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
                          </div>
                          <div>
                            <TeamPopover player={player}>
                              <Link to={`/teams/${player.id}`} className="text-left">
                                <span className="text-sm font-medium text-text-primary transition-colors duration-150 group-hover:text-neon cursor-pointer hover:underline decoration-neon/40 underline-offset-2">
                                  {player.name}
                                </span>
                                <span className="text-text-muted ml-1.5 font-normal text-sm">
                                  {player.teamName}
                                </span>
                              </Link>
                            </TeamPopover>
                            <span className="block text-[10px] text-text-muted uppercase tracking-wider">
                              {player.teamAbbrev}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <RecordDisplay
                          wins={player.record.wins}
                          losses={player.record.losses}
                          differential={player.record.differential}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Playoff line indicator */}
            <div className="px-4 py-1.5 text-[10px] text-text-muted uppercase tracking-wider border-t border-border-subtle">
              Top 8 qualify for playoffs
            </div>
          </CardContent>
        </Card>

        {/* Right column — upcoming & recent */}
        <div className="space-y-6">
          {/* Upcoming Matches */}
          <Card className="bg-surface-raised border-border-default">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-text-primary">
                  Week {currentSeason.currentWeek + 1}
                </CardTitle>
                <Badge variant="outline" className="text-neon border-neon/30 text-[10px]">
                  Upcoming
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {upcomingMatches.map(match => {
                const home = findPlayer(match.homePlayer);
                const away = findPlayer(match.awayPlayer);
                if (!home || !away) return null;
                return (
                  <div
                    key={match.id}
                    className="grid grid-cols-[1fr_auto_1fr] items-center py-2 px-3 rounded-md transition-all duration-200 hover:bg-surface-overlay/60"
                  >
                    <Link to={`/teams/${home.id}`} className="flex items-center gap-2 group/home">
                      <TeamLogo abbrev={home.teamAbbrev} color={home.teamColor} size="sm" />
                      <span className="text-sm font-medium text-text-primary group-hover/home:text-neon transition-colors">{home.teamAbbrev}</span>
                    </Link>
                    <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider px-3">vs</span>
                    <Link to={`/teams/${away.id}`} className="flex items-center gap-2 justify-end group/away">
                      <span className="text-sm font-medium text-text-primary group-hover/away:text-pink transition-colors">{away.teamAbbrev}</span>
                      <TeamLogo abbrev={away.teamAbbrev} color={away.teamColor} size="sm" />
                    </Link>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Recent Results */}
          <Card className="bg-surface-raised border-border-default">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-text-primary">
                  Week {currentSeason.currentWeek}
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
                    <Link to={`/teams/${home.id}`} className="flex items-center gap-2 group/home">
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
                    <Link to={`/teams/${away.id}`} className="flex items-center gap-2 justify-end group/away">
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
