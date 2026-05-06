import { ExternalLink, Play, X, Maximize2, Minimize2, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReplayEntry } from './replay-types';
import { isLocalReplay } from './replay-types';

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
  const local = isLocalReplay(match.replayUrl!);

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
          {local && (
            <a
              href={match.replayUrl!}
              target="_blank"
              rel="noreferrer"
              className="p-1 text-text-muted hover:text-neon transition-colors"
              title="Open in new tab"
            >
              <ExternalLink size={13} />
            </a>
          )}
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-loss transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {local ? (
        <iframe
          src={match.replayUrl!}
          className={cn('w-full border-0 bg-white', theater ? 'flex-1' : '')}
          style={!theater ? { height: '500px' } : undefined}
          title="Replay viewer"
          sandbox="allow-scripts allow-same-origin"
        />
      ) : (
        <div className="flex items-center justify-center py-12 text-text-muted text-sm">
          <a
            href={match.replayUrl!}
            target="_blank"
            rel="noreferrer"
            className="text-neon hover:underline flex items-center gap-1"
          >
            <ExternalLink size={14} />
            Open replay on Pokemon Showdown
          </a>
        </div>
      )}
    </div>
  );
}
