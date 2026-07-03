import { Link } from 'react-router-dom';
import type { Player } from '@/lib/types';
import type { Match } from '@/lib/types';
import type { LeagueSeason } from '@/lib/types';
import { TeamLogo } from '@/components/team-logo';
import { Play, Swords, Calendar } from 'lucide-react';
import { ReplayLink } from '@/components/replay-link';
import { cn } from '@/lib/utils';

interface NextMatchBannerProps {
  player: Player;
  matches: Match[];
  byeWeeks: Set<number>;
  opponents: Player[];
  season: LeagueSeason;
  leagueId: string;
}

/**
 * Compact banner shown beneath the team header during regular/playoffs.
 * Shows the current week's match (or BYE) with opponent info, score if
 * completed, and a Scout deep link if upcoming.
 */
export function NextMatchBanner({
  player, matches, byeWeeks, opponents, season, leagueId,
}: NextMatchBannerProps) {
  const cw = season.currentWeek;
  if (season.phase !== 'regular' && season.phase !== 'playoffs') return null;

  const isBye = byeWeeks.has(cw);
  const thisWeekMatch = matches.find(m => m.week === cw);
  const nextMatch = matches.find(m =>
    m.week > cw && m.homeScore == null && m.awayScore == null,
  );
  const display = thisWeekMatch ?? nextMatch;

  if (isBye) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-md bg-surface-overlay/30 border border-border-subtle">
        <Calendar size={12} className="text-text-muted shrink-0" />
        <span className="text-xs text-text-muted">BYE — Week {cw}.</span>
        {nextMatch && (
          <span className="text-[11px] text-text-muted/70 ml-auto">
            Next: W{nextMatch.week}.
          </span>
        )}
      </div>
    );
  }

  if (!display) return null;

  const isHome = display.homePlayer === player.id;
  const opponentId = isHome ? display.awayPlayer : display.homePlayer;
  const opponent = opponents.find(p => p.id === opponentId);
  if (!opponent) return null;

  const myScore = isHome ? display.homeScore : display.awayScore;
  const theirScore = isHome ? display.awayScore : display.homeScore;
  const completed = display.homeScore != null && display.awayScore != null;
  const won = completed && (myScore ?? 0) > (theirScore ?? 0);
  const lost = completed && (myScore ?? 0) < (theirScore ?? 0);
  const isUpcoming = display === nextMatch && !thisWeekMatch;

  const labelColor = won ? 'text-win' : lost ? 'text-loss' : isUpcoming ? 'text-neon' : 'text-pink';
  const label =
    completed ? (won ? 'WON' : lost ? 'LOST' : 'DRAW')
    : isUpcoming ? `NEXT · W${display.week}`
    : `THIS WEEK · W${display.week}`;

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-2 rounded-md border',
      completed
        ? won ? 'bg-win/5 border-win/20'
          : lost ? 'bg-loss/5 border-loss/20'
          : 'bg-surface-overlay/40 border-border-subtle'
        : 'bg-neon/5 border-neon/20',
    )}>
      <span className={cn('text-[9px] font-mono font-bold uppercase tracking-widest shrink-0', labelColor)}>
        {label}
      </span>
      <span className="text-text-muted text-[11px]">vs</span>
      <Link
        to={`/league/${leagueId}/teams/${opponent.id}`}
        className="flex items-center gap-1.5 min-w-0 flex-1 hover:opacity-80 transition-opacity"
      >
        <TeamLogo abbrev={opponent.teamAbbrev} color={opponent.teamColor} size="sm" logoPath={opponent.logoPath} />
        <span className="text-xs font-medium text-text-primary truncate">{opponent.teamName}</span>
        <span className="text-[10px] text-text-muted font-mono shrink-0">
          ({opponent.record.wins}-{opponent.record.losses})
        </span>
      </Link>
      {completed && (
        <span className="font-mono text-xs tabular-nums shrink-0">
          <span className={won ? 'text-win font-bold' : 'text-text-secondary'}>{myScore}</span>
          <span className="text-text-muted/40 mx-0.5">-</span>
          <span className={lost ? 'text-loss font-bold' : 'text-text-secondary'}>{theirScore}</span>
        </span>
      )}
      <div className="flex items-center gap-1 shrink-0">
        {display.replayUrl && (
          <ReplayLink
            matchId={display.id}
            context={{
              homeLabel: player.teamAbbrev,
              awayLabel: opponent.teamAbbrev,
              week: display.week,
              playoffRound: display.playoffRound,
            }}
            className="p-1 rounded text-text-muted hover:text-neon transition-colors"
            title="Replay"
          >
            <Play size={11} />
          </ReplayLink>
        )}
        {!completed && (
          <Link
            to={`/matchup?leagueId=${leagueId}&teamA=${player.id}&teamB=${opponent.id}`}
            className="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase bg-neon/10 text-neon hover:bg-neon/20 transition-colors flex items-center gap-1"
          >
            <Swords size={10} />
            Scout
          </Link>
        )}
      </div>
    </div>
  );
}
