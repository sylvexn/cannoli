/**
 * Unified notifications feed — merges changelog, announcements, directed
 * notifications, and match reminders into a single sorted list.
 *
 * Endpoints:
 *   GET  /api/notifications       — public (guests get changelog-only)
 *   POST /api/notifications/seen  — stamp changelog+announcements seen (auth)
 *   POST /api/notifications/read  — mark specific directed notifications read (auth)
 */
import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, isNull } from 'drizzle-orm';
// Re-use the parsed + sorted ENTRIES array from changelog.ts.
// ENTRIES is sorted newest-first and computed once at boot.
import { ENTRIES as changelogEntries } from './changelog';
import { getCurrentMatchReminder } from '../lib/arena-state';

// ─── Types ──────────────────────────────────────────────────────────────────

type NotificationSource = 'changelog' | 'feedback' | 'announcement' | 'match';

interface NotificationItem {
  id: string;
  source: NotificationSource;
  title: string;
  body: string | null;
  link: string | null;
  category: string | null;
  createdAt: string;
  read: boolean;
}

// ─── GET /api/notifications ──────────────────────────────────────────────────

export const notificationRoutes = new Elysia()

  .get('/api/notifications', ({ user }) => {
    const items: NotificationItem[] = [];

    // ── 1. Changelog items ───────────────────────────────────────────────────
    // Read seenAt for unread comparison. Guests: all unread.
    let changelogSeenAt: string | null = null;
    if (user) {
      const row = db.select({ seen: schema.userPreferences.changelogSeenAt })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, parseInt(user.id)))
        .get();
      changelogSeenAt = row?.seen ?? null;
    }

    for (const entry of changelogEntries) {
      const read = changelogSeenAt != null && entry.date <= changelogSeenAt;
      items.push({
        id: `changelog:${entry.id}`,
        source: 'changelog',
        title: entry.title,
        body: entry.body ?? null,
        link: null,
        category: entry.category,
        createdAt: entry.date,
        read: user ? read : false,
      });
    }

    // ── 2. Announcements ─────────────────────────────────────────────────────
    // Only for authenticated users; active announcements only.
    if (user) {
      const announcementsSeenAt = db.select({ seen: schema.userPreferences.announcementsSeenAt })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, parseInt(user.id)))
        .get()?.seen ?? null;

      const activeAnnouncements = db.select().from(schema.announcements)
        .where(eq(schema.announcements.active, true))
        .all();

      for (const ann of activeAnnouncements) {
        const read = announcementsSeenAt != null &&
          ann.createdAt != null &&
          ann.createdAt <= announcementsSeenAt;
        items.push({
          id: `announcement:${ann.id}`,
          source: 'announcement',
          title: ann.title,
          body: ann.body,
          link: ann.link ?? null,
          category: ann.category,
          createdAt: ann.createdAt ?? new Date().toISOString(),
          read,
        });
      }
    }

    // ── 3. Directed notifications ─────────────────────────────────────────────
    if (user) {
      const directed = db.select().from(schema.notifications)
        .where(eq(schema.notifications.userId, parseInt(user.id)))
        .all();

      for (const n of directed) {
        items.push({
          id: `notif:${n.id}`,
          source: 'feedback',
          title: n.title,
          body: n.body ?? null,
          link: n.link ?? null,
          category: n.type,
          createdAt: n.createdAt ?? new Date().toISOString(),
          read: n.readAt != null,
        });
      }
    }

    // ── 4. Match reminder ─────────────────────────────────────────────────────
    if (user) {
      const reminder = getCurrentMatchReminder(parseInt(user.id));
      if (reminder) {
        items.push({
          id: `match:${reminder.matchId}`,
          source: 'match',
          title: `Week ${reminder.week} match${reminder.opponent ? ` vs ${reminder.opponent}` : ''} — ready up`,
          body: null,
          link: reminder.link,
          category: null,
          createdAt: reminder.createdAt,
          read: false,
        });
      }
    }

    // ── Sort newest-first ─────────────────────────────────────────────────────
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

    // ── Compute counts ────────────────────────────────────────────────────────
    const unreadItems = items.filter(i => !i.read);
    const unreadCount = unreadItems.length;
    const unreadBySource = {
      changelog: unreadItems.filter(i => i.source === 'changelog').length,
      feedback: unreadItems.filter(i => i.source === 'feedback').length,
      announcement: unreadItems.filter(i => i.source === 'announcement').length,
      match: unreadItems.filter(i => i.source === 'match').length,
    };

    return { items, unreadCount, unreadBySource };
  })

  // ─── POST /api/notifications/seen ────────────────────────────────────────
  // Stamps changelogSeenAt + announcementsSeenAt = now,
  // and bulk-reads all unread directed notifications.
  .post('/api/notifications/seen', ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const userId = parseInt(user.id);

    // Mirror the future-dated-entry guard from changelog.ts POST /api/changelog/seen:
    // if the newest entry is ahead of wall-clock, stamp to that date so it
    // can't stay permanently "unread" after the user opens the panel.
    const now = new Date().toISOString();
    const newestEntry = changelogEntries[0]?.date;
    const seenAt = newestEntry && newestEntry > now ? newestEntry : now;

    const existing = db.select({ userId: schema.userPreferences.userId })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .get();

    if (existing) {
      db.update(schema.userPreferences).set({
        changelogSeenAt: seenAt,
        announcementsSeenAt: now,
      }).where(eq(schema.userPreferences.userId, userId)).run();
    } else {
      db.insert(schema.userPreferences).values({
        userId,
        changelogSeenAt: seenAt,
        announcementsSeenAt: now,
      }).run();
    }

    // Bulk-mark all directed notifications read.
    db.update(schema.notifications).set({ readAt: now })
      .where(and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt),
      )).run();

    return { success: true };
  })

  // ─── POST /api/notifications/read ────────────────────────────────────────
  // Mark specific directed notifications read by prefixed id.
  .post('/api/notifications/read', ({ user, body, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const userId = parseInt(user.id);
    const { ids } = body as { ids?: unknown };

    if (!Array.isArray(ids)) { set.status = 400; return { error: 'ids must be an array' }; }

    const now = new Date().toISOString();
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      if (!id.startsWith('notif:')) continue;
      const rowId = parseInt(id.slice(6));
      if (!Number.isFinite(rowId)) continue;

      db.update(schema.notifications).set({ readAt: now })
        .where(and(
          eq(schema.notifications.id, rowId),
          eq(schema.notifications.userId, userId),
          isNull(schema.notifications.readAt),
        )).run();
    }

    return { success: true };
  });
