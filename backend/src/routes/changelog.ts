/**
 * Changelog ("What's New") — a curated, user-facing release feed.
 *
 * Entries are authored by hand in `src/content/changelog.json` (newest-first is
 * fine; we sort by `date` server-side anyway) and ship inside the Docker image.
 * The backend container has no git at runtime, so we do NOT derive this from
 * commit history — raw commits are noisy and infra-heavy. To publish an entry,
 * add an object to changelog.json and deploy.
 *
 * Per-user "unread" state lives on `user_preferences.changelog_seen_at` (the ISO
 * timestamp of the last time that user opened the panel). Entries dated after it
 * are unread and pulse the sidebar bell. Guests are tracked client-side via
 * localStorage instead (no row to write).
 *
 * Endpoints:
 *   GET  /api/changelog       — { entries, lastSeenAt } (public; lastSeenAt only for auth'd users)
 *   POST /api/changelog/seen  — stamp changelog_seen_at = now (auth required)
 */

import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
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

// Parse + sort once at boot (newest first). String compare is correct for
// same-format ISO-8601-with-Z timestamps.
const ENTRIES: ChangelogEntry[] = [...(changelogData as ChangelogEntry[])]
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

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
    return { entries: ENTRIES, lastSeenAt };
  })

  // ─── POST /api/changelog/seen ─────────────────────────────────────────
  // Stamp the user's changelog_seen_at to now. Lazy-upserts the prefs row the
  // same way PUT /api/users/me/preferences does, so a user who has never saved
  // a preference still gets their read-state recorded.
  .post('/api/changelog/seen', ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const userId = parseInt(user.id);
    // Stamp to the newest entry date when it's ahead of wall-clock (ENTRIES is
    // sorted newest-first), so a future-dated entry can't stay permanently
    // unread after the user opens the panel.
    const now = new Date().toISOString();
    const newest = ENTRIES[0]?.date;
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
  });
