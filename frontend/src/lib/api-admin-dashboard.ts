/**
 * Admin dashboard data: one poll feeds both the /admin landing tiles and the
 * sidebar badges. Tickets and playoff approvals come from endpoints owned by
 * other features and are tolerated when absent (404 -> null).
 */
import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface QueueItem { id: number; leagueId: string; leagueName: string; what: string; at: string | null }
export interface Queue { count: number; top: QueueItem[] }
export interface TicketRow { id: string | number; title: string; type?: string; status?: string; created?: string }
export interface TicketsSummary { open: number; byStatus: Record<string, number>; top: TicketRow[] }
export interface AdminQueues {
  trades: Queue; fa: Queue; tera: Queue;
  alerts: { errors: number; bot: 'green' | 'yellow' | 'red' } | null;
  tickets: TicketsSummary | null;
  playoffs: Queue | null;
}

async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// Tolerant readers: the tickets/playoffs endpoints are built elsewhere.
/* eslint-disable @typescript-eslint/no-explicit-any */
function toTickets(raw: any): TicketsSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.byStatus ?? raw.counts ?? raw;
  const byStatus: Record<string, number> = {};
  for (const [k, v] of Object.entries(src)) if (typeof v === 'number') byStatus[k] = v;
  const open = (byStatus.new ?? 0) + (byStatus.triaged ?? 0);
  const top = Array.isArray(raw.top) ? raw.top : Array.isArray(raw.recent) ? raw.recent : [];
  return { open, byStatus, top };
}
function toPlayoffs(raw: any): Queue | null {
  if (raw == null) return null;
  const items: any[] = Array.isArray(raw) ? raw : raw.drafts ?? raw.items ?? [];
  return {
    count: typeof raw.count === 'number' ? raw.count : items.length,
    top: items.slice(0, 3).map((d, i) => ({
      id: d.id ?? i, leagueId: d.leagueId ?? '', leagueName: d.leagueName ?? d.leagueId ?? 'Playoffs',
      what: d.title ?? d.what ?? `Bracket draft${d.week ? ` week ${d.week}` : ''}`, at: d.createdAt ?? null,
    })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function fetchAdminQueues(): Promise<AdminQueues | null> {
  const [base, tickets, playoffs] = await Promise.all([
    getOrNull<Pick<AdminQueues, 'trades' | 'fa' | 'tera' | 'alerts'>>('/api/admin/dashboard'),
    getOrNull('/api/admin/tickets/summary'),
    getOrNull('/api/admin/playoffs/drafts/pending'),
  ]);
  if (!base) return null;
  return { ...base, tickets: toTickets(tickets), playoffs: toPlayoffs(playoffs) };
}

/** Outlet context the admin shell hands to the Dashboard (single shared poll). */
export interface AdminOutletContext { queues: AdminQueues | null; loaded: boolean }

/** Polls every 30s (default). `null` until the first successful load. */
export function useAdminQueues(intervalMs = 30_000) {
  const [data, setData] = useState<AdminQueues | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = () => fetchAdminQueues().then(d => { if (alive) { if (d) setData(d); setLoaded(true); } });
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs]);
  return { data, loaded };
}

/** Sidebar badge count per nav slug (full path under /admin). */
export function badgeFor(path: string, q: AdminQueues | null): number {
  if (!q) return 0;
  switch (path) {
    case 'tickets': return q.tickets?.open ?? 0;
    case 'trades': return q.trades.count;
    case 'free-agents': return q.fa.count;
    case 'free-agents?lane=tera': return q.tera.count;
    case 'playoffs': return q.playoffs?.count ?? 0;
    default: return 0;
  }
}
