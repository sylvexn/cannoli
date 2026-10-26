/**
 * Admin issue tracker.
 *
 *   GET   /api/admin/tickets            list (filters: type, leagueId, q)
 *   GET   /api/admin/tickets/summary    { byStatus, recent } for the dashboard
 *   GET   /api/admin/tickets/:id        detail + events + linked feedback
 *   PATCH /api/admin/tickets/:id        status / fixedIn / leagueId / type
 *   POST  /api/admin/tickets/:id/notes  staff note
 */
import { Elysia } from 'elysia';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { requireStaff } from '../../lib/auth-guards';
import { setTicketStatus } from '../../lib/tickets';

const STATUSES = schema.TICKET_STATUSES;
const upload = (p: string | null) => (p ? (p.startsWith('http') ? p : `/uploads/${p}`) : null);

const cols = {
  id: schema.tickets.id, title: schema.tickets.title, type: schema.tickets.type,
  status: schema.tickets.status, leagueId: schema.tickets.leagueId, fixedIn: schema.tickets.fixedIn,
  githubIssueNumber: schema.tickets.githubIssueNumber, createdAt: schema.tickets.createdAt,
  reporter: schema.users.username,
};
const shape = (r: { id: number; reporter: string | null } & Record<string, unknown>) => ({ ...r, key: `CAN-${r.id}` });

export const ticketRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })

  .get('/api/admin/tickets', ({ query }) => {
    const q = (query as Record<string, string | undefined>);
    const conds = [
      q.type === 'bug' || q.type === 'idea' ? eq(schema.tickets.type, q.type) : undefined,
      q.leagueId ? eq(schema.tickets.leagueId, q.leagueId) : undefined,
    ].filter(Boolean) as ReturnType<typeof eq>[];
    const rows = db.select(cols).from(schema.tickets)
      .leftJoin(schema.users, eq(schema.tickets.reporterUserId, schema.users.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(schema.tickets.id)).all();
    const needle = q.q?.trim().toLowerCase();
    return rows.map(shape).filter(r => !needle || `${r.key} ${r.title} ${r.reporter ?? ''}`.toLowerCase().includes(needle));
  })

  .get('/api/admin/tickets/summary', () => {
    const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0])) as Record<typeof STATUSES[number], number>;
    for (const r of db.select({ s: schema.tickets.status, n: sql<number>`count(*)` })
      .from(schema.tickets).groupBy(schema.tickets.status).all()) byStatus[r.s] = r.n;
    const recent = db.select(cols).from(schema.tickets)
      .leftJoin(schema.users, eq(schema.tickets.reporterUserId, schema.users.id))
      .where(inArray(schema.tickets.status, ['new', 'triaged', 'in_progress']))
      .orderBy(desc(schema.tickets.createdAt), desc(schema.tickets.id)).limit(5).all().map(shape);
    return { byStatus, recent };
  })

  .get('/api/admin/tickets/:id', ({ params, set }) => {
    const id = parseInt(params.id);
    const t = Number.isFinite(id) ? db.select().from(schema.tickets).where(eq(schema.tickets.id, id)).get() : undefined;
    if (!t) { set.status = 404; return { error: 'Ticket not found' }; }
    const name = (uid: number | null) => uid == null ? null
      : db.select({ u: schema.users.username }).from(schema.users).where(eq(schema.users.id, uid)).get()?.u ?? null;
    const events = db.select().from(schema.ticketEvents).where(eq(schema.ticketEvents.ticketId, id))
      .orderBy(asc(schema.ticketEvents.id)).all()
      .map(e => ({ ...e, actor: name(e.actorUserId) }));
    const fb = t.feedbackId ? db.select().from(schema.feedback).where(eq(schema.feedback.id, t.feedbackId)).get() : null;
    return {
      ...t, key: `CAN-${t.id}`, reporter: name(t.reporterUserId),
      screenshotUrl: upload(t.screenshotPath), events,
      feedback: fb ? { id: fb.id, category: fb.category, body: fb.body, page: fb.page, errorRef: fb.errorRef, screenshotUrl: upload(fb.screenshotPath) } : null,
    };
  })

  .patch('/api/admin/tickets/:id', ({ params, body, user, set }) => {
    const id = parseInt(params.id);
    const b = (body ?? {}) as { status?: string; fixedIn?: string | null; leagueId?: string | null; type?: string };
    if (!Number.isFinite(id) || !db.select({ i: schema.tickets.id }).from(schema.tickets).where(eq(schema.tickets.id, id)).get()) {
      set.status = 404; return { error: 'Ticket not found' };
    }
    if (b.status !== undefined && !(STATUSES as readonly string[]).includes(b.status)) { set.status = 400; return { error: 'Invalid status' }; }
    if (b.type !== undefined && b.type !== 'bug' && b.type !== 'idea') { set.status = 400; return { error: 'Invalid type' }; }
    if (b.fixedIn && !/^\d+\.\d+(\.\d+)?$/.test(b.fixedIn)) { set.status = 400; return { error: 'fixedIn must look like 1.4' }; }
    if (b.leagueId && !db.select({ i: schema.leagues.id }).from(schema.leagues).where(eq(schema.leagues.id, b.leagueId)).get()) {
      set.status = 400; return { error: 'Unknown league' };
    }
    const actor = parseInt(user!.id);
    if (b.leagueId !== undefined || b.type !== undefined) {
      db.update(schema.tickets).set({
        ...(b.leagueId !== undefined && { leagueId: b.leagueId || null }),
        ...(b.type !== undefined && { type: b.type as 'bug' | 'idea' }),
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.tickets.id, id)).run();
    }
    if (b.status !== undefined) setTicketStatus(id, b.status as typeof STATUSES[number], actor, b.fixedIn || undefined);
    else if (b.fixedIn !== undefined) {
      const cur = db.select({ s: schema.tickets.status }).from(schema.tickets).where(eq(schema.tickets.id, id)).get()!.s;
      if (cur === 'fixed') setTicketStatus(id, 'fixed', actor, b.fixedIn);
    }
    return { success: true };
  })

  .post('/api/admin/tickets/:id/notes', ({ params, body, user, set }) => {
    const id = parseInt(params.id);
    const text = ((body ?? {}) as { text?: string }).text?.trim();
    if (!text) { set.status = 400; return { error: 'text is required' }; }
    if (!Number.isFinite(id) || !db.select({ i: schema.tickets.id }).from(schema.tickets).where(eq(schema.tickets.id, id)).get()) {
      set.status = 404; return { error: 'Ticket not found' };
    }
    db.insert(schema.ticketEvents).values({ ticketId: id, actorUserId: parseInt(user!.id), kind: 'note', text }).run();
    return { success: true };
  });
