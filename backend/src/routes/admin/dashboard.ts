/**
 * GET /api/admin/dashboard — queue counts + top-3 items for the admin landing
 * page and sidebar badges. Staff-only; `alerts` (observability + PS bot) is
 * dev-only and null for admins. Tickets/playoffs have their own endpoints.
 */
import { Elysia } from 'elysia';
import { sqlite } from '../../db';
import { requireStaff } from '../../lib/auth-guards';
import { isDev } from '../../lib/auth';
import { getBotStatus } from '../../lib/ps-bot';

type Row = Record<string, string | number | null>;
interface QueueItem { id: number; leagueId: string; leagueName: string; what: string; at: string | null }

const TOP = 3;

function jsonLen(s: unknown): number {
  try { return (JSON.parse(String(s ?? '[]')) as unknown[]).length; } catch { return 0; }
}

// `where` is a trusted literal (never user input); columns are qualified with q.
function queue(table: 'trades' | 'fa_requests', where: string, at: string, describe: (r: Row) => string) {
  const count = sqlite.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table} q WHERE ${where}`).get()?.n ?? 0;
  const rows = sqlite.query<Row, []>(
    `SELECT q.*, l.name AS league_name FROM ${table} q LEFT JOIN leagues l ON l.id = q.league_id
     WHERE ${where} ORDER BY q.${at} ASC, q.id ASC LIMIT ${TOP}`,
  ).all();
  const top: QueueItem[] = rows.map(r => ({
    id: Number(r.id), leagueId: String(r.league_id), leagueName: String(r.league_name ?? r.league_id),
    what: describe(r), at: (r[at] as string | null) ?? null,
  }));
  return { count, top };
}

export const dashboardRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })
  .get('/api/admin/dashboard', ({ user }) => {
    const trades = queue('trades', `q.status = 'awaiting_admin'`, 'proposed_at',
      r => `${r.proposer_id} / ${r.recipient_id}: ${jsonLen(r.offering)} for ${jsonLen(r.requesting)}`);
    const fa = queue('fa_requests', `q.status = 'pending' AND q.request_type = 'pickup'`, 'requested_at',
      r => `${r.team_id}: +${jsonLen(r.pickups)} / -${jsonLen(r.drops)}`);
    const tera = queue('fa_requests', `q.status = 'pending' AND q.request_type = 'tera_change'`, 'requested_at',
      r => `${r.team_id}: ${jsonLen(r.tera_changes)} tera change(s)`);

    let alerts: null | { errors: number; bot: 'green' | 'yellow' | 'red' } = null;
    if (user && isDev(user)) {
      const errors = sqlite.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM error_groups WHERE status = 'open'`).get()?.n ?? 0;
      alerts = { errors, bot: getBotStatus().health };
    }
    return { trades, fa, tera, alerts };
  });
