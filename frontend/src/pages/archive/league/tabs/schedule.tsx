import { Card, CardContent } from '@/components/ui/card';
import { TeamLogo } from '@/components/team-logo';
import { Badge } from '@/components/ui/badge';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FullLeagueData, ScheduleMatch, TeamRow } from '../types';

/** Full season schedule grouped by week. Includes every regular-season AND
 *  playoff match. Replay link surfaces if the matches row carries one. */
export function ScheduleTab({ data }: { data: FullLeagueData }) {
  const teamMap = new Map(data.teams.map(t => [t.id, t]));
  const regular = data.schedule.filter(m => m.phase === 'regular');
  const byWeek = new Map<number, ScheduleMatch[]>();
  for (const m of regular) {
    if (!byWeek.has(m.week)) byWeek.set(m.week, []);
    byWeek.get(m.week)!.push(m);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  return (
    <div className="space-y-3">
      {weeks.map(w => (
        <Card key={w} className="bg-surface-raised border-border-default">
          <CardContent className="p-3 space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">Week {w}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
              {byWeek.get(w)!.map(m => (
                <ScheduleMatchRow key={m.id} match={m} teamMap={teamMap} />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ScheduleMatchRow({ match, teamMap }: { match: ScheduleMatch; teamMap: Map<string, TeamRow> }) {
  const home = teamMap.get(match.homeTeamId);
  const away = teamMap.get(match.awayTeamId);
  const hasResult = match.homeScore != null && match.awayScore != null;
  const homeWon = hasResult && match.homeScore! > match.awayScore!;
  const awayWon = hasResult && match.awayScore! > match.homeScore!;
  const tied = hasResult && match.homeScore === match.awayScore;
  const ff = match.forfeitedBy;

  return (
    <div className={cn(
      'rounded-md border bg-surface-overlay/30 px-2 py-1.5 text-[11px]',
      'border-border-subtle',
    )}>
      <div className="flex items-center gap-2">
        <div className={cn('flex items-center gap-1.5 min-w-0 flex-1', homeWon && 'font-medium text-text-primary', awayWon && 'text-text-muted')}>
          {home && <TeamLogo abbrev={home.teamAbbrev} color={home.teamColor} size="sm" />}
          <span className="truncate">{home?.teamAbbrev ?? '???'}</span>
        </div>
        <span className={cn(
          'font-mono font-bold w-8 text-right',
          tied ? 'text-draw' : homeWon ? 'text-win' : awayWon ? 'text-text-muted' : 'text-text-muted',
        )}>
          {hasResult ? match.homeScore : '–'}
        </span>
        <span className="text-text-muted text-[9px]">vs</span>
        <span className={cn(
          'font-mono font-bold w-8',
          tied ? 'text-draw' : awayWon ? 'text-win' : homeWon ? 'text-text-muted' : 'text-text-muted',
        )}>
          {hasResult ? match.awayScore : '–'}
        </span>
        <div className={cn('flex items-center gap-1.5 min-w-0 flex-1 justify-end', awayWon && 'font-medium text-text-primary', homeWon && 'text-text-muted')}>
          <span className="truncate">{away?.teamAbbrev ?? '???'}</span>
          {away && <TeamLogo abbrev={away.teamAbbrev} color={away.teamColor} size="sm" />}
        </div>
      </div>
      <div className="flex items-center gap-1 justify-end mt-0.5 text-[9px]">
        {ff && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 h-3 border-loss/40 text-loss">
            {ff === 'both' ? 'DOUBLE FF' : ff === 'home' ? `${home?.teamAbbrev} FF` : `${away?.teamAbbrev} FF`}
          </Badge>
        )}
        {match.replayUrl && (
          <a
            href={match.replayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-purple-400 hover:underline"
            onClick={e => e.stopPropagation()}
          >
            <Play size={9} /> Replay
          </a>
        )}
      </div>
    </div>
  );
}
