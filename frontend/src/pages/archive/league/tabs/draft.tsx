import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { pokemonRoute } from '@/lib/pokemon-route';
import { cn } from '@/lib/utils';
import type { FullLeagueData, DraftPick, TeamRow } from '../types';

/** Pick-by-pick draft history. Two views: by pick order (timeline) and
 *  by team (each team's draft list). */
export function DraftTab({ data }: { data: FullLeagueData }) {
  const byTeam = new Map<string, DraftPick[]>();
  for (const p of data.draft) {
    if (!byTeam.has(p.teamId)) byTeam.set(p.teamId, []);
    byTeam.get(p.teamId)!.push(p);
  }

  if (data.draft.length === 0) {
    return (
      <div className="text-text-muted text-sm py-12 text-center italic">
        No draft picks recorded for this league.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Per-team grids — caller's most natural view */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data.teams.map(team => {
          const picks = (byTeam.get(team.id) ?? []).sort((a, b) => a.pickNumber - b.pickNumber);
          return (
            <DraftTeamCard key={team.id} team={team} picks={picks} />
          );
        })}
      </div>
    </div>
  );
}

function DraftTeamCard({ team, picks }: { team: TeamRow; picks: DraftPick[] }) {
  const totalPts = picks.reduce((s, p) => s + p.tier, 0);
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center gap-2 mb-1">
          <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
          <span className="text-sm font-medium text-text-primary truncate">{team.teamName}</span>
          <span className="font-mono text-[10px] text-text-muted ml-auto">{totalPts}pts</span>
        </div>
        {picks.map(p => (
          <Link
            key={p.pickNumber}
            to={pokemonRoute(p.pokemonName)}
            className="flex items-center gap-1.5 text-[11px] py-0.5 hover:text-neon transition-colors"
          >
            <span className={cn(
              'font-mono w-6 text-text-muted text-right',
            )}>
              {p.pickNumber}
            </span>
            <PokemonSprite name={p.pokemonName} size="xs" />
            <span className="text-text-primary truncate flex-1">{p.pokemonName}</span>
            <span className="font-mono text-[10px] text-text-muted">{p.tier}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
