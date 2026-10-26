import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Bell, Bug, ExternalLink, GitBranch, Image as ImageIcon, Lightbulb, LayoutGrid, List, MessageSquare, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { BASE, LEAGUES, PATCH_VERSIONS, STATUS_META, STATUS_ORDER, type Ticket, type TicketStatus } from './data';
import { PageTitle, Pill, useTickets } from './index';

const TYPE_CLS = { bug: 'border-loss/40 text-loss', idea: 'border-neon/40 text-neon' } as const;
const PRIO_CLS = { high: 'text-loss', med: 'text-draw', low: 'text-text-muted' } as const;

function TypeIcon({ t }: { t: Ticket['type'] }) {
  return t === 'bug' ? <Bug size={12} className="text-loss shrink-0" /> : <Lightbulb size={12} className="text-neon shrink-0" />;
}

function GhBadge({ n, closed }: { n: number; closed: boolean }) {
  return (
    <a href={`https://github.com/sylvexn/cannoli/issues/${n}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
      title="Imported from GitHub. Opens the original issue." className="inline-flex items-center gap-1 rounded border border-border-default bg-surface-overlay/60 px-1.5 h-4 text-[10px] font-mono text-text-secondary hover:text-neon">
      <GitBranch size={9} />#{n}{closed ? '' : ' open'}
    </a>
  );
}

function Card({ t }: { t: Ticket }) {
  return (
    <Link to={`${BASE}/tickets/${t.id}`} className="block rounded-md border border-border-default bg-surface-base hover:border-neon/50 p-2.5 space-y-1.5 transition-colors">
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-muted"><TypeIcon t={t.type} />{t.id}
        <span className={cn('ml-auto uppercase', PRIO_CLS[t.priority])}>{t.priority}</span></div>
      <div className="text-[13px] leading-snug text-text-primary line-clamp-2">{t.title}</div>
      <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-text-muted">
        <span className="truncate min-w-0">{t.reporter}</span>
        <Pill className="border-border-default text-text-secondary">{t.league}</Pill>
        {t.github && <GhBadge {...t.github} />}
        {t.screenshots > 0 && <span className="inline-flex items-center gap-0.5"><ImageIcon size={10} />{t.screenshots}</span>}
        {t.fixedIn && <Pill className="border-win/40 text-win">{t.fixedIn}</Pill>}
      </div>
    </Link>
  );
}

export function TicketsPage() {
  const { tickets } = useTickets();
  const nav = useNavigate();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [type, setType] = useState<'all' | 'bug' | 'idea'>('all');
  const [league, setLeague] = useState('all');
  const [status, setStatus] = useState<'all' | TicketStatus>('all');
  const [src, setSrc] = useState<'all' | 'github'>('all');
  const [q, setQ] = useState('');

  const rows = tickets.filter(t =>
    (type === 'all' || t.type === type) && (league === 'all' || t.league === league) &&
    (status === 'all' || t.status === status) && (src === 'all' || !!t.github) &&
    (!q || `${t.id} ${t.title} ${t.reporter}`.toLowerCase().includes(q.toLowerCase())));
  const sel = 'h-8 rounded-md border border-border-default bg-surface-base px-2 text-[12px]';

  return (
    <div>
      <PageTitle a="Issue" b="Tracker" accent="text-draw" sub="Tickets live in the Cannoli DB. In-app feedback creates a ticket directly."
        right={(
          <div className="flex rounded-md border border-border-default p-0.5 bg-surface-base">
            {([['board', LayoutGrid], ['list', List]] as const).map(([v, Icon]) => (
              <button key={v} onClick={() => setView(v)} className={cn('inline-flex items-center gap-1 px-2.5 h-6 rounded text-[11px] capitalize', view === v ? 'bg-surface-overlay text-text-primary' : 'text-text-muted')}>
                <Icon size={12} />{v}
              </button>
            ))}
          </div>
        )} />

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search tickets" className="pl-7 h-8" />
        </div>
        <select className={sel} value={type} onChange={e => setType(e.target.value as typeof type)}><option value="all">All types</option><option value="bug">Bug</option><option value="idea">Idea</option></select>
        <select className={sel} value={league} onChange={e => setLeague(e.target.value)}><option value="all">All leagues</option>{LEAGUES.map(l => <option key={l}>{l}</option>)}</select>
        <select className={sel} value={status} onChange={e => setStatus(e.target.value as typeof status)}><option value="all">All statuses</option>{STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select>
        <select className={sel} value={src} onChange={e => setSrc(e.target.value as typeof src)}><option value="all">All sources</option><option value="github">Imported from GitHub</option></select>
        <span className="text-[11px] text-text-muted ml-auto">{rows.length} of {tickets.length}</span>
      </div>

      {view === 'board' ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STATUS_ORDER.map(s => {
            const col = rows.filter(t => t.status === s);
            // "Fixed" column shows version label once any ticket has fixedIn.
            return (
              <div key={s} className="w-[250px] shrink-0 rounded-lg border border-border-subtle bg-surface-raised/30">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
                  <Pill className={STATUS_META[s].cls}>{s === 'fixed' ? 'Fixed in vX' : STATUS_META[s].label}</Pill>
                  <span className="text-[11px] font-mono text-text-muted ml-auto">{col.length}</span>
                </div>
                <div className="p-2 space-y-2 max-h-[60dvh] overflow-y-auto">
                  {col.map(t => <Card key={t.id} t={t} />)}
                  {col.length === 0 && <div className="text-[11px] text-text-muted text-center py-4">Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-overlay/40 text-text-muted text-left">
              <tr>{['ID', 'Title', 'Status', 'League', 'Reporter', 'Source', 'Fixed in', 'Opened'].map((h, i) => (
                <th key={h} className={cn('px-3 py-1.5 font-normal', i >= 3 && i <= 4 && 'hidden sm:table-cell', i === 5 && 'hidden md:table-cell', i === 7 && 'hidden lg:table-cell')}>{h}</th>))}</tr>
            </thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id} onClick={() => nav(`${BASE}/tickets/${t.id}`)} className="border-t border-border-subtle hover:bg-surface-overlay/30 cursor-pointer">
                  <td className="px-3 py-1.5 font-mono text-text-muted whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><TypeIcon t={t.type} />{t.id}</span></td>
                  <td className="px-3 py-1.5 min-w-[200px] text-text-primary">{t.title}</td>
                  <td className="px-3 py-1.5"><Pill className={STATUS_META[t.status].cls}>{STATUS_META[t.status].label}</Pill></td>
                  <td className="px-3 py-1.5 hidden sm:table-cell">{t.league}</td>
                  <td className="px-3 py-1.5 hidden sm:table-cell">{t.reporter}</td>
                  <td className="px-3 py-1.5 hidden md:table-cell">{t.github ? <GhBadge {...t.github} /> : <span className="text-text-muted">in-app #{t.feedbackId}</span>}</td>
                  <td className="px-3 py-1.5 font-mono">{t.fixedIn ?? ''}</td>
                  <td className="px-3 py-1.5 hidden lg:table-cell text-text-muted whitespace-nowrap">{t.created}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function TicketDetail() {
  const { id } = useParams();
  const { tickets, setTickets } = useTickets();
  const t = tickets.find(x => x.id === id);
  const [notify, setNotify] = useState(true);
  const [fixedIn, setFixedIn] = useState(t?.fixedIn ?? PATCH_VERSIONS[0]);
  const [note, setNote] = useState('');
  if (!t) return <div className="text-sm text-text-muted">Ticket not found. <Link className="underline" to={`${BASE}/tickets`}>Back</Link></div>;

  const patch = (changes: Partial<Ticket>, text: string) => {
    setTickets(tickets.map(x => x.id === t.id ? { ...x, ...changes, history: [...x.history, { at: 'just now', by: 'you', text }] } : x));
  };
  const setStatus = (s: TicketStatus) => {
    if (s === t.status) return;
    patch({ status: s, fixedIn: s === 'fixed' ? fixedIn : t.fixedIn }, `Status: ${STATUS_META[t.status].label} to ${STATUS_META[s].label}${s === 'fixed' ? ` (${fixedIn})` : ''}${(s === 'fixed' || s === 'wontfix') && notify ? ', reporter notified' : ''}`);
    if ((s === 'fixed' || s === 'wontfix') && notify) toast.success(`Mock: ${t.reporter} notified`);
  };

  return (
    <div>
      <Link to={`${BASE}/tickets`} className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-neon mb-2"><ArrowLeft size={12} />All tickets</Link>
      <div className="flex items-start gap-2 flex-wrap mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-mono text-text-muted"><TypeIcon t={t.type} />{t.id}
            <Pill className={TYPE_CLS[t.type]}>{t.type}</Pill>
            {t.github && <GhBadge {...t.github} />}
          </div>
          <h2 className="text-lg font-semibold leading-snug">{t.title}</h2>
        </div>
        <select value={t.status} onChange={e => setStatus(e.target.value as TicketStatus)} className="h-8 rounded-md border border-border-default bg-surface-base px-2 text-sm">
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="space-y-4 min-w-0">
          {t.github && (
            <div className="rounded-md border border-border-default bg-surface-overlay/30 px-3 py-2 text-[12px] flex items-center gap-2 flex-wrap">
              <GitBranch size={13} className="text-text-muted" />
              Imported once from GitHub issue #{t.github.n}. Comments below the cutover live here only.
              <a className="ml-auto inline-flex items-center gap-1 text-neon hover:underline" href={`https://github.com/sylvexn/cannoli/issues/${t.github.n}`} target="_blank" rel="noreferrer">Original <ExternalLink size={11} /></a>
            </div>
          )}
          <p className="text-sm text-text-secondary whitespace-pre-line">{t.body}</p>
          {t.screenshots > 0 && (
            <div className="flex gap-2 flex-wrap">
              {Array.from({ length: t.screenshots }).map((_, i) => (
                <div key={i} className="w-40 h-24 rounded-md border border-border-default bg-surface-overlay/40 flex items-center justify-center text-text-muted"><ImageIcon size={20} /></div>
              ))}
            </div>
          )}
          <section>
            <h3 className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-muted mb-2">Status history</h3>
            <ol className="relative border-l border-border-default ml-1.5 space-y-2.5">
              {t.history.map((h, i) => (
                <li key={i} className="pl-4 relative text-[12px]">
                  <span className="absolute -left-[4.5px] top-1.5 size-2 rounded-full bg-neon" />
                  <span className="text-text-primary">{h.text}</span>
                  <span className="text-text-muted"> · {h.by} · {h.at}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="space-y-2">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-muted">Staff note</h3>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Internal note (not sent to reporter)" />
            <Button size="sm" variant="outline" disabled={!note} className="h-7 gap-1" onClick={() => { patch({}, `Note: ${note}`); setNote(''); }}><MessageSquare size={12} />Add note</Button>
          </section>
        </div>

        <aside className="space-y-3 text-[12px]">
          <dl className="rounded-lg border border-border-default divide-y divide-border-subtle">
            {[
              ['Reporter', <Link key="r" to="/admin/users" className="text-neon hover:underline">{t.reporter}</Link>],
              ['League', t.league],
              ['Page', <Link key="p" to={t.page} className="text-neon hover:underline break-all font-mono text-[11px]">{t.page}</Link>],
              ['Priority', <span key="pr" className={PRIO_CLS[t.priority]}>{t.priority}</span>],
              ['Assignee', t.assignee ?? 'unassigned'],
              ['Opened', t.created],
              ['Feedback', t.feedbackId ? <span key="f" className="font-mono">submission #{t.feedbackId}</span> : <span key="n" className="text-text-muted">none (imported)</span>],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-baseline justify-between gap-3 px-3 py-1.5"><dt className="text-text-muted shrink-0">{k}</dt><dd className="text-right min-w-0">{v}</dd></div>
            ))}
          </dl>
          <div className="rounded-lg border border-border-default p-3 space-y-2.5">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-muted">Resolve</div>
            <label className="flex items-center gap-2">Fixed in
              <select value={fixedIn} onChange={e => setFixedIn(e.target.value)} className="h-7 rounded-md border border-border-default bg-surface-base px-2 text-[12px] ml-auto">
                {PATCH_VERSIONS.map(v => <option key={v}>{v}</option>)}
              </select>
            </label>
            {t.fixedIn && <Link to="/admin/mockups/patch-notes" className="text-neon hover:underline text-[11px] block">{t.fixedIn} in patch notes</Link>}
            <label className="flex items-center gap-2"><Bell size={13} className="text-text-muted" />Notify reporter<Switch className="ml-auto" checked={notify} onCheckedChange={setNotify} /></label>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 h-8 bg-win/20 text-win hover:bg-win/30" onClick={() => setStatus('fixed')}>Mark fixed</Button>
              <Button size="sm" variant="outline" className="flex-1 h-8" onClick={() => setStatus('wontfix')}>Won't fix</Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
