import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '@/lib/app-data-context';
import { TeamLogo } from '@/components/team-logo';
import { TeamCoach } from '@/components/team-coach';
import { KDDisplay } from '@/components/kd-display';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TYPE_COLORS } from '@/lib/constants';
import { Sparkles, Trophy } from 'lucide-react';
import type { League, Player, RosterPokemon } from '@/lib/types';

interface LeagueHistoryProps {
  pokemonName: string;
}

interface PokemonOwnership {
  league: League;
  player: Player;
  mon: RosterPokemon;
}

export function LeagueHistory({ pokemonName }: LeagueHistoryProps) {
  const { leagues } = useAppData();

  const ownerships = useMemo(() => {
    const results: PokemonOwnership[] = [];
    for (const league of leagues) {
      if (!league.hasData) continue;
      for (const player of league.players) {
        const mon = player.roster.find(m => m.name === pokemonName);
        if (mon) {
          results.push({ league, player, mon });
        }
      }
    }
    return results;
  }, [leagues, pokemonName]);

  if (ownerships.length === 0) {
    return (
      <Card className="bg-surface-raised border-border-default">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-heading font-semibold uppercase tracking-wider text-text-primary flex items-center gap-2">
            <Trophy size={14} className="text-draw" />
            League History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-muted">Not currently on any roster this season.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-heading font-semibold uppercase tracking-wider text-text-primary flex items-center gap-2">
          <Trophy size={14} className="text-draw" />
          League History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {ownerships.map(({ league, player, mon }) => (
          <div
            key={`${league.id}-${player.id}`}
            className="rounded-lg border border-border-subtle p-4 space-y-2"
          >
            {/* League + Team header */}
            <div className="flex items-center gap-3">
              <Badge
                variant="outline"
                className="text-[10px] font-bold uppercase"
                style={{ borderColor: `${league.color}50`, color: league.color }}
              >
                {league.name.replace(' League', '')}
              </Badge>
              <Link
                to={`/league/${league.id}/teams/${player.id}`}
                className="flex items-center gap-2 group"
              >
                <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
                <span className="text-sm font-medium text-text-primary group-hover:text-neon transition-colors">
                  {player.teamName}
                </span>
              </Link>
              <TeamCoach player={player} size="xs" className="text-[11px] text-text-muted" />
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-4 flex-wrap">
              <KDDisplay kills={mon.seasonStats.kills} deaths={mon.seasonStats.deaths} className="text-sm" />
              <span className="text-xs font-mono text-text-muted">
                {mon.seasonStats.gp} GP
              </span>
              {mon.seasonStats.gp > 0 && (
                <span className="text-xs font-mono text-text-secondary">
                  {(mon.seasonStats.kills / mon.seasonStats.gp).toFixed(1)} KPG
                </span>
              )}
            </div>

            {/* Tera captain info */}
            {mon.isTeraCaptain && (
              <div className="flex items-center gap-2">
                <Sparkles size={12} className="text-pink" />
                <span className="text-xs text-pink font-medium">Tera Captain</span>
                {mon.teraTypes && mon.teraTypes.length > 0 && (
                  <div className="flex gap-1">
                    {mon.teraTypes.map(t => (
                      <span
                        key={t}
                        className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-white"
                        style={{ backgroundColor: TYPE_COLORS[t] }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
