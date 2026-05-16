/**
 * Heartbeat + who's-online endpoint.
 *
 * `touchHeartbeat(userId)` is called from the global auth-derive block in
 * index.ts on every authenticated /api/* hit, debounced in-memory so we don't
 * spam the DB with redundant UPDATEs (one user holding the standings page
 * open issues many bursts of requests).
 *
 * `GET /api/online` returns the set of users seen in the last 15 minutes,
 * trimmed to the small mini-object the sidebar widget needs. Polled at ~30s
 * cadence by the frontend; cheap enough that we don't bother caching here.
 */

import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, sql } from 'drizzle-orm';

const HEARTBEAT_DEBOUNCE_MS = 60_000; // ≤1 write per user per minute
const ONLINE_WINDOW_MS = 15 * 60 * 1000; // last-seen within 15 min = "online"

const lastWriteByUser = new Map<number, number>();

export function touchHeartbeat(userId: number) {
  const now = Date.now();
  const prev = lastWriteByUser.get(userId) ?? 0;
  if (now - prev < HEARTBEAT_DEBOUNCE_MS) return;
  lastWriteByUser.set(userId, now);
  try {
    db.update(schema.users)
      .set({ lastSeenAt: new Date(now).toISOString() })
      .where(eq(schema.users.id, userId))
      .run();
  } catch {
    // Pre-migration boots can hit this column-doesn't-exist branch; it's
    // self-healing once migrations apply, and we'd rather not crash auth.
  }
}

export const onlineRoutes = new Elysia()
  .get('/api/online', () => {
    const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
    const rows = db.select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatarPath: schema.users.avatarPath,
      primaryColor: schema.users.primaryColor,
      secondaryColor: schema.users.secondaryColor,
      tertiaryColor: schema.users.tertiaryColor,
      role: schema.users.role,
      statusMessage: schema.users.statusMessage,
      lastSeenAt: schema.users.lastSeenAt,
    }).from(schema.users)
      .where(sql`${schema.users.active} = 1 AND ${schema.users.lastSeenAt} IS NOT NULL AND ${schema.users.lastSeenAt} >= ${cutoff}`)
      .orderBy(sql`${schema.users.lastSeenAt} DESC`)
      .limit(40)
      .all();
    return { users: rows };
  });
