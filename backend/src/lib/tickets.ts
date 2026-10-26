/**
 * Ticket core: creation from feedback and status moves (with reporter
 * notification on Fixed / Won't fix). Shared by routes/feedback.ts and
 * routes/admin/tickets.ts.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { notifyUser } from './notifications/notify';

type Status = typeof schema.TICKET_STATUSES[number];

export function createTicketFromFeedback(f: {
  feedbackId: number; userId: number; category: string; title: string; body: string;
  page: string | null; screenshotPath: string | null;
}) {
  const t = db.insert(schema.tickets).values({
    title: f.title, body: f.body,
    type: f.category === 'bug' ? 'bug' : 'idea',
    reporterUserId: f.userId, feedbackId: f.feedbackId,
    pageUrl: f.page, screenshotPath: f.screenshotPath,
  }).returning({ id: schema.tickets.id }).get()!;
  db.insert(schema.ticketEvents).values({
    ticketId: t.id, actorUserId: f.userId, kind: 'created', toStatus: 'new', text: 'Submitted via in-app feedback',
  }).run();
  return t.id;
}

/** Move a ticket. No-op (returns false) when the status is unchanged. */
export function setTicketStatus(id: number, to: Status, actorUserId: number | null, fixedIn?: string | null): boolean {
  const t = db.select().from(schema.tickets).where(eq(schema.tickets.id, id)).get();
  if (!t) throw new Error('Ticket not found');
  if (t.status === to && fixedIn === undefined) return false;

  const now = new Date().toISOString();
  const resolved = to === 'fixed' || to === 'wont_fix';
  const newFixedIn = to === 'fixed' ? (fixedIn ?? t.fixedIn) : null;
  db.update(schema.tickets).set({
    status: to, updatedAt: now,
    closedAt: resolved ? now : null,
    fixedIn: newFixedIn,
  }).where(eq(schema.tickets.id, id)).run();
  db.insert(schema.ticketEvents).values({
    ticketId: id, actorUserId, kind: 'status', fromStatus: t.status, toStatus: to,
    text: newFixedIn ? `Fixed in v${newFixedIn}` : null,
  }).run();

  if (resolved && t.status !== to) {
    if (t.feedbackId) {
      db.update(schema.feedback).set({ status: 'resolved', resolvedAt: now, resolvedByUserId: actorUserId })
        .where(eq(schema.feedback.id, t.feedbackId)).run();
    }
    if (t.reporterUserId) {
      notifyUser(t.reporterUserId, {
        type: 'feedback', category: 'feedback',
        title: to === 'fixed' ? `Your report "${t.title}" was fixed` : `Your report "${t.title}" was closed (won't fix)`,
        body: null,
        link: newFixedIn ? `/patch-notes#v${newFixedIn}` : null,
        metadata: { ticketId: id },
        dedupeKey: `ticket:${id}:${to}`,
      });
    }
  }
  return true;
}
