/**
 * Admin announcements CRUD.
 *
 * Endpoints:
 *   GET    /api/admin/announcements        — list all (requireStaff)
 *   POST   /api/admin/announcements        — create (requireStaff)
 *   PATCH  /api/admin/announcements/:id    — partial update (requireStaff)
 *   DELETE /api/admin/announcements/:id    — soft-delete / retract (requireStaff)
 */
import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, desc, sql } from 'drizzle-orm';
import { requireStaff } from '../../lib/auth-guards';

const VALID_CATEGORIES = ['info', 'feature', 'event', 'maintenance'] as const;
type Category = typeof VALID_CATEGORIES[number];

const VALID_SURFACES = ['bell', 'banner', 'both'] as const;
type Surface = typeof VALID_SURFACES[number];

const VALID_TARGET_ROLES = ['admin', 'user'] as const;
type TargetRole = typeof VALID_TARGET_ROLES[number];

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
      surface: schema.announcements.surface,
      leagueId: schema.announcements.leagueId,
      targetRole: schema.announcements.targetRole,
      createdBy: schema.announcements.createdBy,
      createdAt: schema.announcements.createdAt,
      updatedAt: schema.announcements.updatedAt,
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
      surface: r.surface,
      leagueId: r.leagueId ?? null,
      targetRole: r.targetRole ?? null,
      createdByUsername: r.createdByUsername ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt ?? null,
      active: r.active,
    }));
  })

  // ─── POST /api/admin/announcements ────────────────────────────────────────

  .post('/api/admin/announcements', ({ user, body, set }) => {
    const { title, body: bodyText, link, category, surface, leagueId, targetRole } = body as {
      title?: unknown;
      body?: unknown;
      link?: unknown;
      category?: unknown;
      surface?: unknown;
      leagueId?: unknown;
      targetRole?: unknown;
    };

    if (typeof title !== 'string' || !title.trim()) {
      set.status = 400;
      return { error: 'title is required' };
    }
    if (typeof bodyText !== 'string' || !bodyText.trim()) {
      set.status = 400;
      return { error: 'body is required' };
    }

    const cat: Category = VALID_CATEGORIES.includes(category as Category)
      ? (category as Category)
      : 'info';

    const surf: Surface = VALID_SURFACES.includes(surface as Surface)
      ? (surface as Surface)
      : 'bell';

    const tRole: TargetRole | null = VALID_TARGET_ROLES.includes(targetRole as TargetRole)
      ? (targetRole as TargetRole)
      : null;

    // Validate leagueId if provided.
    let resolvedLeagueId: string | null = null;
    if (typeof leagueId === 'string' && leagueId.trim()) {
      const lid = leagueId.trim();
      const leagueExists = db.select({ id: schema.leagues.id })
        .from(schema.leagues)
        .where(eq(schema.leagues.id, lid))
        .get();
      if (!leagueExists) {
        set.status = 400;
        return { error: `League '${lid}' not found` };
      }
      resolvedLeagueId = lid;
    }

    const result = db.insert(schema.announcements).values({
      title: title.trim(),
      body: bodyText.trim(),
      link: typeof link === 'string' && link.trim() ? link.trim() : null,
      category: cat,
      surface: surf,
      leagueId: resolvedLeagueId,
      targetRole: tRole,
      createdBy: parseInt(user.id),
      updatedAt: sql`(datetime('now'))`,
    }).returning({ id: schema.announcements.id }).get();

    db.insert(schema.activityLog).values({
      type: 'announcement_created',
      category: 'admin',
      actor: user.username,
      leagueId: resolvedLeagueId,
      description: `Created announcement: ${title.trim()} [surface=${surf}${resolvedLeagueId ? ` league=${resolvedLeagueId}` : ''}${tRole ? ` role=${tRole}` : ''}]`,
      metadata: JSON.stringify({ id: result?.id, category: cat, surface: surf, leagueId: resolvedLeagueId, targetRole: tRole }),
    }).run();

    return { id: result?.id };
  })

  // ─── PATCH /api/admin/announcements/:id ──────────────────────────────────

  .patch('/api/admin/announcements/:id', ({ params, user, body, set }) => {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) { set.status = 400; return { error: 'Invalid id' }; }

    const existing = db.select().from(schema.announcements)
      .where(eq(schema.announcements.id, id))
      .get();
    if (!existing) { set.status = 404; return { error: 'Announcement not found' }; }

    const { title, body: bodyText, link, category, surface, leagueId, targetRole } = body as {
      title?: unknown;
      body?: unknown;
      link?: unknown;
      category?: unknown;
      surface?: unknown;
      leagueId?: unknown;
      targetRole?: unknown;
    };

    const updates: Record<string, unknown> = {};

    if (typeof title === 'string' && title.trim()) {
      updates.title = title.trim();
    }
    if (typeof bodyText === 'string' && bodyText.trim()) {
      updates.body = bodyText.trim();
    }
    // link: empty string → null; non-empty string → trimmed value; null/undefined → skip
    if (link !== undefined) {
      if (typeof link === 'string') {
        updates.link = link.trim() || null;
      } else if (link === null) {
        updates.link = null;
      }
    }
    if (category !== undefined && VALID_CATEGORIES.includes(category as Category)) {
      updates.category = category as Category;
    }
    if (surface !== undefined && VALID_SURFACES.includes(surface as Surface)) {
      updates.surface = surface as Surface;
    }
    if (targetRole !== undefined) {
      if (targetRole === null || targetRole === '') {
        updates.targetRole = null;
      } else if (VALID_TARGET_ROLES.includes(targetRole as TargetRole)) {
        updates.targetRole = targetRole as TargetRole;
      }
    }
    // leagueId: validate if non-null string
    if (leagueId !== undefined) {
      if (leagueId === null || leagueId === '') {
        updates.leagueId = null;
      } else if (typeof leagueId === 'string') {
        const lid = leagueId.trim();
        const leagueExists = db.select({ id: schema.leagues.id })
          .from(schema.leagues)
          .where(eq(schema.leagues.id, lid))
          .get();
        if (!leagueExists) {
          set.status = 400;
          return { error: `League '${lid}' not found` };
        }
        updates.leagueId = lid;
      }
    }

    if (Object.keys(updates).length === 0) {
      set.status = 400;
      return { error: 'No valid fields to update' };
    }

    updates.updatedAt = sql`(datetime('now'))`;

    db.update(schema.announcements).set(updates as never)
      .where(eq(schema.announcements.id, id)).run();

    db.insert(schema.activityLog).values({
      type: 'announcement_updated',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Updated announcement #${id}: ${existing.title}`,
      metadata: JSON.stringify({ id, fields: Object.keys(updates).filter(k => k !== 'updatedAt') }),
    }).run();

    return { success: true };
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
