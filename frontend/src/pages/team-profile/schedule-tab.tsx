import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import type { Player, Match } from '@/lib/types';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { useLeagueUrl } from '@/lib/use-league-url';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { ReplayLink } from '@/components/replay-link';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { api } from '@/lib/api';
import type { ApiMatchPokemon, ApiReplaySummary } from '@/lib/api';
import { spriteTitle } from '@/pages/replays/brought-preview';

export type ScheduleRow =
  | { kind: 'match'; week: number; match: Match }
  | { kind: 'bye'; week: number };

interface ScheduleTabProps {
  player: Player;
  scheduleRows: ScheduleRow[];
}

/** True when a match has something the in-app viewer can actually play back —
 *  either a stored battle log (bulk-imported matches: `hasReplay`, no url) or
 *  a linked external replay URL. Mirrors the fallback used everywhere else
 *  replays are listed (schedule/match-card.tsx, replays.tsx, replays/stream.tsx). */
function hasWatchableReplay(match: Match): boolean {
  return (!!match.replayUrl && match.replayUrl !== '#') || !!match.hasReplay;
}

/**
 * Schedule tab body for the team profile page. Lists this team's matches +
 * byes for the season, one dense row per week, with a play button for
 * completed matches that have a replay and a compact strip of the Pokemon
 * this team brought (fetched lazily, batched by match id).
 */
export function ScheduleTab({ player, scheduleRows }: ScheduleTabProps) {
  const leagueUrl = useLeagueUrl();
  const league = useLeague();
  const { players } = useLeagueData();
  const season = league.season;

  // Batched, keyed-by-matchId fetch of replay summaries (brought Pokemon) for
  // completed matches that have a watchable replay. Both hits and misses are
  // cached (misses as `null`) so a failed/empty lookup is never retried.
  const [summaries, setSummaries] = useState<Map<string, ApiReplaySummary | null>>(new Map());
  const neededIds = useMemo(
    () => scheduleRows
      .filter((r): r is Extract<ScheduleRow, { kind: 'match' }> => r.kind === 'match' && hasWatchableReplay(r.match))
      .map(r => r.match.id),
    [scheduleRows],
  );

  useEffect(() => {
    const missing = neededIds.filter(id => !summaries.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map(id => api.getReplaySummary(id).catch(() => null))).then(results => {
      if (cancelled) return;
      setSummaries(prev => {
        const next = new Map(prev);
        missing.forEach((id, i) => next.set(id, results[i]));
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [neededIds, summaries]);

  return (
    <div className="p-3 flex-1 flex flex-col gap-0.5">
      {scheduleRows.map(row => {
        if (row.kind === 'bye') {
          const isCurrent = row.week === (season?.currentWeek ?? 0) + 1;
          return (
            <div
              key={`bye-${row.week}`}
              className={`flex items-center gap-2 px-2 rounded flex-1 min-h-[28px] ${isCurrent ? 'bg-neon/5' : ''}`}
            >
              <span className="w-6 text-[10px] font-mono tabular-nums text-text-muted shrink-0 text-right">{row.week}</span>
              <span className="w-4 text-center text-[10px] text-text-muted">—</span>
              <span className="text-[10px] tracking-widest font-mono uppercase text-text-muted flex-1">Bye</span>
            </div>
          );
        }
        const match = row.match;
        const isHome = match.homePlayer === player.id;
        const opponentId = isHome ? match.awayPlayer : match.homePlayer;
        const opponent = players.find(p => p.id === opponentId);
        if (!opponent) return null;

        const hasResult = match.homeScore != null && match.awayScore != null;
        const myScore = isHome ? match.homeScore : match.awayScore;
        const theirScore = isHome ? match.awayScore : match.homeScore;
        const won = hasResult && (myScore ?? 0) > (theirScore ?? 0);
        const lost = hasResult && (myScore ?? 0) < (theirScore ?? 0);
        const isCurrent = match.week === (season?.currentWeek ?? 0) + 1;
        const watchable = hasWatchableReplay(match);
        const summary = summaries.get(match.id);
        const brought = summary ? (isHome ? summary.home : summary.away) : null;

        return (
          <div key={match.id} className={`flex items-center gap-2 px-2 rounded transition-colors flex-1 min-h-[28px] ${isCurrent ? 'bg-neon/5' : 'hover:bg-surface-overlay/50'}`}>
            <span className="w-6 text-[10px] font-mono tabular-nums text-text-muted shrink-0 text-right">{match.week}</span>
            {hasResult ? (
              <span className={`w-4 text-center text-[10px] font-bold ${won ? 'text-win' : lost ? 'text-loss' : 'text-draw'}`}>
                {won ? 'W' : lost ? 'L' : 'D'}
              </span>
            ) : (
              <span className="w-4 text-center text-[10px] text-text-muted">—</span>
            )}
            <Link to={leagueUrl(`/teams/${opponentId}`)} viewTransition className="flex items-center gap-1.5 flex-1 min-w-0">
              <TeamLogo abbrev={opponent.teamAbbrev} color={opponent.teamColor} size="sm" logoPath={opponent.logoPath} />
              <span className="text-xs text-text-secondary hover:text-neon transition-colors truncate font-medium">{opponent.teamAbbrev}</span>
            </Link>
            {brought && brought.length > 0 && <BroughtStrip mons={brought} />}
            {hasResult && (
              <span className="font-mono text-[11px] tabular-nums text-text-muted">
                {myScore}<span className="mx-px">-</span>{theirScore}
              </span>
            )}
            {watchable && (
              <ReplayLink
                matchId={match.id}
                context={{
                  homeLabel: player.teamAbbrev,
                  awayLabel: opponent.teamAbbrev,
                  week: match.week,
                  playoffRound: match.playoffRound,
                  leagueName: league.name,
                  leagueColor: league.color,
                }}
                className="text-text-muted/40 hover:text-neon transition-colors"
              >
                <Play size={10} />
              </ReplayLink>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Compact, non-overlapping strip of the Pokemon this team brought to a
 *  match — click a sprite to open its side card. Deliberately unpadded (only
 *  as many slots as were actually brought) to stay dense in a schedule list. */
function BroughtStrip({ mons }: { mons: ApiMatchPokemon[] }) {
  const { openSideCard } = usePokemonSideCard();
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {mons.map(mon => (
        <button
          key={mon.name}
          type="button"
          onClick={(e) => { e.stopPropagation(); openSideCard(mon.name); }}
          title={spriteTitle(mon)}
          className="shrink-0 cursor-pointer hover:scale-110 transition-transform"
        >
          <PokemonSprite name={mon.name} size="xs" shiny={!!mon.isShiny} />
        </button>
      ))}
    </div>
  );
}
