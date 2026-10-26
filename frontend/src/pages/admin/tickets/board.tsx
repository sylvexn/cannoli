import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { LayoutGrid, List, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { LoadingSprite } from '@/components/loading-sprite';
import { api, type ApiLeague } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { ticketsApi, TICKET_STATUSES, type TicketRow, type TicketStatus } from '@/lib/api-tickets';
import { Pill, STATUS_META, TypeIcon, selectCls } from './meta';

function StatusSelect({ t, onMove }: { t: TicketRow; onMove: (id: number, s: TicketStatus) => void }) {
  return (
    <select aria-label="Move ticket" value={t.status} onClick={e => e.stopPropagation()}
      onChange={e => onMove(t.id, e.target.value as TicketStatus)}
      className="h-6 rounded border border-border-default bg-surface-base px-1 text-[10px]">
      {TICKET_STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
    </select>
  );
}

function TicketCard({ t, onMove }: { t: TicketRow; onMove: (id: number, s: TicketStatus) => void }) {
  return (
    <div draggable onDragStart={e => e.dataTransfer.setData('text/plain', String(t.id))}
      className="rounded-md border border-border-default bg-surface-base hover:border-neon/50 p-2.5 space-y-1.5 cursor-grab active:cursor-grabbing">
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-muted">
        <TypeIcon t={t.type} />{t.key}
        {t.githubIssueNumber && <span title="Imported from GitHub">gh#{t.githubIssueNumber}</span>}
        <span className="ml-auto"><StatusSelect t={t} onMove={onMove} /></span>
      </div>
      <Link to={`/admin/tickets/${t.id}`} className="block text-[13px] leading-snug text-text-primary hover:text-neon line-clamp-2">{t.title}</Link>
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted min-w-0">
        <span className="truncate min-w-0">{t.reporter ?? 'unknown'}</span>
        {t.fixedIn && <Pill className="border-win/40 text-win shrink-0">v{t.fixedIn}</Pill>}
      </div>
    </div>
  );
}

export function TicketsBoard() {
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [leagues, setLeagues] = useState<ApiLeague[]>([]);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [type, setType] = useState('');
  const [league, setLeague] = useState('');
  const [q, setQ] = useState('');
  const [over, setOver] = useState<TicketStatus | null>(null);

  const load = useCallback(() => {
    ticketsApi.list({ type, leagueId: league, q }).then(setTickets).catch(e => { toast.error(getErrorMessage(e, 'Failed to load tickets')); setTickets([]); });
  }, [type, league, q]);
  useEffect(() => { const h = setTimeout(load, q ? 250 : 0); return () => clearTimeout(h); }, [load, q]);
  useEffect(() => { api.getLeagues(true).then(setLeagues).catch(() => {}); }, []);

  const move = useCallback((id: number, status: TicketStatus) => {
    setTickets(ts => ts && ts.map(t => t.id === id ? { ...t, status } : t));
    ticketsApi.update(id, { status }).then(load).catch(e => { toast.error(getErrorMessage(e, 'Move failed')); load(); });
  }, [load]);

  const cols = useMemo(() => TICKET_STATUSES.map(s => [s, (tickets ?? []).filter(t => t.status === s)] as const), [tickets]);
  const leagueName = (id: string | null) => leagues.find(l => l.id === id)?.name ?? '';

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search tickets" className="pl-7 h-8" />
        </div>
        <select className={selectCls} value={type} onChange={e => setType(e.target.value)}>
          <option value="">All types</option><option value="bug">Bug</option><option value="idea">Idea</option>
        </select>
        <select className={selectCls} value={league} onChange={e => setLeague(e.target.value)}>
          <option value="">All leagues</option>{leagues.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div className="flex rounded-md border border-border-default p-0.5 bg-surface-base ml-auto">
          {([['board', LayoutGrid], ['list', List]] as const).map(([v, Icon]) => (
            <button key={v} onClick={() => setView(v)} className={cn('inline-flex items-center gap-1 px-2.5 h-6 rounded text-[11px] capitalize', view === v ? 'bg-surface-overlay text-text-primary' : 'text-text-muted')}>
              <Icon size={12} />{v}
            </button>
          ))}
        </div>
      </div>

      {tickets === null ? <LoadingSprite /> : view === 'board' ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {cols.map(([s, col]) => (
            <div key={s}
              onDragOver={e => { e.preventDefault(); setOver(s); }}
              onDragLeave={() => setOver(o => (o === s ? null : o))}
              onDrop={e => { e.preventDefault(); setOver(null); const id = parseInt(e.dataTransfer.getData('text/plain')); if (id && tickets.find(t => t.id === id)?.status !== s) move(id, s); }}
              className={cn('w-full max-w-[250px] min-w-[220px] shrink-0 rounded-lg border bg-surface-raised/30', over === s ? 'border-neon/60' : 'border-border-subtle')}>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
                <Pill className={STATUS_META[s].cls}>{STATUS_META[s].label}</Pill>
                <span className="text-[11px] font-mono text-text-muted ml-auto">{col.length}</span>
              </div>
              <div className="p-2 space-y-2 max-h-[65dvh] overflow-y-auto">
                {col.map(t => <TicketCard key={t.id} t={t} onMove={move} />)}
                {col.length === 0 && <div className="text-[11px] text-text-muted text-center py-4">Empty</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-overlay/40 text-text-muted text-left">
              <tr>{['ID', 'Title', 'Status', 'League', 'Reporter', 'Fixed in', 'Opened'].map((h, i) => (
                <th key={h} className={cn('px-3 py-1.5 font-normal', (i === 3 || i === 4) && 'hidden sm:table-cell', i === 6 && 'hidden lg:table-cell')}>{h}</th>))}</tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.id} className="border-t border-border-subtle hover:bg-surface-overlay/30">
                  <td className="px-3 py-1.5 font-mono text-text-muted whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><TypeIcon t={t.type} />{t.key}</span></td>
                  <td className="px-3 py-1.5 min-w-[200px]"><Link to={`/admin/tickets/${t.id}`} className="text-text-primary hover:text-neon">{t.title}</Link></td>
                  <td className="px-3 py-1.5"><StatusSelect t={t} onMove={move} /></td>
                  <td className="px-3 py-1.5 hidden sm:table-cell">{leagueName(t.leagueId)}</td>
                  <td className="px-3 py-1.5 hidden sm:table-cell">{t.reporter}</td>
                  <td className="px-3 py-1.5 font-mono">{t.fixedIn ? `v${t.fixedIn}` : ''}</td>
                  <td className="px-3 py-1.5 hidden lg:table-cell text-text-muted whitespace-nowrap">{formatDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tickets.length === 0 && <div className="text-[12px] text-text-muted text-center py-6">No tickets</div>}
        </div>
      )}
    </div>
  );
}
