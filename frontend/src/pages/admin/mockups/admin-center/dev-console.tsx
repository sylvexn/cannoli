import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleDashed, Loader2, Pause, Play, Search, Trash2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { APPS } from './data';
import { PageTitle, Pill } from './index';

type Level = 'debug' | 'info' | 'warn' | 'error';
interface Line { n: number; t: string; src: 'backend' | 'ps-bot'; level: Level; msg: string }
const LVL_CLS: Record<Level, string> = { debug: 'text-text-muted', info: 'text-text-secondary', warn: 'text-draw', error: 'text-loss' };
const LVL_ORDER: Level[] = ['debug', 'info', 'warn', 'error'];

const SAMPLES: [Line['src'], Level, string][] = [
  ['backend', 'info', 'GET /api/leagues/ruby/standings 200 12ms'],
  ['backend', 'info', 'WS /ws/draft/3 client connected (3 clients)'],
  ['backend', 'debug', 'cost cache hit format=natdexplus'],
  ['backend', 'warn', 'slow query matches.byWeek 412ms'],
  ['backend', 'error', 'TypeError: cannot read "species" of undefined at replay-parser.ts:212'],
  ['ps-bot', 'info', 'battle-gen9natdexdraft-1204 started: Teo vs Rue'],
  ['ps-bot', 'debug', '|move|p1a: Gholdengo|Make It Rain|p2a: Garchomp'],
  ['ps-bot', 'info', 'battle-gen9natdexdraft-1204 |win|Teo captured'],
  ['ps-bot', 'warn', 'websocket closed 1006, reconnecting in 5s'],
  ['backend', 'info', 'POST /api/trades/41/approve 200 31ms'],
];

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

function CiIcon({ ci }: { ci: string }) {
  if (ci === 'pass') return <CheckCircle2 size={13} className="text-win" />;
  if (ci === 'fail') return <XCircle size={13} className="text-loss" />;
  return <Loader2 size={13} className="text-draw animate-spin" />;
}

export function DevConsole() {
  const [lines, setLines] = useState<Line[]>(() => Array.from({ length: 25 }, (_, i) => {
    const [src, level, msg] = SAMPLES[i % SAMPLES.length];
    return { n: i, t: stamp(), src, level, msg };
  }));
  const [paused, setPaused] = useState(false);
  const [minLevel, setMinLevel] = useState<Level>('info');
  const [src, setSrc] = useState<'all' | Line['src']>('all');
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const counter = useRef(25);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      const [s, level, msg] = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
      setLines(p => [...p.slice(-299), { n: counter.current++, t: stamp(), src: s, level, msg }]);
    }, 1200);
    return () => clearInterval(id);
  }, [paused]);

  const shown = useMemo(() => lines.filter(l =>
    LVL_ORDER.indexOf(l.level) >= LVL_ORDER.indexOf(minLevel) && (src === 'all' || l.src === src) &&
    (!q || l.msg.toLowerCase().includes(q.toLowerCase()))), [lines, minLevel, src, q]);

  useEffect(() => { if (!paused && box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown, paused]);

  const sel = 'h-8 rounded-md border border-border-default bg-surface-base px-2 text-[12px]';
  return (
    <div>
      <PageTitle a="Dev" b="Console" accent="text-win" sub="Deploy health and live logs. Nothing else lives here." />

      <section className="mb-5">
        <h3 className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-muted mb-1.5">Deploys <span className="normal-case tracking-normal">via Coolify API, refreshed every 30s</span></h3>
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-overlay/40 text-text-muted text-left"><tr>
              {['App', 'Version', 'Commit', 'Last deploy', 'CI', 'Health'].map((h, i) => <th key={h} className={cn('px-3 py-1.5 font-normal', i === 2 && 'hidden sm:table-cell')}>{h}</th>)}</tr></thead>
            <tbody>
              {APPS.map(a => (
                <tr key={a.name} className="border-t border-border-subtle">
                  <td className="px-3 py-1.5"><div className="font-mono text-text-primary">{a.name}</div><div className="text-[10px] text-text-muted">{a.url}</div></td>
                  <td className="px-3 py-1.5 font-mono whitespace-nowrap">{a.version}</td>
                  <td className="px-3 py-1.5 font-mono hidden sm:table-cell text-text-muted">{a.commit}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-text-muted">{a.deployed}</td>
                  <td className="px-3 py-1.5"><span className="inline-flex items-center gap-1.5"><CiIcon ci={a.ci} />{a.ci}</span></td>
                  <td className="px-3 py-1.5">
                    <Pill className={a.health === 'healthy' ? 'border-win/40 text-win bg-win/10' : a.health === 'degraded' ? 'border-loss/40 text-loss bg-loss/10' : 'border-border-default text-text-muted'}>
                      {a.health === 'stopped' ? <CircleDashed size={9} className="mr-1" /> : null}{a.health}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-muted mb-1.5">Live log tail</h3>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <select className={sel} value={src} onChange={e => setSrc(e.target.value as typeof src)}><option value="all">All sources</option><option value="backend">backend</option><option value="ps-bot">ps-bot</option></select>
          <select className={sel} value={minLevel} onChange={e => setMinLevel(e.target.value as Level)}>{LVL_ORDER.map(l => <option key={l} value={l}>{l}+</option>)}</select>
          <div className="relative flex-1 min-w-[140px] max-w-xs"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter text" className="pl-7 h-8" /></div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setPaused(p => !p)}>{paused ? <Play size={12} /> : <Pause size={12} />}{paused ? 'Resume' : 'Pause'}</Button>
          <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => setLines([])}><Trash2 size={12} />Clear</Button>
          <span className={cn('ml-auto text-[11px] inline-flex items-center gap-1.5', paused ? 'text-draw' : 'text-win')}><span className={cn('size-1.5 rounded-full bg-current', !paused && 'animate-pulse')} />{paused ? 'paused' : 'live'}</span>
        </div>
        <div ref={box} className="h-[320px] max-h-[50dvh] overflow-auto rounded-lg border border-border-default bg-surface p-2 font-mono text-[11px] leading-5">
          {shown.length === 0 && <div className="text-text-muted p-2">No lines match.</div>}
          {shown.map(l => (
            <div key={l.n} className="flex gap-2 whitespace-pre">
              <span className="text-text-muted shrink-0">{l.t}</span>
              <span className={cn('shrink-0 w-12 uppercase', LVL_CLS[l.level])}>{l.level}</span>
              <span className="shrink-0 w-14 text-pink">{l.src}</span>
              <span className={LVL_CLS[l.level]}>{l.msg}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
