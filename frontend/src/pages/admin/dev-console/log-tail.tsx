import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Search, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { devConsoleApi, type DevLogLine, type LogLevel } from '@/lib/api-dev-console';

const LVL_CLS: Record<LogLevel, string> = { debug: 'text-text-muted', info: 'text-text-secondary', warn: 'text-draw', error: 'text-loss' };
const LVL_ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const VIEW_CAP = 2000;
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

export function LogTail() {
  const [lines, setLines] = useState<DevLogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [minLevel, setMinLevel] = useState<LogLevel>('info');
  const [src, setSrc] = useState<'all' | DevLogLine['src']>('all');
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const held = useRef<DevLogLine[]>([]);
  const lastN = useRef(0);
  pausedRef.current = paused;

  // History prefetch, then SSE. Lines arriving while paused are held and flushed on resume.
  useEffect(() => {
    let es: EventSource | null = null;
    let dead = false;
    const onLine = (l: DevLogLine) => {
      if (l.n <= lastN.current) return;
      lastN.current = l.n;
      if (pausedRef.current) held.current.push(l); else setLines(p => [...p, l].slice(-VIEW_CAP));
    };
    devConsoleApi.logs(500).then(r => {
      if (dead) return;
      for (const l of r.lines) lastN.current = Math.max(lastN.current, l.n);
      setLines(r.lines);
      es = new EventSource(devConsoleApi.streamUrl(), { withCredentials: true });
      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false); // EventSource auto-reconnects
      es.onmessage = e => { try { onLine(JSON.parse(e.data)); } catch { /* ignore malformed */ } };
    }).catch(() => setConnected(false));
    return () => { dead = true; es?.close(); };
  }, []);

  const toggle = () => {
    if (paused && held.current.length) { const h = held.current; held.current = []; setLines(p => [...p, ...h].slice(-VIEW_CAP)); }
    setPaused(!paused);
  };

  const shown = useMemo(() => {
    const needle = q.toLowerCase();
    return lines.filter(l => LVL_ORDER.indexOf(l.level) >= LVL_ORDER.indexOf(minLevel) && (src === 'all' || l.src === src) && (!needle || l.msg.toLowerCase().includes(needle)));
  }, [lines, minLevel, src, q]);

  useEffect(() => { if (!paused && box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown, paused]);

  const sel = 'h-8 rounded-md border border-border-default bg-surface-base px-2 text-[12px]';
  const state = !connected ? 'offline' : paused ? 'paused' : 'live';
  return (
    <section>
      <h3 className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-muted mb-1.5">Live log tail <span className="normal-case tracking-normal">in-memory, last 2000 lines, cleared on restart</span></h3>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <select aria-label="Source" className={sel} value={src} onChange={e => setSrc(e.target.value as typeof src)}><option value="all">All sources</option><option value="backend">backend</option><option value="ps-bot">ps-bot</option></select>
        <select aria-label="Minimum level" className={sel} value={minLevel} onChange={e => setMinLevel(e.target.value as LogLevel)}>{LVL_ORDER.map(l => <option key={l} value={l}>{l}+</option>)}</select>
        <div className="relative flex-1 min-w-[140px] max-w-xs"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter text" className="pl-7 h-8" /></div>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={toggle}>{paused ? <Play size={12} /> : <Pause size={12} />}{paused ? 'Resume' : 'Pause'}</Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => { setLines([]); held.current = []; }}><Trash2 size={12} />Clear</Button>
        <span className={cn('ml-auto text-[11px] inline-flex items-center gap-1.5', state === 'live' ? 'text-win' : state === 'paused' ? 'text-draw' : 'text-text-muted')}>
          <span className={cn('size-1.5 rounded-full bg-current', state === 'live' && 'animate-pulse')} />{state}
        </span>
      </div>
      <div ref={box} className="h-[360px] max-h-[55dvh] overflow-auto rounded-lg border border-border-default bg-surface p-2 font-mono text-[11px] leading-5">
        {shown.length === 0 && <div className="text-text-muted p-2">No lines match.</div>}
        {shown.map(l => (
          <div key={l.n} className="flex gap-2 whitespace-pre">
            <span className="text-text-muted shrink-0">{stamp(l.t)}</span>
            <span className={cn('shrink-0 w-12 uppercase', LVL_CLS[l.level])}>{l.level}</span>
            <span className="shrink-0 w-14 text-pink">{l.src}</span>
            <span className={LVL_CLS[l.level]}>{l.msg}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
