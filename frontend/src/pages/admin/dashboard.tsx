/**
 * /admin landing: "what needs me". Tiles read the shared 30s poll the admin
 * shell owns (same numbers as the sidebar badges).
 */
import { Link, useOutletContext } from 'react-router-dom';
import {
  ArrowRight, ArrowLeftRight, Bell, CheckCircle2, Inbox, Sparkles, Trophy, UserPlus, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import type { AdminOutletContext } from '@/lib/api-admin-dashboard';

interface Row { primary: string; secondary: string; meta: string; tag?: string; tone?: string; to?: string }

const ago = (iso: string | null) => {
  if (!iso) return '';
  const t = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

function Tile({ icon: Icon, title, to, count, rows, lane, hint, unavailable }: {
  icon: LucideIcon; title: string; to: string; count: number; rows: Row[];
  lane?: boolean; hint: string; unavailable?: boolean;
}) {
  return (
    <section className={cn('rounded-lg border bg-surface-raised/40 flex flex-col min-w-0', lane ? 'border-pink/40' : 'border-border-default')}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <Icon size={14} className={cn('shrink-0', lane ? 'text-pink' : 'text-text-muted')} />
        <h3 className="text-xs font-mono font-bold uppercase tracking-wide truncate min-w-0">{title}</h3>
        {!unavailable && (
          <span className={cn('ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-mono font-bold tabular-nums shrink-0',
            count ? 'bg-draw/20 text-draw' : 'bg-win/15 text-win')}>{count}</span>
        )}
        <Link to={to} className="ml-auto shrink-0 inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-neon min-h-6">
          Open <ArrowRight size={11} />
        </Link>
      </header>
      <div className="flex-1 divide-y divide-border-subtle">
        {unavailable ? (
          <div className="px-3 py-5 text-[12px] text-text-muted">Not available yet.</div>
        ) : count === 0 ? (
          <div className="flex items-center gap-2 px-3 py-5 text-[12px] text-text-muted">
            <CheckCircle2 size={14} className="text-win shrink-0" /> All clear. {hint}
          </div>
        ) : rows.slice(0, 3).map((r, i) => {
          const body = (
            <>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-text-primary truncate">{r.primary}</div>
                <div className="text-[11px] text-text-muted truncate">{r.secondary}</div>
              </div>
              {r.tag && (
                <span className={cn('shrink-0 rounded border px-1.5 text-[10px] font-mono uppercase', r.tone ?? 'border-border-default text-text-muted')}>{r.tag}</span>
              )}
              <span className="text-[10px] font-mono text-text-muted shrink-0 w-7 text-right">{r.meta}</span>
            </>
          );
          const cls = 'flex items-center gap-2 px-3 py-1.5 min-h-9';
          return r.to
            ? <Link key={i} to={r.to} className={cn(cls, 'hover:bg-surface-overlay/40')}>{body}</Link>
            : <div key={i} className={cls}>{body}</div>;
        })}
      </div>
      {count > 3 && (
        <Link to={to} className="px-3 py-1.5 text-[11px] text-text-muted hover:text-neon border-t border-border-subtle">+ {count - 3} more</Link>
      )}
    </section>
  );
}

export function AdminDashboard() {
  const { queues: q, loaded } = useOutletContext<AdminOutletContext>();
  const { user } = useAuth();

  const fromQueue = (items: { id: number; leagueName: string; what: string; at: string | null }[]): Row[] =>
    items.map(i => ({ primary: i.what, secondary: i.leagueName, meta: ago(i.at) }));

  const t = q?.tickets;
  const tickets: Row[] = (t?.top ?? []).map(r => ({
    primary: r.title, secondary: `CAN-${r.id}`, meta: ago(r.createdAt ?? r.created ?? null),
    tag: r.type, tone: r.type === 'bug' ? 'border-loss/40 text-loss' : 'border-neon/40 text-neon',
    to: `/admin/tickets/${r.id}`,
  }));
  const a = q?.alerts;
  const alertRows: Row[] = [];
  if (a && a.errors > 0) alertRows.push({ primary: `${a.errors} open error group${a.errors === 1 ? '' : 's'}`, secondary: 'Observability', meta: '', tag: 'error', tone: 'border-loss/40 text-loss', to: '/admin/observability' });
  if (a && a.bot !== 'green') alertRows.push({ primary: `PS bot ${a.bot === 'red' ? 'disconnected' : 'idle'}`, secondary: 'PS Bot', meta: '', tag: 'warn', tone: 'border-draw/40 text-draw', to: '/admin/bot' });

  const counts = q ? [q.trades.count, q.fa.count, q.tera.count, t?.open ?? 0, q.playoffs?.count ?? 0, alertRows.length] : [];
  const total = counts.reduce((s, n) => s + n, 0);

  return (
    <div>
      <h1 className="text-lg font-mono font-bold tracking-tight uppercase">
        <span className="text-neon">Admin</span>{' '}<span>Dashboard</span>
      </h1>
      <p className="text-[11px] text-text-muted mb-3">
        {!loaded ? 'Loading...' : !q ? 'Could not load queues.' : total === 0 ? 'Nothing is waiting on you.' : `${total} item${total === 1 ? '' : 's'} waiting`}
      </p>

      {q && total === 0 && (
        <div className="mb-4 rounded-lg border border-win/30 bg-win/10 px-4 py-3 flex items-center gap-2 text-sm text-win">
          <CheckCircle2 size={16} /> All clear.
        </div>
      )}

      {q && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Tile icon={Inbox} title="Tickets" to="/admin/tickets" count={t?.open ?? 0} rows={tickets} unavailable={!t} hint="No new or untriaged tickets." />
          <Tile icon={ArrowLeftRight} title="Trades" to="/admin/trades" count={q.trades.count} rows={fromQueue(q.trades.top)} hint="No trades waiting on staff." />
          <Tile icon={UserPlus} title="FA approvals" to="/admin/free-agents" count={q.fa.count} rows={fromQueue(q.fa.top)} hint="No pending claims." />
          <Tile icon={Sparkles} title="Tera approvals" to="/admin/free-agents?lane=tera" lane count={q.tera.count} rows={fromQueue(q.tera.top)} hint="No pending tera-change requests." />
          <Tile icon={Trophy} title="Playoff approvals" to="/admin/playoffs" count={q.playoffs?.count ?? 0} rows={fromQueue(q.playoffs?.top ?? [])} unavailable={!q.playoffs} hint="No bracket drafts awaiting approval." />
          {user?.role === 'dev' && (
            <Tile icon={Bell} title="Alerts" to="/admin/observability" count={alertRows.length} rows={alertRows} hint="No open errors, bot up." />
          )}
        </div>
      )}

      {t && Object.keys(t.byStatus).length > 0 && (
        <div className="mt-4 flex items-center gap-3 flex-wrap text-[11px] text-text-muted">
          <span className="font-mono uppercase tracking-wide">Tickets</span>
          {Object.entries(t.byStatus).map(([s, n]) => (
            <span key={s} className="font-mono">{s.replace('_', ' ')} {n}</span>
          ))}
          <span className="ml-auto">Refreshes every 30s.</span>
        </div>
      )}
    </div>
  );
}
