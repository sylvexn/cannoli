import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, asc } from 'drizzle-orm';
import { hashPassword, isStaff } from '../../lib/auth';
import { tx } from '../../lib/tx';

export const userRoutes = new Elysia()

  // ─── Users (admin read) ──────────────────────────────────────────────

  .get('/api/users', ({ user, set }) => {
    if (!isStaff(user)) {
      set.status = 403;
      return { error: 'Forbidden' };
    }
    return db.select({
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
      mustChangePassword: schema.users.mustChangePassword,
      active: schema.users.active,
      createdAt: schema.users.createdAt,
      primaryColor: schema.users.primaryColor,
      secondaryColor: schema.users.secondaryColor,
      tertiaryColor: schema.users.tertiaryColor,
    }).from(schema.users)
      .orderBy(asc(schema.users.id))
      .all()
      .map(u => ({ ...u, id: String(u.id) }));
  })

  // ─── Users CRUD ─────────────────────────────────────────────────────

  .post('/api/users', ({ body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { username, role } = body as { username: string; role?: string };
    if (!username?.trim()) { set.status = 400; return { error: 'Username required' }; }

    const existing = db.select().from(schema.users).where(eq(schema.users.username, username.trim().toLowerCase())).get();
    if (existing) { set.status = 409; return { error: 'Username already exists' }; }

    const settings = db.select().from(schema.siteSettings).get();
    const password = settings?.defaultUserPassword || 'password';
    const result = tx(() => {
      const row = db.insert(schema.users).values({
        username: username.trim().toLowerCase(),
        passwordHash: hashPassword(password),
        role: (role === 'admin' ? 'admin' : 'user') as 'admin' | 'user',
        mustChangePassword: true,
        active: true,
      }).returning().get();

      // Emit a user_created activity row so the audit feed has the canonical
      // event the UI's icon list expects (admin-activity-log.tsx).
      db.insert(schema.activityLog).values({
        type: 'user_created',
        category: 'admin',
        actor: user.username,
        leagueId: null,
        description: `Created user "${row.username}" (${row.role})`,
        metadata: JSON.stringify({ userId: row.id, username: row.username, role: row.role }),
      }).run();

      return row;
    });

    return { user: { id: String(result.id), username: result.username, role: result.role }, password };
  })

  .put('/api/users/:id', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const userId = parseInt(params.id);
    const { role, active } = body as { role?: string; active?: boolean };

    const before = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!before) { set.status = 404; return { error: 'User not found' }; }

    const updates: Record<string, unknown> = {};
    if (role !== undefined) updates.role = role;
    if (active !== undefined) updates.active = active;

    if (Object.keys(updates).length === 0) { set.status = 400; return { error: 'No updates' }; }

    tx(() => {
      db.update(schema.users).set(updates).where(eq(schema.users.id, userId)).run();

      // Emit specific event types per change so the audit UI can render meaningful
      // icons. A single PUT can flip multiple fields → emit one row per detected
      // change. Falls back to user_updated for anything else.
      const events: { type: string; description: string; metadata: Record<string, unknown> }[] = [];

      if (role !== undefined && role !== before.role) {
        events.push({
          type: 'user_role_changed',
          description: `Changed role of "${before.username}": ${before.role} → ${role}`,
          metadata: { userId, username: before.username, from: before.role, to: role },
        });
      }
      if (active !== undefined && active !== before.active) {
        events.push({
          type: active ? 'user_reactivated' : 'user_deactivated',
          description: active
            ? `Reactivated user "${before.username}"`
            : `Deactivated user "${before.username}"`,
          metadata: { userId, username: before.username, active },
        });
      }

      // If nothing specific matched (e.g. a no-op write), keep the legacy event
      // so something still lands in the log.
      if (events.length === 0) {
        events.push({
          type: 'user_updated',
          description: `Updated user "${before.username}": ${Object.keys(updates).join(', ')}`,
          metadata: { userId, updates },
        });
      }

      for (const ev of events) {
        db.insert(schema.activityLog).values({
          type: ev.type,
          category: 'admin',
          actor: user.username,
          leagueId: null,
          description: ev.description,
          metadata: JSON.stringify(ev.metadata),
        }).run();
      }
    });
    return { success: true };
  })

  .post('/api/users/:id/reset-password', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const userId = parseInt(params.id);
    const settings = db.select().from(schema.siteSettings).get();
    const password = settings?.defaultUserPassword || 'password';

    db.update(schema.users).set({
      passwordHash: hashPassword(password),
      mustChangePassword: true,
    }).where(eq(schema.users.id, userId)).run();

    return { password };
  })

;
