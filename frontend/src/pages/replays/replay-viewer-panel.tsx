import { Play, X, Maximize2, Minimize2, Link2, FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReplayEntry } from './replay-types';
import { ReplayPlayer } from './replay-player';

/**
 * Simulated matches (mock.cannoli.live season simulator) carry a synthetic
 * `replayUrl` under a `/sim/` path but have no real battle log on disk, so
 * the embed page would 404. Detect that here and render a friendly notice
 * instead of an iframe that resolves to a raw HTTP-error box.
 */
function isSyntheticReplay(replayUrl: string | null | undefined): boolean {
  return !!replayUrl && replayUrl.includes('/sim/');
}

interface ReplayViewerPanelProps {
  entry: ReplayEntry;
  theater: boolean;
  onToggleTheater: () => void;
  onCopyShareLink: (matchId: string) => void;
  onClose: () => void;
}

/**
 * Inline replay viewer: header with title + share/theater/close controls,
 * then either an iframe (for whitelisted hosts) or an external link.
 */
export function ReplayViewerPanel({
  entry,
  theater,
  onToggleTheater,
  onCopyShareLink,
  onClose,
}: ReplayViewerPanelProps) {
  const { match, league, homeTeam, awayTeam } = entry;
  const synthetic = isSyntheticReplay(match.replayUrl);

  return (
    <div className={cn(
      'mb-4 rounded-lg border border-neon/20 bg-surface-raised overflow-hidden',
      theater && 'flex-1 flex flex-col mb-0',
    )}>
      <div className="flex items-center justify-between px-3 py-2 bg-surface-overlay border-b border-border-subtle">
        <div className="flex items-center gap-2 text-xs">
          <Play size={12} className="text-neon" />
          <span className="font-semibold text-text-primary">
            {homeTeam?.teamAbbrev ?? 'Home'} vs {awayTeam?.teamAbbrev ?? 'Away'}
          </span>
          <span className="text-text-muted">
            — W{match.week}
          </span>
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ color: league.color, backgroundColor: `${league.color}15` }}
          >
            {league.name.replace(' League', '')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onCopyShareLink(match.id)}
            className="p-1 text-text-muted hover:text-neon transition-colors"
            title="Copy share link"
          >
            <Link2 size={13} />
          </button>
          <button
            onClick={onToggleTheater}
            className="p-1 text-text-muted hover:text-neon transition-colors"
            title={theater ? 'Exit theater mode' : 'Theater mode'}
          >
            {theater ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-loss transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {synthetic ? (
        <div
          className={cn(
            'w-full flex flex-col items-center justify-center gap-3 bg-[#0e0e10] px-6 text-center',
            theater ? 'flex-1' : '',
          )}
          style={!theater ? { height: '600px' } : undefined}
        >
          <FlaskConical size={32} className="text-draw" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-text-secondary">
              This match was simulated — no battle replay available.
            </p>
            <p className="text-xs text-text-muted max-w-sm">
              Simulator results are generated without a Pokemon Showdown battle,
              so there's no log to play back. Per-Pokemon K/D is still on the
              match card.
            </p>
          </div>
        </div>
      ) : (
        <div
          className={cn('flex bg-[#0e0e10] p-2', theater ? 'flex-1' : '')}
          style={!theater ? { height: '600px' } : undefined}
        >
          <ReplayPlayer matchId={match.id} className="flex-1" />
        </div>
      )}
    </div>
  );
}
