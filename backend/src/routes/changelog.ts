/**
 * Changelog ("What's New") — a curated, user-facing release feed.
 *
 * Entries live in the `changelog` DB table and are published through the admin
 * API (POST/PUT/DELETE /api/admin/changelog) — and later CI — instead of being
 * hand-edited into a JSON file shipped in the image. On first boot after the
 * 0064 migration the table is empty, so `ensureChangelogSeeded()` backfills it
 * from the committed `src/content/changelog.json` (a one-time history seed; the
 * file is no longer the runtime source). Fresh local/mock DBs get seeded the
 * same way the first time the backend starts.
 *
 * Per-user "unread" state lives on `user_preferences.changelog_seen_at` (the ISO
 * timestamp of the last time that user opened the panel). Entries dated after it
 * are unread and pulse the sidebar bell. Guests are tracked client-side via
 * localStorage instead (no row to write).
 *
 * Endpoints:
 *   GET    /api/changelog       — { entries, lastSeenAt } (public; lastSeenAt only for auth'd users)
 *   POST   /api/changelog/seen  — stamp changelog_seen_at = now (auth required)
 *   GET    /api/admin/changelog — full rows incl. created/updated (staff)
 *   POST   /api/admin/changelog — create/publish an entry (staff)
 *   PUT    /api/admin/changelog/:id — update an entry (staff)
 *   DELETE /api/admin/changelog/:id — remove an entry (staff)
 */

import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, desc, sql } from 'drizzle-orm';
import { isStaff } from '../lib/auth';
import changelogData from '../content/changelog.json';

export type ChangelogCategory = 'feature' | 'improvement' | 'fix';

export interface ChangelogEntry {
  id: string;
  /** ISO 8601 timestamp (UTC). Drives ordering AND unread comparison. */
  date: string;
  category: ChangelogCategory;
  title: string;
  body?: string;
}

const VALID_CATEGORIES: ChangelogCategory[] = ['feature', 'improvement', 'fix'];

/**
 * One-time history backfill: if the table is empty, insert the entries committed
 * in changelog.json. Idempotent (no-op once any row exists) and best-effort —
 * a dev DB whose 0064 migration was skipped just logs and serves an empty feed
 * rather than crashing boot. Runs at module load (the same place the old static
 * ENTRIES array was parsed).
 */
export function ensureChangelogSeeded(): void {
  try {
    const count = db.select({ n: sql<number>`count(*)` }).from(schema.changelog).get();
    if ((count?.n ?? 0) > 0) return;
    const seed = changelogData as ChangelogEntry[];
    if (seed.length === 0) return;
    for (const e of seed) {
      db.insert(schema.changelog).values({
        id: e.id,
        date: e.date,
        category: e.category,
        title: e.title,
        body: e.body ?? null,
      }).onConflictDoNothing().run();
    }
    console.log(`[changelog] seeded ${seed.length} entries from changelog.json`);
  } catch (err) {
    console.error('[changelog] backfill skipped:', err);
  }
}

ensureChangelogSeeded();

/** Read the feed newest-first. Small table; queried per request (no caching). */
export function getChangelogEntries(): ChangelogEntry[] {
  const rows = db.select({
    id: schema.changelog.id,
    date: schema.changelog.date,
    category: schema.changelog.category,
    title: schema.changelog.title,
    body: schema.changelog.body,
  })
    .from(schema.changelog)
    .orderBy(desc(schema.changelog.date))
    .all();
  return rows.map(r => ({
    id: r.id,
    date: r.date,
    category: r.category as ChangelogCategory,
    title: r.title,
    body: r.body ?? undefined,
  }));
}

