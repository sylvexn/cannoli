/**
 * Usage analytics — dev-only read API for the admin "Usage" dashboard.
 *
 * Serves windowed aggregates straight from raw usage_events (90-day
 * retention — see lib/usage.ts; the daily rollup tables exist so history
 * survives beyond that window, not to serve these queries). Every route is
 * gated by `requireDev`, same as the Observability tab.
 *
 * Visitor identity: user_id when the hit was authenticated, else the
 * daily-rotating anon_id — so "visitors" = COUNT(DISTINCT coalesced key).
 */
import { Elysia } from 'elysia';
import { sqlite } from '../../db';
import { requireDev } from '../../lib/auth-guards';

/** user/anon coalesced visitor key (prefixes prevent cross-space collisions). */
const VISITOR_KEY = `COALESCE('u:' || user_id, 'a:' || anon_id)`;

/** Clamp the ?days window to [1, 90] (raw retention). */
function clampDays(raw: string | undefined, def: number): number {
  const n = parseInt(raw ?? '');
  return Math.min(Math.max(Number.isNaN(n) ? def : n, 1), 90);
}

/** SQLite datetime modifier for "start of the window, N days back incl. today". */
function windowStart(days: number): string {
  return `-${days - 1} days`;
}

function countScalar(sql: string, ...params: (string | number)[]): number {
  const row = sqlite.query<{ c: number }, (string | number)[]>(sql).get(...params);
  return row?.c ?? 0;
}

export const analyticsAdminRoutes = new Elysia()

  // ── 1. Summary (tiles + timeline + breakdowns) ────────────────────────────

  .get('/api/admin/analytics/summary', ({ query }) => {
    const days = clampDays(query.days as string | undefined, 30);
    const start = windowStart(days);

    const tiles = {
      liveNow: countScalar(
        `SELECT COUNT(DISTINCT ${VISITOR_KEY}) AS c FROM usage_events
         WHERE ts >= datetime('now', '-5 minutes')`,
      ),
      viewsToday: countScalar(
        `SELECT COUNT(*) AS c FROM usage_events
         WHERE event = 'pageview' AND ts >= datetime('now', 'start of day')`,
      ),
      visitorsToday: countScalar(
        `SELECT COUNT(DISTINCT ${VISITOR_KEY}) AS c FROM usage_events
         WHERE ts >= datetime('now', 'start of day')`,
      ),
      // Trailing 7/30 days regardless of the ?days window.
      wau: countScalar(
        `SELECT COUNT(DISTINCT ${VISITOR_KEY}) AS c FROM usage_events
         WHERE ts >= datetime('now', '-7 days')`,
      ),
      mau: countScalar(
        `SELECT COUNT(DISTINCT ${VISITOR_KEY}) AS c FROM usage_events
         WHERE ts >= datetime('now', '-30 days')`,
      ),
    };

    // Per-day series, zero-filled over the whole window (UTC days, matching
    // SQLite's date('now')).
    const dayRows = sqlite.query<{ d: string; views: number; visitors: number }, [string]>(`
      SELECT date(ts) AS d,
             SUM(CASE WHEN event = 'pageview' THEN 1 ELSE 0 END) AS views,
             COUNT(DISTINCT ${VISITOR_KEY}) AS visitors
      FROM usage_events
      WHERE ts >= datetime('now', 'start of day', ?)
      GROUP BY d
    `).all(start);
    const byDay = new Map(dayRows.map(r => [r.d, r]));
    const timeline: { date: string; views: number; visitors: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const row = byDay.get(date);
      timeline.push({ date, views: row?.views ?? 0, visitors: row?.visitors ?? 0 });
    }

    const topRoutes = sqlite.query<{ route: string; views: number; visitors: number }, [string]>(`
      SELECT route, COUNT(*) AS views, COUNT(DISTINCT ${VISITOR_KEY}) AS visitors
      FROM usage_events
      WHERE event = 'pageview' AND ts >= datetime('now', 'start of day', ?)
      GROUP BY route
      ORDER BY views DESC
      LIMIT 20
    `).all(start);

    const events = sqlite.query<{ event: string; count: number; users: number }, [string]>(`
      SELECT event, COUNT(*) AS count, COUNT(DISTINCT ${VISITOR_KEY}) AS users
      FROM usage_events
      WHERE event != 'pageview' AND ts >= datetime('now', 'start of day', ?)
      GROUP BY event
      ORDER BY count DESC
    `).all(start);

    const devices = sqlite.query<{ device: string; views: number }, [string]>(`
      SELECT device, COUNT(*) AS views
      FROM usage_events
      WHERE event = 'pageview' AND ts >= datetime('now', 'start of day', ?)
      GROUP BY device
      ORDER BY views DESC
    `).all(start);

    const referrers = sqlite.query<{ referrer: string; views: number }, [string]>(`
      SELECT referrer, COUNT(*) AS views
      FROM usage_events
      WHERE event = 'pageview' AND referrer IS NOT NULL
        AND ts >= datetime('now', 'start of day', ?)
      GROUP BY referrer
      ORDER BY views DESC
      LIMIT 10
    `).all(start);

    return { tiles, timeline, topRoutes, events, devices, referrers };
  }, { beforeHandle: requireDev })

  // ── 2. Per-coach activity (logged-in users only) ──────────────────────────

  .get('/api/admin/analytics/coaches', ({ query }) => {
    const days = clampDays(query.days as string | undefined, 7);
    const start = windowStart(days);

    const rows = sqlite.query<
      { userId: number; username: string; views: number; lastSeenAt: string },
      [string]
    >(`
      SELECT e.user_id AS userId, u.username AS username,
             SUM(CASE WHEN e.event = 'pageview' THEN 1 ELSE 0 END) AS views,
             MAX(e.ts) AS lastSeenAt
      FROM usage_events e
      JOIN users u ON u.id = e.user_id
      WHERE e.user_id IS NOT NULL AND e.ts >= datetime('now', 'start of day', ?)
      GROUP BY e.user_id
      ORDER BY views DESC
    `).all(start);

    // Most-hit route per user (any event — so coaches who only fired feature
    // events still get one), via a windowed rank to avoid N+1.
    const topRows = sqlite.query<{ userId: number; route: string }, [string]>(`
      SELECT userId, route FROM (
        SELECT user_id AS userId, route,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY COUNT(*) DESC, route) AS rn
        FROM usage_events
        WHERE user_id IS NOT NULL AND ts >= datetime('now', 'start of day', ?)
        GROUP BY user_id, route
      ) WHERE rn = 1
    `).all(start);
    const topByUser = new Map(topRows.map(r => [r.userId, r.route]));

    return {
      coaches: rows.map(r => ({
        userId: r.userId,
        username: r.username,
        views: r.views,
        lastSeenAt: r.lastSeenAt,
        topRoute: topByUser.get(r.userId) ?? '/',
      })),
    };
  }, { beforeHandle: requireDev })

  // ── 3. Live feed (last 5 minutes) ─────────────────────────────────────────

  .get('/api/admin/analytics/live', () => {
    const entries = sqlite.query<
      { username: string | null; route: string; event: string; ts: string },
      []
    >(`
      SELECT u.username AS username, e.route AS route, e.event AS event, e.ts AS ts
      FROM usage_events e
      LEFT JOIN users u ON u.id = e.user_id
      WHERE e.ts >= datetime('now', '-5 minutes')
      ORDER BY e.id DESC
      LIMIT 50
    `).all();
    return { entries };
  }, { beforeHandle: requireDev });
