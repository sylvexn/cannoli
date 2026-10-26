/**
 * Patch notes ("What's New") — structured, versioned release feed served on its
 * own page (/patch-notes), no longer part of the bell. Model: lib/patch-notes.ts.
 * Rows live in the `changelog` table; fresh DBs are seeded from
 * src/content/changelog.json and legacy rows are converted at boot (idempotent).
 *
 * Unread = published top-level patches dated after user_preferences.changelog_seen_at
 * (guests: localStorage). Hotfixes nest under their parent and never pulse alone.
 *
 * Endpoints:
 *   GET    /api/changelog                   — public { patches, lastSeenAt, unreadCount }
 *   POST   /api/changelog/seen              — stamp changelog_seen_at (auth)
 *   GET    /api/admin/changelog             — all rows incl. drafts (staff)
 *   POST   /api/admin/changelog             — create draft / hotfix (staff)
 *   PUT    /api/admin/changelog/:id         — update (staff)
 *   POST   /api/admin/changelog/:id/publish — draft -> published, date = now (staff)
 *   DELETE /api/admin/changelog/:id         — remove (staff)
 */

import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, desc, sql } from 'drizzle-orm';
import { isStaff } from '../lib/auth';
import changelogData from '../content/changelog.json';
import {
  getPublishedPatches, newestPatchDate, countUnreadPatches, migrateChangelogStructure,
  normalizeSections, parseLegacyBody, deriveCategory, toPatchNote, type PatchSection,
} from '../lib/patch-notes';

export type ChangelogCategory = 'feature' | 'improvement' | 'fix';

export interface ChangelogEntry {
  id: string;
  /** ISO 8601 timestamp (UTC). Drives ordering AND unread comparison. */
  date: string;
  category: ChangelogCategory;
  title: string;
  body?: string;
}

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


// Seed (fresh DBs) then convert legacy rows to the structured shape. Both are
// idempotent no-ops on an already-converted table.
ensureChangelogSeeded();
try {
  const n = migrateChangelogStructure();
  if (n > 0) console.log(`[changelog] converted ${n} legacy entries to structured patch notes`);
} catch (err) {
  console.error('[changelog] structure migration skipped:', err);
}


type Draft = {
  id?: unknown; version?: unknown; date?: unknown; title?: unknown; heroUrl?: unknown;
  sections?: unknown; body?: unknown; parentId?: unknown; status?: unknown;
};

/** Sections from `sections`, or (legacy API callers) parsed from a dashed `body`. */
function readSections(b: Draft): PatchSection[] | null | undefined {
  if (b.sections !== undefined) return normalizeSections(b.sections);
  if (typeof b.body === 'string') return parseLegacyBody(b.body);
  return undefined;
}

const isoOk = (d: unknown): d is string => typeof d === 'string' && !Number.isNaN(Date.parse(d));
const heroOk = (h: unknown) => h == null || h === '' || (typeof h === 'string' && /^(https?:\/\/|\/)/.test(h));
const versionOk = (v: string) => /^\d+\.\d+(\.\d+)?$/.test(v);

