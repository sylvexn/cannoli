import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, GitBranch, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSprite } from '@/components/loading-sprite';
import { api, type ApiLeague } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { ticketsApi, TICKET_STATUSES, type TicketDetail as T, type TicketStatus } from '@/lib/api-tickets';
import { Pill, STATUS_META, TypeIcon, selectCls } from './meta';

export function TicketDetail({ id }: { id: number }) {
  const [t, setT] = useState<T | null>(null);
  const [versions, setVersions] = useState<string[]>([]);
  const [leagues, setLeagues] = useState<ApiLeague[]>([]);
  const [fixedIn, setFixedIn] = useState('');
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => {
    ticketsApi.get(id).then(d => { setT(d); setFixedIn(f => d.fixedIn ?? f); }).catch(() => setMissing(true));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.adminListPatchNotes().then(p => {
      const v = p.map(x => x.version).filter((x): x is string => !!x);
      setVersions(v); setFixedIn(f => f || v[0] || '');
    }).catch(() => {});
    api.getLeagues(true).then(setLeagues).catch(() => {});
  }, []);

  const act = (p: Promise<unknown>, ok?: string) =>
    p.then(() => { if (ok) toast.success(ok); load(); }).catch(e => toast.error(getErrorMessage(e, 'Update failed')));
  const setStatus = (status: TicketStatus) =>
    act(ticketsApi.update(id, { status, ...(status === 'fixed' && fixedIn ? { fixedIn } : {}) }),
      status === 'fixed' || status === 'wont_fix' ? 'Saved. Reporter notified.' : 'Saved');

  if (missing) return <div className="text-sm text-text-muted">Ticket not found. <Link className="underline" to="/admin/tickets">Back</Link></div>;
  if (!t) return <LoadingSprite />;
  const shot = t.screenshotUrl ?? t.feedback?.screenshotUrl;

  return (
    <div>
      <Link to="/admin/tickets" className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-neon mb-2"><ArrowLeft size={12} />All tickets</Link>
      <div className="flex items-start gap-2 flex-wrap mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-mono text-text-muted">
            <TypeIcon t={t.type} />{t.key}
            <Pill className={STATUS_META[t.status].cls}>{STATUS_META[t.status].label}</Pill>
            {t.githubUrl && (
              <a href={t.githubUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-neon" title="Original GitHub issue">
                <GitBranch size={10} />#{t.githubIssueNumber}<ExternalLink size={10} />
              </a>
            )}
          </div>
          <h2 className="text-lg font-semibold leading-snug break-words">{t.title}</h2>
        </div>
        <select aria-label="Status" value={t.status} onChange={e => setStatus(e.target.value as TicketStatus)} className={selectCls}>
          {TICKET_STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="space-y-4 min-w-0">
          <p className="text-sm text-text-secondary whitespace-pre-line break-words">{t.body}</p>
          {shot && <a href={shot} target="_blank" rel="noreferrer"><img src={shot} alt="Screenshot" className="max-h-64 rounded-md border border-border-default" /></a>}
          <section>
            <h3 className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-muted mb-2">History</h3>
            <ol className="relative border-l border-border-default ml-1.5 space-y-2.5">
              {t.events.map(e => (
                <li key={e.id} className="pl-4 relative text-[12px]">
                  <span className="absolute -left-[4.5px] top-1.5 size-2 rounded-full bg-neon" />
                  <span className="text-text-primary break-words">
                    {e.kind === 'status' && e.toStatus ? `${e.fromStatus ? STATUS_META[e.fromStatus].label : '-'} to ${STATUS_META[e.toStatus].label}` : e.kind === 'note' ? 'Note' : e.kind === 'import' ? 'Imported' : 'Created'}
                    {e.text ? `: ${e.text}` : ''}
                  </span>
                  <span className="text-text-muted"> · {e.actor ?? 'system'} · {formatDateTime(e.createdAt)}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="space-y-2">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-muted">Staff note</h3>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Internal note (not sent to reporter)" />
            <Button size="sm" variant="outline" disabled={!note.trim()} className="h-7 gap-1"
              onClick={() => act(ticketsApi.addNote(id, note).then(() => setNote('')))}><MessageSquare size={12} />Add note</Button>
          </section>
        </div>

        <aside className="space-y-3 text-[12px]">
          <dl className="rounded-lg border border-border-default divide-y divide-border-subtle">
            {([
              ['Reporter', t.reporter ?? 'unknown'],
              ['Opened', formatDateTime(t.createdAt)],
              ['Page', t.pageUrl ? <Link key="p" to={t.pageUrl} className="text-neon hover:underline break-all font-mono text-[11px]">{t.pageUrl}</Link> : '-'],
              ['Feedback', t.feedback ? <span key="f" className="font-mono">#{t.feedback.id}{t.feedback.errorRef ? ` / ${t.feedback.errorRef}` : ''}</span> : '-'],
            ] as const).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-1.5"><dt className="text-text-muted shrink-0">{k}</dt><dd className="text-right min-w-0">{v}</dd></div>
            ))}
            <label className="flex items-center justify-between gap-3 px-3 py-1.5">
              <span className="text-text-muted">Type</span>
              <select value={t.type} onChange={e => act(ticketsApi.update(id, { type: e.target.value as 'bug' | 'idea' }))} className={selectCls}>
                <option value="bug">Bug</option><option value="idea">Idea</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 px-3 py-1.5">
              <span className="text-text-muted">League</span>
              <select value={t.leagueId ?? ''} onChange={e => act(ticketsApi.update(id, { leagueId: e.target.value || null }))} className={`${selectCls} min-w-0`}>
                <option value="">None</option>{leagues.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          </dl>
          <div className="rounded-lg border border-border-default p-3 space-y-2.5">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-muted">Resolve (notifies reporter)</div>
            <label className="flex items-center gap-2">Fixed in
              <select value={fixedIn} onChange={e => setFixedIn(e.target.value)} className={`${selectCls} ml-auto`}>
                <option value="">None</option>{versions.map(v => <option key={v} value={v}>v{v}</option>)}
              </select>
            </label>
            {t.fixedIn && <Link to={`/patch-notes#v${t.fixedIn}`} className="text-neon hover:underline text-[11px] block">v{t.fixedIn} in patch notes</Link>}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 h-8 bg-win/20 text-win hover:bg-win/30" onClick={() => setStatus('fixed')}>{t.status === 'fixed' ? 'Update version' : 'Mark fixed'}</Button>
              <Button size="sm" variant="outline" className="flex-1 h-8" onClick={() => setStatus('wont_fix')}>Won't fix</Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
