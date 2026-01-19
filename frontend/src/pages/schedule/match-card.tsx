import { useState } from 'react';
import type { Match, Player } from '@/lib/types';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ChevronDown, ExternalLink, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

interface MatchCardProps {
  match: Match;
  homePlayer: Player;
  awayPlayer: Player;
}

export function MatchCard({ match, homePlayer, awayPlayer }: MatchCardProps) {
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
          to={`/teams/${homePlayer.id}`}
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-2 group/home min-w-0 flex-1"
        >
          <TeamLogo abbrev={homePlayer.teamAbbrev} color={homePlayer.teamColor} size="sm" />
          <span className={cn(
            'text-sm font-medium transition-colors truncate',
            homeWon ? 'text-win' : isCompleted ? 'text-text-secondary' : 'text-text-primary',
            'group-hover/home:text-neon',
          )}>
            {homePlayer.teamAbbrev}
          </span>
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
          to={`/teams/${awayPlayer.id}`}
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-2 justify-end group/away min-w-0 flex-1"
        >
          <span className={cn(
            'text-sm font-medium transition-colors truncate',
            awayWon ? 'text-win' : isCompleted ? 'text-text-secondary' : 'text-text-primary',
            'group-hover/away:text-pink',
          )}>
            {awayPlayer.teamAbbrev}
          </span>
          <TeamLogo abbrev={awayPlayer.teamAbbrev} color={awayPlayer.teamColor} size="sm" />
        </Link>

        {/* Expand / replay indicators */}
        <div className="flex items-center gap-1 shrink-0 w-12 justify-end">
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
            <div className="px-4 pb-3 border-t border-border-subtle/50">
              <div className="grid grid-cols-2 gap-4 pt-3">
                {/* Home side */}
                <PokemonKDList
                  entries={match.pokemonKD.home}
                  teamColor={homePlayer.teamColor}
                  won={homeWon}
                />
                {/* Away side */}
                <PokemonKDList
                  entries={match.pokemonKD.away}
                  teamColor={awayPlayer.teamColor}
                  won={awayWon}
                  alignRight
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function PokemonKDList({
  entries,
  teamColor,
  won,
  alignRight,
}: {
  entries: { name: string; kills: number; deaths: number; teraUsed: boolean }[];
  teamColor: string;
  won: boolean;
  alignRight?: boolean;
}) {
  return (
    <div className="space-y-1">
      {entries.map(entry => (
        <div
          key={entry.name}
          className={cn(
            'flex items-center gap-2 py-0.5',
            alignRight && 'flex-row-reverse',
          )}
        >
          <PokemonSprite name={entry.name} size="xs" className="shrink-0" />
          <span className={cn(
            'text-xs truncate',
            won ? 'text-text-primary' : 'text-text-secondary',
          )}>
            {entry.name}
          </span>
          {entry.teraUsed && (
            <Zap
              className="w-3 h-3 shrink-0"
              style={{ color: teamColor }}
              fill={teamColor}
            />
          )}
          <span className="ml-auto tabular-nums text-xs shrink-0 flex items-center gap-0.5">
            <span className="text-win">{entry.kills}</span>
            <span className="text-text-muted">/</span>
            <span className="text-loss">{entry.deaths}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