export const changelogRoutes = new Elysia()

  // ─── GET /api/changelog ───────────────────────────────────────────────
  // Public. Returns the full feed plus the caller's last-seen timestamp so the
  // client can compute its own unread count (guests fall back to localStorage).
  .get('/api/changelog', ({ user }) => {
    let lastSeenAt: string | null = null;
    if (user) {
      const row = db.select({ seen: schema.userPreferences.changelogSeenAt })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, parseInt(user.id)))
        .get();
      lastSeenAt = row?.seen ?? null;
    }
    return { entries: getChangelogEntries(), lastSeenAt };
  })

  // ─── POST /api/changelog/seen ─────────────────────────────────────────
  // Stamp the user's changelog_seen_at to now. Lazy-upserts the prefs row the
  // same way PUT /api/users/me/preferences does, so a user who has never saved
  // a preference still gets their read-state recorded.
  .post('/api/changelog/seen', ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const userId = parseInt(user.id);
    // Stamp to the newest entry date when it's ahead of wall-clock (entries are
    // sorted newest-first), so a future-dated entry can't stay permanently
    // unread after the user opens the panel.
    const now = new Date().toISOString();
    const newest = getChangelogEntries()[0]?.date;
    const seenAt = newest && newest > now ? newest : now;
    const existing = db.select({ userId: schema.userPreferences.userId })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .get();
    if (existing) {
      db.update(schema.userPreferences).set({ changelogSeenAt: seenAt })
        .where(eq(schema.userPreferences.userId, userId)).run();
    } else {
      db.insert(schema.userPreferences).values({ userId, changelogSeenAt: seenAt }).run();
    }
    return { success: true, seenAt };
  })

  // ─── GET /api/admin/changelog ─────────────────────────────────────────
  // Staff-only management list — includes created/updated audit columns the
  // public feed omits.
  .get('/api/admin/changelog', ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    return db.select().from(schema.changelog)
      .orderBy(desc(schema.changelog.date))
      .all();
  })

  // ─── POST /api/admin/changelog ────────────────────────────────────────
  // Publish a new entry. Body: { id, date, category, title, body? }. `id` is a
  // stable kebab slug; `date` is ISO-8601 UTC and drives the unread pulse, so a
  // new release should carry a date newer than the previous entry. This is the
  // endpoint a release CI step would call.
  .post('/api/admin/changelog', ({ user, body, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const { id, date, category, title, body: bodyText } = (body ?? {}) as {
      id?: unknown; date?: unknown; category?: unknown; title?: unknown; body?: unknown;
    };

    if (typeof id !== 'string' || !id.trim()) { set.status = 400; return { error: 'id is required' }; }
    if (typeof date !== 'string' || !date.trim() || Number.isNaN(Date.parse(date))) {
      set.status = 400; return { error: 'date must be an ISO-8601 timestamp' };
    }
    if (!VALID_CATEGORIES.includes(category as ChangelogCategory)) {
      set.status = 400; return { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` };
    }
    if (typeof title !== 'string' || !title.trim()) { set.status = 400; return { error: 'title is required' }; }

    const slug = id.trim();
    const exists = db.select({ id: schema.changelog.id }).from(schema.changelog)
      .where(eq(schema.changelog.id, slug)).get();
    if (exists) { set.status = 409; return { error: `Entry '${slug}' already exists`, code: 'changelog_exists' }; }

    db.insert(schema.changelog).values({
      id: slug,
      date: date.trim(),
      category: category as ChangelogCategory,
      title: title.trim(),
      body: typeof bodyText === 'string' && bodyText.trim() ? bodyText : null,
    }).run();

    db.insert(schema.activityLog).values({
      type: 'changelog_created', category: 'admin', actor: user.username, leagueId: null,
      description: `Published changelog entry: ${title.trim()}`,
      metadata: JSON.stringify({ id: slug, category, date: date.trim() }),
    }).run();

    return { success: true, id: slug };
  })

  // ─── PUT /api/admin/changelog/:id ─────────────────────────────────────
  // Partial update of an existing entry (any of date/category/title/body).
  .put('/api/admin/changelog/:id', ({ params, user, body, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const existing = db.select().from(schema.changelog)
      .where(eq(schema.changelog.id, params.id)).get();
    if (!existing) { set.status = 404; return { error: 'Entry not found' }; }

    const { date, category, title, body: bodyText } = (body ?? {}) as {
      date?: unknown; category?: unknown; title?: unknown; body?: unknown;
    };

    const updates: Record<string, unknown> = {};
    if (date !== undefined) {
      if (typeof date !== 'string' || Number.isNaN(Date.parse(date))) {
        set.status = 400; return { error: 'date must be an ISO-8601 timestamp' };
      }
      updates.date = date.trim();
    }
    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category as ChangelogCategory)) {
        set.status = 400; return { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` };
      }
      updates.category = category as ChangelogCategory;
    }
    if (typeof title === 'string' && title.trim()) updates.title = title.trim();
    // body: empty string / null clears it; non-empty string sets it; undefined skips.
    if (bodyText !== undefined) {
      updates.body = typeof bodyText === 'string' && bodyText.trim() ? bodyText : null;
    }

    if (Object.keys(updates).length === 0) { set.status = 400; return { error: 'No valid fields to update' }; }
    updates.updatedAt = sql`(datetime('now'))`;

    db.update(schema.changelog).set(updates as never)
      .where(eq(schema.changelog.id, params.id)).run();

    db.insert(schema.activityLog).values({
      type: 'changelog_updated', category: 'admin', actor: user.username, leagueId: null,
      description: `Updated changelog entry: ${existing.title}`,
      metadata: JSON.stringify({ id: params.id, fields: Object.keys(updates).filter(k => k !== 'updatedAt') }),
    }).run();

    return { success: true };
  })

  // ─── DELETE /api/admin/changelog/:id ──────────────────────────────────
  // Hard-delete (the feed is curated; there's no audit value in keeping a
  // retracted release note around — the activity log records the removal).
  .delete('/api/admin/changelog/:id', ({ params, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const existing = db.select({ id: schema.changelog.id, title: schema.changelog.title })
      .from(schema.changelog).where(eq(schema.changelog.id, params.id)).get();
    if (!existing) { set.status = 404; return { error: 'Entry not found' }; }

    db.delete(schema.changelog).where(eq(schema.changelog.id, params.id)).run();

    db.insert(schema.activityLog).values({
      type: 'changelog_deleted', category: 'admin', actor: user.username, leagueId: null,
      description: `Removed changelog entry: ${existing.title}`,
      metadata: JSON.stringify({ id: params.id }),
    }).run();

    return { success: true };
  });
