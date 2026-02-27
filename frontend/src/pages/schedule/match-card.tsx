import { useState } from 'react';
import type { Match, Player, MatchPokemonEntry } from '@/lib/types';
import { TeamLogo } from '@/components/team-logo';
import { TYPE_COLORS } from '@/lib/constants';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ChevronDown, ExternalLink, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLeagueUrl } from '@/lib/use-league-url';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';


interface MatchCardProps {
  match: Match;
  homePlayer: Player;
  awayPlayer: Player;
}

export function MatchCard({ match, homePlayer, awayPlayer }: MatchCardProps) {
  const leagueUrl = useLeagueUrl();
  const [expanded, setExpanded] = useState(false);
  const isCompleted = match.homeScore !== undefined;
  const homeWon = isCompleted && (match.homeScore ?? 0) > (match.awayScore ?? 0);
  const awayWon = isCompleted && (match.awayScore ?? 0) > (match.homeScore ?? 0);
  const hasDetail = isCompleted && match.pokemonKD;

  return (
    <Card className="bg-surface-raised border-border-default overflow-hidden">
      {/* Score row */}
      <button
        onClick={() => hasDetail && setExpanded(!expanded)}
        disabled={!hasDetail}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 transition-all duration-200',
          hasDetail && 'hover:bg-surface-overlay/40 cursor-pointer',
          !hasDetail && 'cursor-default',
        )}
      >
        {/* Home team */}
        <Link
          to={leagueUrl(`/teams/${homePlayer.id}`)}
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-2.5 group/home min-w-0 flex-1"
        >
          <TeamLogo abbrev={homePlayer.teamAbbrev} color={homePlayer.teamColor} size="sm" />
          <div className="min-w-0">
            <span className={cn(
              'text-sm font-medium transition-colors block truncate',
              homeWon ? 'text-win' : isCompleted ? 'text-text-secondary' : 'text-text-primary',
              'group-hover/home:text-neon',
            )}>
              {homePlayer.teamName}
            </span>
            <span className="text-[10px] text-text-muted/60 block truncate">
              {homePlayer.name}
            </span>
          </div>
        </Link>

        {/* Score / VS */}
        {isCompleted ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn('text-sm tabular-nums font-bold', homeWon ? 'text-win' : 'text-text-muted')}>
              {match.homeScore}
            </span>
            <span className="text-[10px] text-text-muted">—</span>
            <span className={cn('text-sm tabular-nums font-bold', awayWon ? 'text-win' : 'text-text-muted')}>
              {match.awayScore}
            </span>
          </div>
        ) : (
          <Badge variant="outline" className="text-neon border-neon/30 text-[10px] shrink-0">
            Scheduled
          </Badge>
        )}

        {/* Away team */}
        <Link
          to={leagueUrl(`/teams/${awayPlayer.id}`)}
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-2.5 justify-end group/away min-w-0 flex-1"
        >
          <div className="min-w-0 text-right">
            <span className={cn(
              'text-sm font-medium transition-colors block truncate',
              awayWon ? 'text-win' : isCompleted ? 'text-text-secondary' : 'text-text-primary',
              'group-hover/away:text-pink',
            )}>
              {awayPlayer.teamName}
            </span>
            <span className="text-[10px] text-text-muted/60 block truncate">
              {awayPlayer.name}
            </span>
          </div>
          <TeamLogo abbrev={awayPlayer.teamAbbrev} color={awayPlayer.teamColor} size="sm" />
        </Link>

        {/* Expand / replay indicators */}
        <div className="flex items-center gap-1 shrink-0 w-8 justify-end">
          {isCompleted && match.replayUrl && match.replayUrl !== '#' && (
            <a
              href={match.replayUrl}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-text-muted hover:text-neon transition-colors p-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          {hasDetail && (
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
          {match.pokemonKD && (
            <div className="border-t border-border-subtle/50">
              {/* Team column headers */}
              <div className="grid grid-cols-2">
                <div
                  className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5"
                  style={{ backgroundColor: `${homePlayer.teamColor}15`, color: homePlayer.teamColor }}
                >
                  <TeamLogo abbrev={homePlayer.teamAbbrev} color={homePlayer.teamColor} size="sm" />
                  {homePlayer.teamAbbrev}
                  {homeWon && <span className="text-win text-[9px] ml-auto font-bold">W</span>}
                </div>
                <div
                  className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5 justify-end border-l border-border-subtle/30"
                  style={{ backgroundColor: `${awayPlayer.teamColor}15`, color: awayPlayer.teamColor }}
                >
                  {awayWon && <span className="text-win text-[9px] mr-auto font-bold">W</span>}
                  {awayPlayer.teamAbbrev}
                  <TeamLogo abbrev={awayPlayer.teamAbbrev} color={awayPlayer.teamColor} size="sm" />
                </div>
              </div>

              {/* Pokemon rows side by side */}
              <div className="grid grid-cols-2">
                <PokemonKDColumn
                  entries={match.pokemonKD.home}
                  teamColor={homePlayer.teamColor}
                  won={homeWon}
                  maxKills={Math.max(
                    ...match.pokemonKD.home.map(e => e.kills),
                    ...match.pokemonKD.away.map(e => e.kills),
                    1,
                  )}
                />
                <PokemonKDColumn
                  entries={match.pokemonKD.away}
                  teamColor={awayPlayer.teamColor}
                  won={awayWon}
                  maxKills={Math.max(
                    ...match.pokemonKD.home.map(e => e.kills),
                    ...match.pokemonKD.away.map(e => e.kills),
                    1,
                  )}
                  alignRight
                />
              </div>

              {/* Summary footer */}
              <div className="grid grid-cols-2 border-t border-border-subtle/30">
                <TeamKDSummary entries={match.pokemonKD.home} teamColor={homePlayer.teamColor} />
                <TeamKDSummary entries={match.pokemonKD.away} teamColor={awayPlayer.teamColor} alignRight />
              </div>
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
              'relative flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-surface-overlay/30 cursor-pointer',
              alignRight && 'flex-row-reverse',
            )}
            onClick={() => openSideCard(entry.name)}
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

            <PokemonSprite name={entry.name} size="xs" className="shrink-0 relative" />

            <span className={cn(
              'text-xs truncate relative flex-1 hover:text-neon transition-colors',
              won ? 'text-text-primary' : 'text-text-secondary',
              alignRight && 'text-right',
            )}>
              {entry.name}
            </span>

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
