import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { replayEmbedUrl, showdownOrigin } from './replay-types';
import { ReplayLog } from './replay-log';

/**
 * Replay player layout: the PS battle stage (iframe, log sidebar cropped off
 * via `?log=ext`) beside our own <ReplayLog> play-by-play panel. The iframe
 * mirrors its battle log out by postMessage; this component owns the iframe
 * ref so it can post commands back (seek-to-turn when a log divider is
 * clicked). Stacks vertically on narrow screens, side-by-side on lg+.
 *
 * `initialTurn` (from a /replay/:id?t=N deep link) seeks there once the embed
 * signals it's ready.
 */
export function ReplayPlayer({
  matchId,
  initialTurn,
  className,
}: {
  matchId: string;
  initialTurn?: number;
  className?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const seek = useCallback((turn: number) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: 'cannoli-replay-cmd', cmd: 'seekTurn', turn },
      showdownOrigin(),
    );
  }, []);

  // Deep link: wait for the embed's `ready` (the battle exists and can accept
  // commands), then jump to the requested turn.
  useEffect(() => {
    if (!initialTurn || initialTurn < 1) return;
    const expected = showdownOrigin();
    function onMessage(e: MessageEvent) {
      if (expected !== '*' && e.origin !== expected) return;
      const d = e.data as { source?: string; type?: string; matchId?: string };
      if (d?.source === 'cannoli-replay' && d.type === 'ready' && d.matchId === matchId) {
        seek(initialTurn as number);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [initialTurn, matchId, seek]);

  return (
    <div className={cn('flex flex-col lg:flex-row gap-2 min-h-0', className)}>
      <div className="flex-1 min-h-0 min-w-0 rounded-lg border border-neon/20 bg-[#0e0e10] overflow-hidden">
        <iframe
          ref={iframeRef}
          src={replayEmbedUrl(matchId, { externalLog: true })}
          className="w-full h-full border-0"
          title="Replay viewer"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
      <ReplayLog
        matchId={matchId}
        onSeek={seek}
        className="h-64 shrink-0 lg:h-full lg:w-[340px]"
      />
    </div>
  );
}
