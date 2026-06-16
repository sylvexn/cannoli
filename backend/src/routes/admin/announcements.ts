/**
 * Admin announcements CRUD.
 *
 * Endpoints:
 *   GET    /api/admin/announcements        — list all (requireStaff)
 *   POST   /api/admin/announcements        — create (requireStaff)
 *   DELETE /api/admin/announcements/:id    — soft-delete / retract (requireStaff)
 */
import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, desc } from 'drizzle-orm';
import { requireStaff } from '../../lib/auth-guards';

export const announcementsRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })

  // ─── GET /api/admin/announcements ─────────────────────────────────────────

  .get('/api/admin/announcements', () => {
    const rows = db.select({
      id: schema.announcements.id,
      title: schema.announcements.title,
      body: schema.announcements.body,
      link: schema.announcements.link,
      category: schema.announcements.category,
      createdBy: schema.announcements.createdBy,
      createdAt: schema.announcements.createdAt,
      active: schema.announcements.active,
      createdByUsername: schema.users.username,
    })
      .from(schema.announcements)
      .leftJoin(schema.users, eq(schema.announcements.createdBy, schema.users.id))
      .orderBy(desc(schema.announcements.createdAt))
      .all();

    return rows.map(r => ({
      id: r.id,
      title: r.title,
      body: r.body,
      link: r.link ?? null,
      category: r.category,
      createdByUsername: r.createdByUsername ?? null,
      createdAt: r.createdAt,
      active: r.active,
    }));
  })

  // ─── POST /api/admin/announcements ────────────────────────────────────────

  .post('/api/admin/announcements', ({ user, body, set }) => {
    const { title, body: bodyText, link, category } = body as {
      title?: unknown;
      body?: unknown;
      link?: unknown;
      category?: unknown;
    };

    if (typeof title !== 'string' || !title.trim()) {
      set.status = 400;
      return { error: 'title is required' };
    }
    if (typeof bodyText !== 'string' || !bodyText.trim()) {
      set.status = 400;
      return { error: 'body is required' };
    }

    const VALID_CATEGORIES = ['info', 'feature', 'event', 'maintenance'] as const;
    type Category = typeof VALID_CATEGORIES[number];
    const cat: Category = VALID_CATEGORIES.includes(category as Category)
      ? (category as Category)
      : 'info';

    const result = db.insert(schema.announcements).values({
      title: title.trim(),
      body: bodyText.trim(),
      link: typeof link === 'string' && link.trim() ? link.trim() : null,
      category: cat,
      createdBy: parseInt(user.id),
    }).returning({ id: schema.announcements.id }).get();

    db.insert(schema.activityLog).values({
      type: 'announcement_created',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Created announcement: ${title.trim()}`,
      metadata: JSON.stringify({ id: result?.id, category: cat }),
    }).run();

    return { id: result?.id };
  })

  // ─── DELETE /api/admin/announcements/:id ──────────────────────────────────

  .delete('/api/admin/announcements/:id', ({ params, user, set }) => {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) { set.status = 400; return { error: 'Invalid id' }; }

    const existing = db.select({ id: schema.announcements.id, title: schema.announcements.title })
      .from(schema.announcements)
      .where(eq(schema.announcements.id, id))
      .get();
    if (!existing) { set.status = 404; return { error: 'Announcement not found' }; }

    // Soft-delete: set active=false so the audit trail is preserved.
    db.update(schema.announcements).set({ active: false })
      .where(eq(schema.announcements.id, id)).run();

    db.insert(schema.activityLog).values({
      type: 'announcement_deleted',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Retracted announcement: ${existing.title}`,
      metadata: JSON.stringify({ id }),
    }).run();

    return { success: true };
  });
