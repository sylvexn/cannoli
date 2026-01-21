import { Link } from 'react-router-dom';
import { leagues } from '@/mocks/leagues';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { RecordDisplay } from '@/components/record-display';
import { cn } from '@/lib/utils';

const phaseColors: Record<string, string> = {
  draft: 'text-draw bg-draw/10',
  regular: 'text-neon bg-neon/10',
  playoffs: 'text-pink bg-pink/10',
  offseason: 'text-text-muted bg-surface-overlay',
};

export function LeagueOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-text-primary">League Overview</h1>
        <p className="text-sm text-text-muted">Season 10 &middot; 3 active leagues</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {leagues.map(league => {
          const standings = [...league.players].sort(
            (a, b) => b.record.wins - a.record.wins || b.record.differential - a.record.differential,
          );

          return (
            <Card key={league.id} className="bg-surface-raised border-border-default overflow-hidden">
              {/* League color bar */}
              <div className="h-1" style={{ backgroundColor: league.color }} />

              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <Link
                    to={`/league/${league.id}`}
                    className="hover:opacity-80 transition-opacity"
                  >
                    <CardTitle
                      className="text-base font-heading"
                      style={{ color: league.color }}
                    >
                      {league.name}
                    </CardTitle>
                  </Link>
                  <Badge
                    variant="outline"
                    className={cn('text-[10px]', phaseColors[league.season.phase])}
                  >
                    {league.season.phase}
                  </Badge>
                </div>
                <p className="text-[11px] text-text-muted">
                  Season {league.season.seasonNumber}
                  {league.season.currentWeek > 0 && ` · Week ${league.season.currentWeek} of ${league.season.totalWeeks}`}
                </p>
              </CardHeader>

              <CardContent>
                {league.hasData && standings.length > 0 ? (
                  <div className="space-y-1">
                    {standings.slice(0, 6).map((player, i) => (
                      <Link
                        key={player.id}
                        to={`/league/${league.id}/teams/${player.id}`}
                        className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-surface-overlay/60 transition-colors group"
                      >
                        <span className={cn(
                          'text-[10px] font-bold tabular-nums w-4 text-center',
                          i < 3 ? 'text-neon' : 'text-text-muted',
                        )}>
                          {i + 1}
                        </span>
                        <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
                        <span className="text-xs text-text-primary group-hover:text-neon transition-colors truncate flex-1">
                          {player.teamAbbrev}
                        </span>
                        <RecordDisplay
                          wins={player.record.wins}
                          losses={player.record.losses}
                          differential={player.record.differential}
                          className="text-[10px]"
                        />
                      </Link>
                    ))}
                    <Link
                      to={`/league/${league.id}`}
                      className="block text-center text-[10px] text-text-muted hover:text-neon transition-colors pt-1"
                    >
                      View full standings →
                    </Link>
                  </div>
                ) : (
                  <div className="text-center py-6 text-text-muted text-sm">
                    Coming soon
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
