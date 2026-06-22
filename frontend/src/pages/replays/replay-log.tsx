import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { showdownOrigin } from './replay-types';

/**
 * Custom play-by-play panel for the replay embed.
 *
 * The PS Battle player's native log is a cramped 540px sidebar that scales
 * down badly inside our iframe. Instead, the embed (`?log=ext`) hides that
 * sidebar and mirrors each rendered log row out via postMessage; this panel
 * consumes that stream and renders it in a theme-matched, full-height column
 * beside the (now full-width) battle stage. See showdown/cannoli-replay-embed.html.
 *
 * The forwarded HTML is PS-generated and PS-sanitized (html-sanitizer) and
 * served from our own showdown origin, so dangerouslySetInnerHTML is safe here.
 */

interface LogEntry {
  id: number;
  kind: 'turn' | 'line';
  turn: number;
  html: string;
}

interface BridgeMsg {
  source?: string;
  matchId?: string;
  type?: 'ready' | 'log' | 'state';
  kind?: 'turn' | 'line' | 'clear';
  turn?: number;
  html?: string;
}

interface ReplayLogProps {
  /** Match id the bridge tags messages with — filters out any other embed. */
  matchId: string;
  /** Jump the battle to a turn (posts a seek command back into the iframe). */
  onSeek?: (turn: number) => void;
  className?: string;
}

export function ReplayLog({ matchId, onSeek, className }: ReplayLogProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [liveTurn, setLiveTurn] = useState(0);
  const [ready, setReady] = useState(false);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  // Reset when the match changes (panel may be reused across replays).
  useEffect(() => {
    setEntries([]);
    setLiveTurn(0);
    setReady(false);
    idRef.current = 0;
    atBottomRef.current = true;
  }, [matchId]);

  useEffect(() => {
    const expected = showdownOrigin();
    function onMessage(e: MessageEvent) {
      if (expected !== '*' && e.origin !== expected) return;
      const d = e.data as BridgeMsg;
      if (!d || d.source !== 'cannoli-replay') return;
      if (d.matchId && d.matchId !== matchId) return;

      if (d.type === 'ready') {
        setReady(true);
        return;
      }
      if (d.type === 'state') {
        if (typeof d.turn === 'number') setLiveTurn(d.turn);
        return;
      }
      if (d.type === 'log') {
        if (d.kind === 'clear') {
          setEntries([]);
          return;
        }
        if (typeof d.html !== 'string') return;
        setEntries(prev => [
          ...prev,
          {
            id: idRef.current++,
            kind: d.kind === 'turn' ? 'turn' : 'line',
            turn: d.turn ?? 0,
            html: d.html as string,
          },
        ]);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [matchId]);

  // Keep the view pinned to the newest line unless the user scrolled up.
  useEffect(() => {
    if (atBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border border-border-subtle bg-surface-raised overflow-hidden',
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-surface-overlay shrink-0">
        <ScrollText size={13} className="text-neon" />
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-text-secondary">
          Battle Log
        </span>
        {liveTurn > 0 && (
          <span className="ml-auto text-[10px] text-text-muted tabular-nums">
            Turn <strong className="text-neon">{liveTurn}</strong>
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="cannoli-replay-log flex-1 min-h-0 overflow-y-auto px-3 py-2 text-[12px] leading-relaxed"
      >
        {entries.length === 0 ? (
          <div className="text-text-muted text-xs py-6 text-center">
            {ready ? 'Press play to begin.' : 'Loading log…'}
          </div>
        ) : (
          entries.map(entry =>
            entry.kind === 'turn' ? (
              <div
                key={entry.id}
                onClick={() => onSeek?.(entry.turn)}
                title={`Jump to turn ${entry.turn}`}
                className="group sticky top-0 z-10 my-1.5 flex cursor-pointer items-center gap-2 bg-surface-raised/95 py-1 backdrop-blur"
              >
                <span className="h-px flex-1 bg-border-subtle transition-colors group-hover:bg-neon/40" />
                <span
                  className={cn(
                    'font-mono text-[10px] font-bold uppercase tracking-widest transition-colors',
                    entry.turn === liveTurn
                      ? 'text-neon'
                      : 'text-text-muted group-hover:text-neon',
                  )}
                >
                  Turn {entry.turn}
                </span>
                <span className="h-px flex-1 bg-border-subtle transition-colors group-hover:bg-neon/40" />
              </div>
            ) : (
              <div key={entry.id} dangerouslySetInnerHTML={{ __html: entry.html }} />
            ),
          )
        )}
      </div>

      {/* Restyle PS's forwarded log markup for the dark Cannoli theme. PS emits
          battle messages as <div class="battle-history"> (names/moves in
          <strong>), chat join/leave as <div class="chat">, and turn headers as
          <h2> — we hide those and render our own dividers above. */}
      <style>{`
        .cannoli-replay-log .battle-history { padding: 1px 0; color: #c4c4cf; }
        .cannoli-replay-log .battle-history strong { color: #fff; font-weight: 600; }
        .cannoli-replay-log .battle-history em { font-style: normal; color: #00d9ff; }
        .cannoli-replay-log .battle-history small { color: #8a8a96; }
        .cannoli-replay-log h2 { display: none; }
        .cannoli-replay-log .chat { color: #6f6f7a; font-size: 11px; padding: 1px 0; }
        .cannoli-replay-log .chat small { color: #55555f; }
        .cannoli-replay-log .spacer { height: 4px; }
        .cannoli-replay-log a { color: #00d9ff; }
      `}</style>
    </div>
  );
}