function slugFor(version: string | null, title: string): string {
  const base = (version ? `v${version}` : title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base || 'patch'}-${new Date().toISOString().slice(0, 7)}`;
}

function logAdmin(user: { username: string }, type: string, description: string, meta: unknown) {
  db.insert(schema.activityLog).values({
    type, category: 'admin', actor: user.username, leagueId: null, description,
    metadata: JSON.stringify(meta),
  }).run();
}

export const changelogRoutes = new Elysia()

  // GET /api/changelog — public. Published patches (hotfixes nested) + the
  // caller's seen stamp and server-computed unread count (guests: client-side).
  .get('/api/changelog', ({ user }) => {
    let lastSeenAt: string | null = null;
    if (user) {
      lastSeenAt = db.select({ seen: schema.userPreferences.changelogSeenAt })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, parseInt(user.id)))
        .get()?.seen ?? null;
    }
    return {
      patches: getPublishedPatches(),
      lastSeenAt,
      unreadCount: user ? countUnreadPatches(lastSeenAt) : null,
    };
  })

  // POST /api/changelog/seen — stamp changelog_seen_at (lazy-upserts the prefs
  // row). Stamps to the newest patch date when that is ahead of wall-clock so a
  // future-dated patch can't stay permanently unread.
  .post('/api/changelog/seen', ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const userId = parseInt(user.id);
    const now = new Date().toISOString();
    const newest = newestPatchDate();
    const seenAt = newest && newest > now ? newest : now;
    const existing = db.select({ userId: schema.userPreferences.userId })
      .from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)).get();
    if (existing) {
      db.update(schema.userPreferences).set({ changelogSeenAt: seenAt })
        .where(eq(schema.userPreferences.userId, userId)).run();
    } else {
      db.insert(schema.userPreferences).values({ userId, changelogSeenAt: seenAt }).run();
    }
    return { success: true, seenAt };
  })

  // GET /api/admin/changelog — every row incl. drafts, flat (staff).
  .get('/api/admin/changelog', ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    return db.select().from(schema.changelog).orderBy(desc(schema.changelog.date)).all()
      .map(r => ({ ...toPatchNote(r), createdAt: r.createdAt, updatedAt: r.updatedAt }));
  })

  // POST /api/admin/changelog — create a patch/hotfix. Defaults to a DRAFT;
  // status:'published' publishes immediately. Body: { version, title, sections,
  // heroUrl?, parentId?, date?, id?, status? } (legacy `body` + `category` accepted).
  .post('/api/admin/changelog', ({ user, body, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const b = (body ?? {}) as Draft;

    if (typeof b.title !== 'string' || !b.title.trim()) { set.status = 400; return { error: 'title is required' }; }
    if (b.date !== undefined && !isoOk(b.date)) { set.status = 400; return { error: 'date must be an ISO-8601 timestamp' }; }
    if (!heroOk(b.heroUrl)) { set.status = 400; return { error: 'heroUrl must be an http(s) or root-relative URL' }; }
    const sections = readSections(b);
    if (sections === null) { set.status = 400; return { error: 'sections malformed' }; }
    const status = b.status === 'published' ? 'published' : 'draft';
    const version = typeof b.version === 'string' && b.version.trim() ? b.version.trim() : null;
    if (version && !versionOk(version)) { set.status = 400; return { error: 'version must look like 1.3 or 1.3.1' }; }

    let parentId: string | null = null;
    if (typeof b.parentId === 'string' && b.parentId) {
      const parent = db.select().from(schema.changelog).where(eq(schema.changelog.id, b.parentId)).get();
      if (!parent) { set.status = 400; return { error: 'parent patch not found' }; }
      if (parent.parentId) { set.status = 400; return { error: 'hotfixes cannot nest under a hotfix' }; }
      parentId = parent.id;
    }

    const slug = typeof b.id === 'string' && b.id.trim() ? b.id.trim() : slugFor(version, b.title);
    if (db.select({ id: schema.changelog.id }).from(schema.changelog).where(eq(schema.changelog.id, slug)).get()) {
      set.status = 409; return { error: `Entry '${slug}' already exists`, code: 'changelog_exists' };
    }

    const secs = sections ?? [];
    db.insert(schema.changelog).values({
      id: slug,
      date: isoOk(b.date) ? b.date.trim() : new Date().toISOString(),
      category: deriveCategory(secs),
      title: b.title.trim(),
      version,
      parentId,
      sections: JSON.stringify(secs),
      heroUrl: typeof b.heroUrl === 'string' && b.heroUrl ? b.heroUrl : null,
      status,
    }).run();
    logAdmin(user, 'changelog_created', `${status === 'published' ? 'Published' : 'Drafted'} patch notes: ${b.title.trim()}`, { id: slug, version, status });
    return { success: true, id: slug };
  })

  // PUT /api/admin/changelog/:id — partial update (drafts and published alike).
  .put('/api/admin/changelog/:id', ({ params, user, body, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const existing = db.select().from(schema.changelog).where(eq(schema.changelog.id, params.id)).get();
    if (!existing) { set.status = 404; return { error: 'Entry not found' }; }
    const b = (body ?? {}) as Draft;

    const updates: Record<string, unknown> = {};
    if (b.date !== undefined) {
      if (!isoOk(b.date)) { set.status = 400; return { error: 'date must be an ISO-8601 timestamp' }; }
      updates.date = b.date.trim();
    }
    if (typeof b.title === 'string' && b.title.trim()) updates.title = b.title.trim();
    if (b.version !== undefined) {
      const v = typeof b.version === 'string' ? b.version.trim() : '';
      if (v && !versionOk(v)) { set.status = 400; return { error: 'version must look like 1.3 or 1.3.1' }; }
      updates.version = v || null;
    }
    if (b.heroUrl !== undefined) {
      if (!heroOk(b.heroUrl)) { set.status = 400; return { error: 'heroUrl must be an http(s) or root-relative URL' }; }
      updates.heroUrl = typeof b.heroUrl === 'string' && b.heroUrl ? b.heroUrl : null;
    }
    const sections = readSections(b);
    if (sections === null) { set.status = 400; return { error: 'sections malformed' }; }
    if (sections) { updates.sections = JSON.stringify(sections); updates.category = deriveCategory(sections); }

    if (Object.keys(updates).length === 0) { set.status = 400; return { error: 'No valid fields to update' }; }
    updates.updatedAt = sql`(datetime('now'))`;
    db.update(schema.changelog).set(updates as never).where(eq(schema.changelog.id, params.id)).run();
    logAdmin(user, 'changelog_updated', `Updated patch notes: ${existing.title}`, { id: params.id, fields: Object.keys(updates).filter(k => k !== 'updatedAt') });
    return { success: true };
  })

  // POST /api/admin/changelog/:id/publish — draft -> published. Stamps date = now
  // (a fresh date is what makes a top-level patch pulse as unread).
  .post('/api/admin/changelog/:id/publish', ({ params, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const existing = db.select().from(schema.changelog).where(eq(schema.changelog.id, params.id)).get();
    if (!existing) { set.status = 404; return { error: 'Entry not found' }; }
    if (existing.status === 'published') { set.status = 409; return { error: 'Already published' }; }
    if (existing.parentId) {
      const parent = db.select({ status: schema.changelog.status }).from(schema.changelog)
        .where(eq(schema.changelog.id, existing.parentId)).get();
      if (parent?.status !== 'published') { set.status = 409; return { error: 'Publish the parent patch first' }; }
    }
    const date = new Date().toISOString();
    db.update(schema.changelog).set({ status: 'published', date, updatedAt: sql`(datetime('now'))` })
      .where(eq(schema.changelog.id, params.id)).run();
    logAdmin(user, 'changelog_published', `Published patch notes: ${existing.title}`, { id: params.id, version: existing.version });
    return { success: true, date };
  })

  // DELETE /api/admin/changelog/:id — hard delete; refuses while hotfixes hang off it.
  .delete('/api/admin/changelog/:id', ({ params, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const existing = db.select({ id: schema.changelog.id, title: schema.changelog.title })
      .from(schema.changelog).where(eq(schema.changelog.id, params.id)).get();
    if (!existing) { set.status = 404; return { error: 'Entry not found' }; }
    const kid = db.select({ id: schema.changelog.id }).from(schema.changelog)
      .where(eq(schema.changelog.parentId, params.id)).get();
    if (kid) { set.status = 409; return { error: 'Delete its hotfixes first' }; }
    db.delete(schema.changelog).where(eq(schema.changelog.id, params.id)).run();
    logAdmin(user, 'changelog_deleted', `Removed patch notes: ${existing.title}`, { id: params.id });
    return { success: true };
  });
