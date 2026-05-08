import { Link, useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { RecordDisplay } from '@/components/record-display';
import { pokemonRoute } from '@/lib/pokemon-route';
import { cn } from '@/lib/utils';
import type { FullLeagueData, TeamRow } from '../types';

/** Full standings table with expandable rosters per row. The wider screen
 *  variant of the season-hub's compact league card. */
export function StandingsTab({ data }: { data: FullLeagueData }) {
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardContent className="p-3 space-y-1">
        <div className="grid grid-cols-[2rem_1fr_5rem_5rem_5rem] sm:grid-cols-[2rem_1fr_4rem_4rem_4rem_4rem] gap-2 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-text-muted">
          <span>#</span>
          <span>Team</span>
          <span className="text-right">W-L</span>
          <span className="text-right">Diff</span>
          <span className="text-right hidden sm:block">K</span>
          <span className="text-right">Tiebreak</span>
        </div>
        {data.teams.map((team, i) => (
          <StandingsRow key={team.id} team={team} rank={i + 1} />
        ))}
      </CardContent>
    </Card>
  );
}

function StandingsRow({ team, rank }: { team: TeamRow; rank: number }) {
  const { seasonId, leagueId } = useParams<{ seasonId: string; leagueId: string }>();
  const teamLink = `/archive/${seasonId}/${leagueId}/${team.id}`;

  return (
    <div className="rounded-md hover:bg-surface-overlay/30 transition-colors">
      <Link
        to={teamLink}
        className="grid grid-cols-[2rem_1fr_5rem_5rem_5rem] sm:grid-cols-[2rem_1fr_4rem_4rem_4rem_4rem] gap-2 items-center px-2 py-2 text-xs"
      >
        <span className={cn(
          'font-mono font-bold text-center',
          rank === 1 ? 'text-draw' : rank <= 3 ? 'text-neon' : 'text-text-muted',
        )}>
          {rank}
        </span>
        <div className="flex items-center gap-2 min-w-0">
          <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
          <div className="min-w-0">
            <div className="font-medium text-text-primary truncate">{team.teamName}</div>
            <div className="text-[10px] text-text-muted truncate">{team.coachName}</div>
          </div>
        </div>
        <RecordDisplay
          wins={team.record.wins}
          losses={team.record.losses}
          differential={team.record.differential}
          className="text-[10px] justify-end"
        />
        <span className={cn(
          'text-right font-mono',
          team.record.differential > 0 ? 'text-win' : team.record.differential < 0 ? 'text-loss' : 'text-text-muted',
        )}>
          {team.record.differential > 0 ? '+' : ''}{team.record.differential}
        </span>
        <span className="text-right font-mono text-text-muted hidden sm:block">{team.record.kills}</span>
        <span className="text-right text-[10px] text-text-muted truncate">
          {team.tiebreaker ? `${team.tiebreaker.rule}` : '—'}
        </span>
      </Link>

      {/* Inline roster strip — always visible, not behind hover. The data
       *  sink intent: every roster Pokemon is browsable directly here. */}
      {team.roster.length > 0 && (
        <div className="px-2 pb-2 pl-12 flex flex-wrap gap-x-2 gap-y-0.5">
          {team.roster.sort((a, b) => b.tier - a.tier).map(mon => (
            <Link
              key={mon.name}
              to={pokemonRoute(mon.name)}
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 text-[10px] hover:text-neon transition-colors"
              title={mon.acquiredVia === 'draft' ? 'drafted' : `${mon.acquiredVia} W${mon.acquiredWeek ?? '?'}`}
            >
              <PokemonSprite name={mon.name} size="xs" />
              <span className="text-text-secondary">{mon.name}</span>
              <span className="font-mono text-text-muted">{mon.tier}</span>
              {mon.isTeraCaptain && (
                <Badge variant="outline" className="text-[8px] px-1 py-0 h-3 border-purple-400/40 text-purple-400">T</Badge>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
