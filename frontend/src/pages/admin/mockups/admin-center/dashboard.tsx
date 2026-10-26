import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowLeftRight, Bell, CheckCircle2, Inbox, Sparkles, Trophy, UserPlus, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ALERTS, BASE, FA_APPROVALS, PLAYOFF_APPROVALS, TERA_APPROVALS, TRADE_APPROVALS, STATUS_META, type QueueItem } from './data';
import { PageTitle, Pill, useTickets } from './index';

interface Row { primary: string; secondary: string; meta: string; tag?: string; to?: string; tone?: string }

function Tile({ icon: Icon, title, to, rows, lane, clear, hint }: {
  icon: LucideIcon; title: string; to: string; rows: Row[]; lane?: boolean; clear: boolean; hint: string;
}) {
  const count = clear ? 0 : rows.length;
  return (
    <section className={cn('rounded-lg border bg-surface-raised/40 flex flex-col min-w-0', lane ? 'border-pink/40' : 'border-border-default')}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <Icon size={14} className={lane ? 'text-pink' : 'text-text-muted'} />
        <h3 className="text-xs font-mono font-bold uppercase tracking-wide truncate min-w-0">{title}</h3>
        <span className={cn('ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-mono font-bold tabular-nums',
          count ? 'bg-draw/20 text-draw' : 'bg-win/15 text-win')}>{count}</span>
        <Link to={to} className="ml-auto shrink-0 inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-neon min-h-6">
          Open <ArrowRight size={11} />
        </Link>
      </header>
      <div className="flex-1 divide-y divide-border-subtle">
        {count === 0 ? (
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
              {r.tag && <Pill className={r.tone}>{r.tag}</Pill>}
              <span className="text-[10px] font-mono text-text-muted shrink-0 w-7 text-right">{r.meta}</span>
            </>
          );
          return r.to ? (
            <Link key={i} to={r.to} className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-overlay/40 min-h-9">{body}</Link>
          ) : <div key={i} className="flex items-center gap-2 px-3 py-1.5 min-h-9">{body}</div>;
        })}
      </div>
      {count > 3 && (
        <Link to={to} className="px-3 py-1.5 text-[11px] text-text-muted hover:text-neon border-t border-border-subtle">+ {count - 3} more</Link>
      )}
    </section>
  );
}

const q = (items: QueueItem[]): Row[] => items.map(i => ({ primary: `${i.who}: ${i.what}`, secondary: i.league, meta: i.age }));

export function Dashboard() {
  const [clear, setClear] = useState(false);
  const { tickets } = useTickets();
  const open = tickets.filter(t => t.status === 'new' || t.status === 'triaged');
  const alerts = ALERTS.map(a => ({ primary: a.what, secondary: a.src, meta: a.age, tag: a.level === 'loss' ? 'error' : 'warn', tone: a.level === 'loss' ? 'border-loss/40 text-loss' : 'border-draw/40 text-draw' }));
  const total = clear ? 0 : open.length + TRADE_APPROVALS.length + FA_APPROVALS.length + TERA_APPROVALS.length + PLAYOFF_APPROVALS.length + ALERTS.length;

  return (
    <div>
      <PageTitle a="Admin" b="Dashboard" accent="text-neon"
        sub={clear ? 'Nothing is waiting on you.' : `${total} items waiting across ${6} queues`}
        right={<Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setClear(c => !c)}>{clear ? 'Show pending state' : 'Preview "all clear" state'}</Button>} />

      {clear && (
        <div className="mb-4 rounded-lg border border-win/30 bg-win/10 px-4 py-3 flex items-center gap-2 text-sm text-win">
          <CheckCircle2 size={16} /> All clear. Next up: Ruby week 5 deadline Monday night.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Tile icon={Inbox} title="Tickets" to={`${BASE}/tickets`} clear={clear} hint="No new or untriaged tickets."
          rows={open.map(t => ({ primary: t.title, secondary: `${t.id} · ${t.reporter} · ${t.league}`, meta: t.created.slice(5, 10), tag: t.type, tone: t.type === 'bug' ? 'border-loss/40 text-loss' : 'border-neon/40 text-neon', to: `${BASE}/tickets/${t.id}` }))} />
        <Tile icon={ArrowLeftRight} title="Trades" to="/admin/trades" clear={clear} hint="No trades waiting on staff." rows={q(TRADE_APPROVALS)} />
        <Tile icon={UserPlus} title="FA approvals" to="/admin/free-agents" clear={clear} hint="No pending claims." rows={q(FA_APPROVALS)} />
        <Tile icon={Sparkles} title="Tera approvals" to="/admin/free-agents" lane clear={clear} hint="No pending tera-change requests." rows={q(TERA_APPROVALS)} />
        <Tile icon={Trophy} title="Playoff approvals" to="/admin/mockups/playoffs" clear={clear} hint="No bracket drafts awaiting approval." rows={q(PLAYOFF_APPROVALS)} />
        <Tile icon={Bell} title="Alerts" to="/admin/observability" clear={clear} hint="No errors, bot up, last deploy green." rows={alerts} />
      </div>

      <div className="mt-4 flex items-center gap-3 flex-wrap text-[11px] text-text-muted">
        <span className="font-mono uppercase tracking-wide">Ticket statuses</span>
        {(['new', 'triaged', 'in_progress'] as const).map(s => (
          <Pill key={s} className={STATUS_META[s].cls}>{STATUS_META[s].label} {tickets.filter(t => t.status === s).length}</Pill>
        ))}
        <span className="ml-auto">Counts refresh every 30s; same numbers feed the sidebar badges.</span>
      </div>
    </div>
  );
}
