/**
 * Admin sent-log — unified newest-first list of all announcements and
 * directed notifications, with cursor-based pagination.
 *
 * Endpoints:
 *   GET /api/admin/notifications/log?before=<iso>&limit=<n>  (staff)
 */
import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { desc, eq, sql } from 'drizzle-orm';
import { requireStaff } from '../../lib/auth-guards';

interface LogItem {
  id: string;
  kind: 'announcement' | 'directed';
  title: string;
  body: string;
  category: string | null;
  surface: string | null;
  leagueId: string | null;
  targetRole: string | null;
  recipientUsername: string | null;
  retracted: boolean;
  createdAt: string;
}

export const adminNotificationsRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })

  .get('/api/admin/notifications/log', ({ query }) => {
    const before = typeof query?.before === 'string' ? query.before : null;
    const rawLimit = typeof query?.limit === 'string' ? parseInt(query.limit) : 50;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

    // Fetch all announcements with creator username.
    const announcementRows = db.select({
      id: schema.announcements.id,
      title: schema.announcements.title,
      body: schema.announcements.body,
      category: schema.announcements.category,
      surface: schema.announcements.surface,
      leagueId: schema.announcements.leagueId,
      targetRole: schema.announcements.targetRole,
      active: schema.announcements.active,
      createdAt: schema.announcements.createdAt,
    })
      .from(schema.announcements)
      .orderBy(desc(schema.announcements.createdAt))
      .all();

    // Fetch all directed notifications with recipient username.
    const notifRows = db.select({
      id: schema.notifications.id,
      title: schema.notifications.title,
      body: schema.notifications.body,
      createdAt: schema.notifications.createdAt,
      userId: schema.notifications.userId,
      recipientUsername: schema.users.username,
    })
      .from(schema.notifications)
      .leftJoin(schema.users, eq(schema.notifications.userId, schema.users.id))
      .orderBy(desc(schema.notifications.createdAt))
      .all();

    const items: LogItem[] = [
      ...announcementRows.map(r => ({
        id: `announcement:${r.id}`,
        kind: 'announcement' as const,
        title: r.title,
        body: r.body,
        category: r.category,
        surface: r.surface,
        leagueId: r.leagueId ?? null,
        targetRole: r.targetRole ?? null,
        recipientUsername: null,
        retracted: !r.active,
        createdAt: r.createdAt ?? '',
      })),
      ...notifRows.map(r => ({
        id: `notif:${r.id}`,
        kind: 'directed' as const,
        title: r.title,
        body: r.body ?? '',
        category: null,
        surface: null,
        leagueId: null,
        targetRole: null,
        recipientUsername: r.recipientUsername ?? null,
        retracted: false,
        createdAt: r.createdAt ?? '',
      })),
    ];

    // Sort newest-first.
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

    // Apply cursor filter.
    const filtered = before ? items.filter(i => i.createdAt < before) : items;

    // Slice to limit.
    const page = filtered.slice(0, limit);
    const nextBefore = page.length === limit ? (page.at(-1)?.createdAt ?? null) : null;

    return { items: page, nextBefore };
  });
