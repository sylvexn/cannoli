import { ExternalLink, Play, Link2, Zap, Flame, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ApiReplaySummary } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ReplayEntry } from './replay-types';

interface ReplayRowProps {
  entry: ReplayEntry;
  index: number;
  isViewing: boolean;
  summary: ApiReplaySummary | undefined;
  onToggleViewing: (entry: ReplayEntry | null) => void;
  onCopyShareLink: (matchId: string) => void;
}

/**
 * A single replay row inside a week group. Shows score (with win-color
 * accent), the inline glance line (MVP / sweep / tera-heavy), and the
 * watch / share / open-external action cluster.
 */
export function ReplayRow({
  entry,
  index,
  isViewing,
  summary,
  onToggleViewing,
  onCopyShareLink,
}: ReplayRowProps) {
  const { match, league, homeTeam, awayTeam } = entry;
  const homeWon = (match.homeScore ?? 0) > (match.awayScore ?? 0);
  const awayWon = (match.awayScore ?? 0) > (match.homeScore ?? 0);
  const mvpTeam = summary?.mvp
    ? (summary.mvp.teamId === match.homePlayer ? homeTeam : awayTeam)
    : undefined;

  return (
    <div
      className={cn(
        'stagger-item row-interactive flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors',
        isViewing
          ? 'bg-neon/5 border-neon/20'
          : 'bg-surface-raised border-border-default hover:border-border-default/80',
      )}
      style={{
        ['--i' as never]: Math.min(index, 20),
        ['--card-accent' as never]: league.color,
      }}
    >
      <span className="text-[10px] font-mono text-text-muted w-8 shrink-0">
        W{match.week}
      </span>

      <span
        className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
        style={{ color: league.color, backgroundColor: `${league.color}15` }}
      >
        {league.name.replace(' League', '')}
      </span>

      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Link
          to={`/league/${league.id}/teams/${homeTeam?.id}`}
          viewTransition
          className={cn(
            'text-sm font-medium hover:text-neon transition-colors truncate',
            homeWon ? 'text-win' : 'text-text-secondary',
          )}
        >
          {homeTeam?.teamAbbrev ?? match.homePlayer}
        </Link>

        <span className="text-[11px] font-mono tabular-nums text-text-muted shrink-0">
          <span className={homeWon ? 'text-win' : ''}>{match.homeScore}</span>
          -
          <span className={awayWon ? 'text-win' : ''}>{match.awayScore}</span>
        </span>

        <Link
          to={`/league/${league.id}/teams/${awayTeam?.id}`}
          viewTransition
          className={cn(
            'text-sm font-medium hover:text-neon transition-colors truncate',
            awayWon ? 'text-win' : 'text-text-secondary',
          )}
        >
          {awayTeam?.teamAbbrev ?? match.awayPlayer}
        </Link>
      </div>

      {/* Replay-summary glance — MVP / sweep / tera-heavy */}
      <ReplayRowGlance summary={summary} mvpTeamColor={mvpTeam?.teamColor} />

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => onToggleViewing(isViewing ? null : entry)}
          className={cn(
            'flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded transition-colors',
            isViewing
              ? 'text-neon bg-neon/10'
              : 'text-text-muted hover:text-neon hover:bg-neon/5',
          )}
        >
          <Play size={11} />
          {isViewing ? 'Playing' : 'Watch'}
        </button>
        <button
          onClick={() => onCopyShareLink(match.id)}
          className="text-text-muted hover:text-neon transition-colors p-1"
          title="Copy share link"
        >
          <Link2 size={13} />
        </button>
        <a
          href={match.replayUrl!}
          target="_blank"
          rel="noreferrer"
          className="text-text-muted hover:text-neon transition-colors p-1"
          title="Open replay"
        >
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}

/**
 * Inline glance line for a replay row — surfaces the unused replay_summary
 * data the user has been sitting on: top K-getter as a sprite + name + kill
 * count (if any), tera count when ≥3 (mark as "tera-heavy"), and a sweep
 * pill when the score was 6-0. All optional; renders nothing if the summary
 * hasn't loaded or the match is uneventful.
 */
function ReplayRowGlance({
  summary,
  mvpTeamColor,
}: {
  summary: ApiReplaySummary | undefined;
  mvpTeamColor: string | undefined;
}) {
  if (!summary || !summary.isComplete) return null;

  const hasMvp = summary.mvp && summary.mvp.kills > 0;
  const teraHeavy = summary.teraCount >= 3;
  const sweep = summary.sweep;

  if (!hasMvp && !teraHeavy && !sweep) return null;

  return (
    <div className="hidden md:flex items-center gap-1.5 shrink-0 mr-1">
      {hasMvp && summary.mvp && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-subtle bg-surface-overlay/60"
              style={mvpTeamColor ? { borderColor: `${mvpTeamColor}40` } : undefined}
            >
              <Trophy size={10} className="text-amber-400 shrink-0" />
              <PokemonSprite name={summary.mvp.name} size="xs" className="!w-4 !h-4" />
              <span className="text-[10px] font-mono tabular-nums text-text-secondary">
                {summary.mvp.kills}K
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <span className="font-medium">{summary.mvp.name}</span>
            {' — '}
            <span className="text-win">{summary.mvp.kills}K</span>
            {' / '}
            <span className="text-loss">{summary.mvp.deaths}D</span>
            {' (MVP)'}
          </TooltipContent>
        </Tooltip>
      )}
      {sweep && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400">
          <Flame size={9} />
          Sweep
        </span>
      )}
      {teraHeavy && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-pink/15 text-pink">
              <Zap size={9} />
              {summary.teraCount}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {summary.teraCount} teras used — tera-heavy game
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
