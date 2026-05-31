import { useMemo } from 'react';
import { useAppData } from '@/lib/app-data-context';
import { TeamLink } from '@/components/team-link';
import { TeamCoach } from '@/components/team-coach';
import { KDDisplay } from '@/components/kd-display';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TYPE_COLORS } from '@/lib/constants';
import { Sparkles, Trophy } from 'lucide-react';
import type { League, Player, RosterPokemon } from '@/lib/types';

interface LeagueHistoryProps {
  pokemonName: string;
  /**
   * 'card' (default) — wraps content in its own titled Card. Used as a
   * standalone section.
   * 'embedded' — renders only the inner content (no Card chrome). Used when
   * a parent surface already provides the card framing (e.g. the
   * Historical Owners column inside the Scouting Context strip).
   */
  variant?: 'card' | 'embedded';
}

interface PokemonOwnership {
  league: League;
  player: Player;
  mon: RosterPokemon;
}

export function LeagueHistory({ pokemonName, variant = 'card' }: LeagueHistoryProps) {
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

  const empty = ownerships.length === 0;

  const body = empty ? (
    <p className="text-xs text-text-muted leading-snug">
      Not currently on any roster this season.
    </p>
  ) : (
    <div className="space-y-3">
      {ownerships.map(({ league, player, mon }) => (
        <div
          key={`${league.id}-${player.id}`}
          className="rounded-lg border border-border-subtle p-3 space-y-2"
        >
          {/* League + Team header */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className="text-[10px] font-bold uppercase"
              style={{ borderColor: `${league.color}50`, color: league.color }}
            >
              {league.name.replace(' League', '')}
            </Badge>
            <TeamLink
              team={{
                leagueId: league.id,
                teamId: player.id,
                teamName: player.teamName,
                teamAbbrev: player.teamAbbrev,
                teamColor: player.teamColor,
                record: player.record,
              }}
              logoSize="sm"
            >
              <span className="text-sm font-medium text-text-primary hover:text-neon transition-colors">
                {player.teamName}
              </span>
            </TeamLink>
            <TeamCoach player={player} size="xs" className="text-[11px] text-text-muted" />
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-3 flex-wrap">
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
    </div>
  );

  if (variant === 'embedded') {
    return body;
  }

  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-heading font-semibold uppercase tracking-wider text-text-primary flex items-center gap-2">
          <Trophy size={14} className="text-draw" />
          League History
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {body}
      </CardContent>
    </Card>
  );
}
