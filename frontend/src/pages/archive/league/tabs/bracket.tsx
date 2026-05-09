import { Link, useParams } from 'react-router-dom';
import { Play, Trophy } from 'lucide-react';
import { TeamLogo } from '@/components/team-logo';
import { cn } from '@/lib/utils';
import type { FullLeagueData, ScheduleMatch, TeamRow } from '../types';

/** Playoff bracket tab. Lays out QF / SF / F columns side-by-side. */
export function BracketTab({ data }: { data: FullLeagueData }) {
  const teamMap = new Map(data.teams.map(t => [t.id, t]));
  const playoffs = data.schedule.filter(m => m.phase === 'playoffs');
  if (playoffs.length === 0) {
    return (
      <div className="text-text-muted text-sm py-12 text-center italic">
        No playoff bracket recorded for this league.
      </div>
    );
  }

  const rounds: { key: 'qf' | 'sf' | 'f'; label: string; matches: ScheduleMatch[] }[] = [
    { key: 'qf', label: 'Quarterfinals', matches: playoffs.filter(m => m.playoffRound === 'qf') },
    { key: 'sf', label: 'Semifinals', matches: playoffs.filter(m => m.playoffRound === 'sf') },
    { key: 'f', label: 'Finals', matches: playoffs.filter(m => m.playoffRound === 'f') },
  ];

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {rounds.map(r => {
        if (r.matches.length === 0) return null;
        return (
          <div key={r.key} className="min-w-[220px] flex-1 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted text-center">
              {r.label}
            </div>
            {r.matches.map(m => (
              <BracketMatch key={m.id} match={m} teamMap={teamMap} isFinal={r.key === 'f'} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function BracketMatch({
  match, teamMap, isFinal,
}: {
  match: ScheduleMatch;
  teamMap: Map<string, TeamRow>;
  isFinal: boolean;
}) {
  const home = teamMap.get(match.homeTeamId);
  const away = teamMap.get(match.awayTeamId);
  const hasResult = match.homeScore != null && match.awayScore != null;
  const homeWon = hasResult && match.homeScore! > match.awayScore!;
  const awayWon = hasResult && match.awayScore! > match.homeScore!;
  const { seasonId, leagueId } = useParams<{ seasonId: string; leagueId: string }>();

  return (
    <div className={cn(
      'rounded-lg overflow-hidden border bg-surface-raised',
      isFinal && hasResult ? 'border-draw/40 shadow-[0_0_24px_-12px_rgba(250,191,36,0.3)]' : 'border-border-default',
    )}>
      <BracketSide
        team={home}
        seed={match.homeSeed}
        score={match.homeScore}
        won={homeWon}
        otherWon={awayWon}
        seasonId={seasonId}
        leagueId={leagueId}
      />
      <div className="h-px bg-border-subtle" />
      <BracketSide
        team={away}
        seed={match.awaySeed}
        score={match.awayScore}
        won={awayWon}
        otherWon={homeWon}
        seasonId={seasonId}
        leagueId={leagueId}
      />
      {match.replayUrl && (
        <a
          href={match.replayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 px-2 py-1 text-[10px] text-purple-400 hover:bg-purple-400/10 transition-colors border-t border-border-subtle"
        >
          <Play size={9} /> Watch replay
        </a>
      )}
      {isFinal && hasResult && (homeWon || awayWon) && (
        <div className="px-2 py-1 bg-draw/10 border-t border-draw/30 flex items-center justify-center gap-1.5">
          <Trophy size={11} className="text-draw" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-draw font-bold">Champion</span>
        </div>
      )}
    </div>
  );
}

function BracketSide({
  team, seed, score, won, otherWon, seasonId, leagueId,
}: {
  team: TeamRow | undefined;
  seed: number | null;
  score: number | null;
  won: boolean;
  otherWon: boolean;
  seasonId?: string;
  leagueId?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2 px-3 py-2', won && 'bg-win/5')}>
      <span className="text-[10px] font-mono text-text-muted w-4 shrink-0">{seed ?? '–'}</span>
      {team ? (
        <Link
          to={`/archive/${seasonId}/${leagueId}/${team.id}`}
          className="flex items-center gap-2 flex-1 min-w-0 hover:text-text-primary transition-colors"
        >
          <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" logoPath={team.logoPath} />
          <span className={cn(
            'text-xs truncate',
            won ? 'text-win font-medium' : otherWon ? 'text-text-muted' : 'text-text-primary',
          )}>
            {team.teamName}
          </span>
        </Link>
      ) : (
        <span className="flex-1 text-xs text-text-muted">TBD</span>
      )}
      {score != null && (
        <span className={cn(
          'font-mono font-bold text-sm shrink-0',
          won ? 'text-win' : otherWon ? 'text-text-muted' : 'text-text-primary',
        )}>
          {score}
        </span>
      )}
    </div>
  );
}
