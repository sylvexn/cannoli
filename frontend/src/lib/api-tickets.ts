import { fetchJson, mutateJson } from './api';

export const TICKET_STATUSES = ['new', 'triaged', 'in_progress', 'fixed', 'wont_fix'] as const;
export type TicketStatus = typeof TICKET_STATUSES[number];

export interface TicketRow {
  id: number;
  key: string;
  title: string;
  type: 'bug' | 'idea';
  status: TicketStatus;
  leagueId: string | null;
  fixedIn: string | null;
  githubIssueNumber: number | null;
  createdAt: string;
  reporter: string | null;
}

export interface TicketEvent {
  id: number;
  kind: 'created' | 'status' | 'note' | 'import';
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  text: string | null;
  actor: string | null;
  createdAt: string;
}

export interface TicketDetail extends TicketRow {
  body: string;
  pageUrl: string | null;
  githubUrl: string | null;
  closedAt: string | null;
  screenshotUrl: string | null;
  events: TicketEvent[];
  feedback: { id: number; category: string; body: string; page: string | null; errorRef: string | null; screenshotUrl: string | null } | null;
}

export interface TicketSummary {
  byStatus: Record<TicketStatus, number>;
  recent: TicketRow[];
}

export const ticketsApi = {
  list: (p: { type?: string; leagueId?: string; q?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
    return fetchJson<TicketRow[]>(`/api/admin/tickets${qs ? `?${qs}` : ''}`);
  },
  summary: () => fetchJson<TicketSummary>('/api/admin/tickets/summary'),
  get: (id: number) => fetchJson<TicketDetail>(`/api/admin/tickets/${id}`),
  update: (id: number, patch: { status?: TicketStatus; fixedIn?: string | null; leagueId?: string | null; type?: 'bug' | 'idea' }) =>
    mutateJson<{ success: boolean }>('PATCH', `/api/admin/tickets/${id}`, patch),
  addNote: (id: number, text: string) =>
    mutateJson<{ success: boolean }>('POST', `/api/admin/tickets/${id}/notes`, { text }),
};
