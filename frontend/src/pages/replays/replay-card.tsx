import { ExternalLink, Play, Image as ImageIcon, Flame, Zap, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ApiReplaySummary } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ReplayEntry } from './replay-types';

interface ReplayCardProps {
  entry: ReplayEntry;
  index: number;
  isViewing: boolean;
  summary: ApiReplaySummary | undefined;
  onToggleViewing: (entry: ReplayEntry | null) => void;
}

/**
 * Gallery card for a single replay. Reserves a deliberate empty
 * "preview" pane at the top — Slice 11C (`/api/matches/:id/replay-summary`
 * sprite trio) will fill it later. League chip + week chip + team
 * matchup + watch/external buttons sit below.
 */
export function ReplayCard({
  entry,
  index,
  isViewing,
  summary,
  onToggleViewing,
}: ReplayCardProps) {
  const { match, league, homeTeam, awayTeam } = entry;
  const homeWon = (match.homeScore ?? 0) > (match.awayScore ?? 0);
  const awayWon = (match.awayScore ?? 0) > (match.homeScore ?? 0);

  const sweep = summary?.sweep;
  const teraHeavy = summary && summary.teraCount >= 3;
  const hasMvp = summary?.mvp && summary.mvp.kills > 0;

  return (
    <div
      className={cn(
        'stagger-item card-interactive group flex flex-col rounded-xl border overflow-hidden',
        isViewing
          ? 'bg-neon/5 border-neon/30'
          : 'bg-surface-raised border-border-default',
      )}
      style={{
        ['--i' as never]: Math.min(index, 20),
        ['--card-accent' as never]: league.color,
      }}
    >
      {/* Preview pane — deliberately empty. Slice 11C will render the
          sprite trio + sweep flag thumbnail here. */}
      <div
        className="relative h-24 flex items-center justify-center border-b border-border-subtle"
        style={{
          background: `linear-gradient(135deg, ${league.color}10 0%, transparent 70%)`,
        }}
      >
        <div className="flex flex-col items-center gap-1 text-text-muted/60">
          <ImageIcon size={16} strokeWidth={1.5} />
          <span className="text-[9px] font-mono uppercase tracking-widest">No preview</span>
        </div>

        {/* Glance flags float top-right of the preview pane */}
        {(sweep || teraHeavy || hasMvp) && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
            {hasMvp && (
              <span
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400"
                title={`MVP: ${summary!.mvp!.name} (${summary!.mvp!.kills}K)`}
              >
                <Trophy size={9} />
                MVP
              </span>
            )}
            {sweep && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400">
                <Flame size={9} />
                Sweep
              </span>
            )}
            {teraHeavy && (
              <span
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-pink/15 text-pink"
                title={`${summary!.teraCount} teras used`}
              >
                <Zap size={9} />
                {summary!.teraCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-wider">
          <span
            className="px-1.5 py-0.5 rounded font-bold"
            style={{ color: league.color, backgroundColor: `${league.color}15` }}
          >
            {league.name.replace(' League', '')}
          </span>
          <span className="text-text-muted">W{match.week}</span>
          <span className="text-border-default">·</span>
          <span className="text-text-muted truncate">{match.phase ?? 'regular'}</span>
        </div>

        <div className="flex items-center gap-2 text-sm font-medium">
          <Link
            to={`/league/${league.id}/teams/${homeTeam?.id}`}
            viewTransition
            className={cn(
              'hover:text-neon transition-colors truncate',
              homeWon ? 'text-win' : 'text-text-secondary',
            )}
          >
            {homeTeam?.teamAbbrev ?? match.homePlayer}
          </Link>
          <span className="text-[11px] font-mono tabular-nums text-text-muted shrink-0">
            <span className={homeWon ? 'text-win' : ''}>{match.homeScore ?? 0}</span>
            -
            <span className={awayWon ? 'text-win' : ''}>{match.awayScore ?? 0}</span>
          </span>
          <Link
            to={`/league/${league.id}/teams/${awayTeam?.id}`}
            viewTransition
            className={cn(
              'hover:text-neon transition-colors truncate',
              awayWon ? 'text-win' : 'text-text-secondary',
            )}
          >
            {awayTeam?.teamAbbrev ?? match.awayPlayer}
          </Link>
        </div>

        <div className="flex items-center gap-1.5 mt-1">
          <button
            onClick={() => onToggleViewing(isViewing ? null : entry)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-1.5 rounded border transition-colors',
              isViewing
                ? 'text-neon bg-neon/10 border-neon/30'
                : 'text-text-secondary bg-surface-overlay/60 border-border-default hover:text-neon hover:border-neon/40',
            )}
          >
            <Play size={11} />
            {isViewing ? 'Playing' : 'Watch'}
          </button>
          <a
            href={match.replayUrl!}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center text-text-muted hover:text-neon transition-colors p-1.5 rounded border border-border-default hover:border-neon/40"
            title="Open replay in Showdown"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}
