import { useState } from 'react';
import type { Match, Player, MatchPokemonEntry } from '@/lib/types';
import { useLeagueData } from '@/lib/league-data-context';
import { TeamLogo } from '@/components/team-logo';
import { TeamCoach } from '@/components/team-coach';
import { TeamCoachVs } from '@/components/team-coach-vs';
import { TYPE_COLORS } from '@/lib/constants';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ChevronDown, Play, Zap, Swords, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ReplayLink } from '@/components/replay-link';
import { useLeagueUrl } from '@/lib/use-league-url';
import { useLeague } from '@/lib/league-context';
import { useAuth } from '@/lib/auth-context';
import { Spoiler } from '@/components/spoiler';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { pokemonRoute } from '@/lib/pokemon-route';


interface MatchCardProps {
  match: Match;
  homePlayer: Player;
  awayPlayer: Player;
}

type KDDetail = { home: MatchPokemonEntry[]; away: MatchPokemonEntry[] };

export function MatchCard({ match, homePlayer, awayPlayer }: MatchCardProps) {
  const leagueUrl = useLeagueUrl();
  const league = useLeague();
  const { getMatchDetail } = useLeagueData();
  const { spoilerFreeMode, spoilerRevealedThrough } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<KDDetail | null>(match.pokemonKD ?? null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const isCompleted = match.homeScore !== undefined;
  const homeWon = isCompleted && (match.homeScore ?? 0) > (match.awayScore ?? 0);
  const awayWon = isCompleted && (match.awayScore ?? 0) > (match.homeScore ?? 0);
  // Whether the W/L color tint on the team names should be suppressed for this
  // viewer — true when the admin gate hard-locks this week, or when the viewer
  // is in spoiler-free mode and hasn't peeked this week yet. Mirrors how
  // standings.tsx hides win-color so the names don't leak the outcome.
  const adminLocked =
    league.resultsRevealedThrough != null && match.week > league.resultsRevealedThrough;
  const perUserHidden =
    spoilerFreeMode && (spoilerRevealedThrough[league.id] ?? 0) < match.week;
  const winColorHidden = adminLocked || perUserHidden;
  // Completed matches always offer the expand affordance; the K/D detail is
  // fetched lazily on first expand.
  const canExpand = isCompleted;

  const handleToggle = () => {
    if (!canExpand) return;
    const next = !expanded;
    setExpanded(next);
    if (next && !detail && !detailLoading) {
      setDetailLoading(true);
      setDetailError(false);
      getMatchDetail(match.id)
        .then(d => {
          if (d) setDetail(d);
          else setDetailError(true);
        })
        .catch(() => setDetailError(true))
        .finally(() => setDetailLoading(false));
    }
  };

  return (
    <Card className="bg-surface-raised border-border-default overflow-hidden">
      {/* Score row */}
      <button
        onClick={handleToggle}
        disabled={!canExpand}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 transition-all duration-200',
          canExpand && 'hover:bg-surface-overlay/40 cursor-pointer',
          !canExpand && 'cursor-default',
        )}
      >
        {/* Home team */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <TeamCoachVs
            team={{
              leagueId: league.id,
              teamId: homePlayer.id,
              teamAbbrev: homePlayer.teamAbbrev,
              teamColor: homePlayer.teamColor,
              logoPath: homePlayer.logoPath,
              owner: homePlayer.owner,
            }}
            side="home"
            size="sm"
          />
          <div className="min-w-0 flex flex-col">
            <Link
              to={leagueUrl(`/teams/${homePlayer.id}`)} viewTransition
              onClick={e => e.stopPropagation()}
              className={cn(
                'text-sm font-medium leading-tight transition-colors block line-clamp-2 hover:text-neon',
                (homeWon && !winColorHidden) ? 'text-win' : isCompleted ? 'text-text-secondary' : 'text-text-primary',
              )}
            >
              {homePlayer.teamName}
            </Link>
            <span onClick={e => e.stopPropagation()} className="block text-[11px] truncate text-text-muted">
              <TeamCoach player={homePlayer} size="xs" />
            </span>
          </div>
        </div>

        {/* Score / VS */}
        {isCompleted ? (
          <Spoiler
            week={match.week}
            leagueId={league.id}
            adminRevealedThrough={league.resultsRevealedThrough}
            className="shrink-0"
          >
            <span className="flex items-center gap-2">
              <span className={cn('text-sm tabular-nums font-bold', homeWon ? 'text-win' : 'text-text-muted')}>
                {match.homeScore}
              </span>
              <span className="text-[10px] text-text-muted">—</span>
              <span className={cn('text-sm tabular-nums font-bold', awayWon ? 'text-win' : 'text-text-muted')}>
                {match.awayScore}
              </span>
            </span>
          </Spoiler>
        ) : (
          <Badge variant="outline" className="text-neon border-neon/30 text-[10px] shrink-0">
            Scheduled
          </Badge>
        )}

        {/* Away team */}
        <div className="flex items-center gap-2.5 justify-end min-w-0 flex-1">
          <div className="min-w-0 flex flex-col text-right">
            <Link
              to={leagueUrl(`/teams/${awayPlayer.id}`)} viewTransition
              onClick={e => e.stopPropagation()}
              className={cn(
                'text-sm font-medium leading-tight transition-colors block line-clamp-2 hover:text-pink',
                (awayWon && !winColorHidden) ? 'text-win' : isCompleted ? 'text-text-secondary' : 'text-text-primary',
              )}
            >
              {awayPlayer.teamName}
            </Link>
            <span onClick={e => e.stopPropagation()} className="block text-[11px] truncate text-text-muted text-right">
              <TeamCoach player={awayPlayer} size="xs" />
            </span>
          </div>
          <TeamCoachVs
            team={{
              leagueId: league.id,
              teamId: awayPlayer.id,
              teamAbbrev: awayPlayer.teamAbbrev,
              teamColor: awayPlayer.teamColor,
              logoPath: awayPlayer.logoPath,
              owner: awayPlayer.owner,
            }}
            side="away"
            size="sm"
          />
        </div>

        {/* Expand / replay / scout indicators */}
        <div className="flex items-center gap-1 shrink-0 justify-end">
          <Link
            to={`/matchup?leagueId=${league.id}&teamA=${homePlayer.id}&teamB=${awayPlayer.id}`}
            onClick={e => e.stopPropagation()}
            title="Scout this matchup"
            className="text-text-muted hover:text-neon transition-colors p-1"
          >
            <Swords className="w-3.5 h-3.5" />
          </Link>
          {isCompleted && ((match.replayUrl && match.replayUrl !== '#') || match.hasReplay) && (
            <ReplayLink
              matchId={match.id}
              context={{
                homeLabel: homePlayer.teamAbbrev,
                awayLabel: awayPlayer.teamAbbrev,
                week: match.week,
                playoffRound: match.playoffRound,
                leagueName: league.name,
                leagueColor: league.color,
              }}
              className="text-text-muted hover:text-neon transition-colors p-1"
            >
              <Play className="w-3.5 h-3.5" />
            </ReplayLink>
          )}
          {canExpand && (
            <ChevronDown className={cn(
              'w-4 h-4 text-text-muted transition-transform duration-200',
              expanded && 'rotate-180',
            )} />
          )}
        </div>
      </button>

      {/* Expanded detail */}
      <div className={cn(
        'grid transition-all duration-200 ease-out',
        expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}>
        <div className="overflow-hidden">
          {detailLoading && (
            <div className="border-t border-border-subtle/50 px-4 py-6 flex items-center justify-center gap-2 text-xs text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading match detail…
            </div>
          )}
          {detailError && !detailLoading && (
            <div className="border-t border-border-subtle/50 px-4 py-6 text-center text-xs text-text-muted">
              No per-Pokemon detail available for this match.
            </div>
          )}
          {detail && !detailLoading && (
            <div className="border-t border-border-subtle/50">
            <Spoiler
              as="div"
              week={match.week}
              leagueId={league.id}
              adminRevealedThrough={league.resultsRevealedThrough}
              className="w-full !block"
            >
              {/* Team column headers */}
              <div className="grid grid-cols-2">
                <div
                  className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5"
                  style={{ backgroundColor: `${homePlayer.teamColor}15`, color: homePlayer.teamColor }}
                >
                  <TeamLogo abbrev={homePlayer.teamAbbrev} color={homePlayer.teamColor} size="sm" logoPath={homePlayer.logoPath} />
                  {homePlayer.teamAbbrev}
                  {homeWon && !winColorHidden && <span className="text-win text-[9px] ml-auto font-bold">W</span>}
                </div>
                <div
                  className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5 justify-end border-l border-border-subtle/30"
                  style={{ backgroundColor: `${awayPlayer.teamColor}15`, color: awayPlayer.teamColor }}
                >
                  {awayWon && !winColorHidden && <span className="text-win text-[9px] mr-auto font-bold">W</span>}
                  {awayPlayer.teamAbbrev}
                  <TeamLogo abbrev={awayPlayer.teamAbbrev} color={awayPlayer.teamColor} size="sm" logoPath={awayPlayer.logoPath} />
                </div>
              </div>

              {/* Pokemon rows side by side */}
              <div className="grid grid-cols-2">
                <PokemonKDColumn
                  entries={detail.home}
                  teamColor={homePlayer.teamColor}
                  won={homeWon}
                  maxKills={Math.max(
                    ...detail.home.map(e => e.kills),
                    ...detail.away.map(e => e.kills),
                    1,
                  )}
                />
                <PokemonKDColumn
                  entries={detail.away}
                  teamColor={awayPlayer.teamColor}
                  won={awayWon}
                  maxKills={Math.max(
                    ...detail.home.map(e => e.kills),
                    ...detail.away.map(e => e.kills),
                    1,
                  )}
                  alignRight
                />
              </div>

              {/* Summary footer */}
              <div className="grid grid-cols-2 border-t border-border-subtle/30">
                <TeamKDSummary entries={detail.home} teamColor={homePlayer.teamColor} />
                <TeamKDSummary entries={detail.away} teamColor={awayPlayer.teamColor} alignRight />
              </div>
            </Spoiler>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function TeraIndicator({ entry, teamColor }: { entry: MatchPokemonEntry; teamColor: string }) {
  if (!entry.teraUsed) return null;

  const teraType = entry.teraType;
  const teraColor = teraType ? TYPE_COLORS[teraType] : teamColor;
  const label = teraType ? teraType.charAt(0).toUpperCase() + teraType.slice(1) : 'Tera';

  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="inline-flex items-center gap-0.5 shrink-0 cursor-default">
          <Zap className="w-3 h-3" style={{ color: teraColor }} fill={teraColor} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="px-2 py-1">
        <span className="flex items-center gap-1.5 text-xs">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: teraColor }}
          />
          Tera {label}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function PokemonKDColumn({
  entries,
  teamColor,
  won,
  maxKills,
  alignRight,
}: {
  entries: MatchPokemonEntry[];
  teamColor: string;
  won: boolean;
  maxKills: number;
  alignRight?: boolean;
}) {
  const { openSideCard } = usePokemonSideCard();
  return (
    <div className={cn('divide-y divide-border-subtle/20', alignRight && 'border-l border-border-subtle/30')}>
      {entries.map(entry => {
        const killWidth = maxKills > 0 ? (entry.kills / maxKills) * 100 : 0;
        return (
          <div
            key={entry.name}
            className={cn(
              'relative flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-surface-overlay/30',
              alignRight && 'flex-row-reverse',
            )}
          >
            {/* Kill contribution bar (subtle background) */}
            {entry.kills > 0 && (
              <div
                className={cn(
                  'absolute top-0 bottom-0 opacity-[0.07]',
                  alignRight ? 'right-0' : 'left-0',
                )}
                style={{
                  width: `${killWidth}%`,
                  backgroundColor: teamColor,
                }}
              />
            )}

            <button type="button" onClick={() => openSideCard(entry.name)} className="shrink-0 relative cursor-pointer">
              <PokemonSprite name={entry.name} size="xs" />
            </button>

            <Link
              to={pokemonRoute(entry.name)}
              className={cn(
                'text-xs truncate relative flex-1 hover:text-neon hover:underline transition-colors',
                won ? 'text-text-primary' : 'text-text-secondary',
                alignRight && 'text-right',
              )}
            >
              {entry.name}
            </Link>

            <TeraIndicator entry={entry} teamColor={teamColor} />

            <span className={cn(
              'tabular-nums text-xs shrink-0 flex items-center gap-0.5 relative',
              alignRight && 'order-first',
            )}>
              <span className="text-win font-medium">{entry.kills}</span>
              <span className="text-text-muted">/</span>
              <span className="text-loss">{entry.deaths}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TeamKDSummary({
  entries,
  teamColor,
  alignRight,
}: {
  entries: MatchPokemonEntry[];
  teamColor: string;
  alignRight?: boolean;
}) {
  const totalKills = entries.reduce((sum, e) => sum + e.kills, 0);
  const totalDeaths = entries.reduce((sum, e) => sum + e.deaths, 0);
  const teraCount = entries.filter(e => e.teraUsed).length;

  return (
    <div className={cn(
      'px-3 py-1.5 flex items-center gap-2 text-[10px]',
      alignRight && 'flex-row-reverse border-l border-border-subtle/30',
    )}>
      <span className="tabular-nums font-medium" style={{ color: teamColor }}>
        {totalKills}K / {totalDeaths}D
      </span>
      {teraCount > 0 && (
        <span className="flex items-center gap-0.5 text-text-muted">
          <Zap className="w-2.5 h-2.5" style={{ color: teamColor }} fill={teamColor} />
          {teraCount}
        </span>
      )}
    </div>
  );
}
