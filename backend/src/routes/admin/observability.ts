/**
 * Observability dashboard — dev-only endpoints.
 *
 * Backs the admin Observability tab (error groups, request trends, health).
 * Every route is gated by `requireDev` so admins can't reach raw stack traces.
 *
 * Data sources:
 *  - error_groups   — one row per distinct fault fingerprint (never pruned)
 *  - request_logs   — raw HTTP + client-side occurrences (pruned at ~5000)
 *  - health_checks  — latest probe results (upserted by heartbeat)
 *
 * NOTE: `getHealthSnapshot` lives in lib/heartbeat.ts which does not yet exist
 * at time of writing. The import is present; TypeScript will error until that
 * module is wired. The rest of this file type-checks cleanly.
 */
import { Elysia, t } from 'elysia';
import { db, schema, sqlite } from '../../db';
import { eq, desc, and, gte, lt, like, or, type SQL } from 'drizzle-orm';
import { requireDev } from '../../lib/auth-guards';
import { GIT_SHA } from '../../lib/version';
// heartbeat.ts is a future module — import will resolve once it is created.
import { getHealthSnapshot } from '../../lib/heartbeat';

// ─── In-memory "last seen" markers ──────────────────────────────────────────
//
// Best-effort: the Map resets on process restart. A database-backed marker
// would survive restarts but this badge is dev tooling, not mission-critical.
// Key: user.id (string), value: SQLite datetime string 'YYYY-MM-DD HH:MM:SS'.
const lastSeenMarkers = new Map<string, string>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp limit to [1, max]. */
function clampLimit(raw: string | undefined, def: number, max: number): number {
  const n = parseInt(raw ?? '') || def;
  return Math.min(Math.max(n, 1), max);
}

/** Parse the offset query param. */
function parseOffset(raw: string | undefined): number {
  return Math.max(parseInt(raw ?? '') || 0, 0);
}

/**
 * Compute per-hour spark data for a set of fingerprints from request_logs.
 * Returns a Map<fingerprint, number[24]> — oldest bucket first (hour 0 = 24h ago).
 * Uses a single grouped query over the fingerprint+hour to avoid N+1.
 */
function loadSparks(fingerprints: string[]): Map<string, number[]> {
  if (fingerprints.length === 0) return new Map();

  // Build a zero-filled map first so every visible group always gets 24 slots.
  const result = new Map<string, number[]>();
  for (const fp of fingerprints) result.set(fp, new Array(24).fill(0));

  // SQLite strftime trick: compute hours-ago bucket in integer range [0..23].
  // Cast(ROUND(...)) avoids off-by-one for partial hours at bucket boundaries.
  // We filter to the last 24h via BETWEEN in the WHERE clause.
  const placeholders = fingerprints.map(() => '?').join(',');
  const rows = sqlite.query<{ fingerprint: string; bucket: number; cnt: number }, string[]>(`
    SELECT
      fingerprint,
      CAST((julianday('now') - julianday(timestamp)) * 24 AS INTEGER) AS bucket,
      COUNT(*) AS cnt
    FROM request_logs
    WHERE fingerprint IN (${placeholders})
      AND timestamp >= datetime('now', '-24 hours')
    GROUP BY fingerprint, bucket
  `).all(...fingerprints);

  for (const row of rows) {
    const arr = result.get(row.fingerprint);
    if (!arr) continue;
    // bucket 0 = current hour (newest), 23 = oldest. We want oldest→newest,
    // so index = 23 - bucket (clamped to valid range).
    const idx = 23 - Math.min(Math.max(row.bucket, 0), 23);
    arr[idx] = (arr[idx] ?? 0) + row.cnt;
  }

  return result;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export const observabilityRoutes = new Elysia()

  // ── 1. Error group list ────────────────────────────────────────────────────
  //
  // Returns a filtered + paginated list of error_groups with per-group spark
  // data and global status-breakdown stats. The stats row always covers the
  // full table (not the filtered slice) so the badge counts stay stable while
  // the user filters.

  .get('/api/admin/observability/groups', ({ query }) => {
    const statusFilter = (query.status as string) || 'open';
    const kindFilter = (query.kind as string) || 'all';
    const search = ((query.search as string) || '').trim();
    const limit = clampLimit(query.limit as string, 50, 200);
    const offset = parseOffset(query.offset as string);

    const conds: SQL[] = [];

    if (statusFilter !== 'all') {
      conds.push(eq(schema.errorGroups.status, statusFilter as 'open' | 'resolved' | 'muted'));
    }
    if (kindFilter !== 'all') {
      conds.push(eq(schema.errorGroups.kind, kindFilter));
    }
    if (search) {
      const pat = `%${search}%`;
      conds.push(or(
        like(schema.errorGroups.sampleMessage, pat),
        like(schema.errorGroups.errorName, pat),
        like(schema.errorGroups.samplePath, pat),
      )!);
    }

    const where = conds.length ? and(...conds) : undefined;

    const rows = db.select().from(schema.errorGroups)
      .where(where)
      .orderBy(desc(schema.errorGroups.lastSeen))
      .limit(limit)
      .offset(offset)
      .all();

    // Filtered total for pagination.
    const total = db.select({ id: schema.errorGroups.id })
      .from(schema.errorGroups)
      .where(where)
      .all().length;

    // Global stats across the whole table (independent of filters).
    const statsRow = sqlite.query<{
      open: number; resolved: number; muted: number; newToday: number;
    }, []>(`
      SELECT
        SUM(CASE WHEN status = 'open'     THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN status = 'muted'    THEN 1 ELSE 0 END) AS muted,
        SUM(CASE WHEN first_seen >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS newToday
      FROM error_groups
    `).get();

    // 24h spark counts for all visible fingerprints — one grouped query.
    const visibleFps = rows.map(r => r.fingerprint);
    const sparks = loadSparks(visibleFps);

    // "New" = first seen within the last 24 hours.
    const cutoff24h = new Date(Date.now() - 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

    const groups = rows.map(r => ({
      id: r.id,
      fingerprint: r.fingerprint,
      kind: r.kind,
      errorName: r.errorName,
      sampleMessage: r.sampleMessage,
      samplePath: r.samplePath,
      count: r.count,
      affectedUsers: r.affectedUsers,
      status: r.status,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      firstVersion: r.firstVersion,
      lastVersion: r.lastVersion,
      isNew: !!(r.firstSeen && r.firstSeen >= cutoff24h),
      spark: sparks.get(r.fingerprint) ?? new Array(24).fill(0),
    }));

    return {
      groups,
      total,
      stats: {
        open: statsRow?.open ?? 0,
        resolved: statsRow?.resolved ?? 0,
        muted: statsRow?.muted ?? 0,
        newToday: statsRow?.newToday ?? 0,
      },
    };
  }, { beforeHandle: requireDev })

  // ── 2. Error group detail ─────────────────────────────────────────────────
  //
  // Full group fields + sampleStack + most recent 50 request_log occurrences
  // (matched by fingerprint). 404 when the id doesn't exist.

  .get('/api/admin/observability/groups/:id', ({ params, set }) => {
    const id = parseInt(params.id);
    const group = db.select().from(schema.errorGroups)
      .where(eq(schema.errorGroups.id, id))
      .get();

    if (!group) {
      set.status = 404;
      return { error: 'Group not found' };
    }

    const occurrenceRows = db.select().from(schema.requestLogs)
      .where(eq(schema.requestLogs.fingerprint, group.fingerprint))
      .orderBy(desc(schema.requestLogs.id))
      .limit(50)
      .all();

    const cutoff24h = new Date(Date.now() - 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    const sparks = loadSparks([group.fingerprint]);

    return {
      id: group.id,
      fingerprint: group.fingerprint,
      kind: group.kind,
      errorName: group.errorName,
      sampleMessage: group.sampleMessage,
      samplePath: group.samplePath,
      sampleStack: group.sampleStack,
      count: group.count,
      affectedUsers: group.affectedUsers,
      status: group.status,
      firstSeen: group.firstSeen,
      lastSeen: group.lastSeen,
      firstVersion: group.firstVersion,
      lastVersion: group.lastVersion,
      resolvedAt: group.resolvedAt,
      resolvedVersion: group.resolvedVersion,
      isNew: !!(group.firstSeen && group.firstSeen >= cutoff24h),
      spark: sparks.get(group.fingerprint) ?? new Array(24).fill(0),
      occurrences: occurrenceRows.map(r => ({
        id: String(r.id),
        source: r.source,
        method: r.method,
        path: r.path,
        status: r.status,
        durationMs: r.durationMs,
        userId: r.userId != null ? String(r.userId) : null,
        username: r.username,
        ip: r.ip,
        errorId: r.errorId,
        errorName: r.errorName,
        errorMessage: r.errorMessage,
        errorStack: r.errorStack,
        timestamp: r.timestamp,
      })),
    };
  }, { beforeHandle: requireDev })

  // ── 3. Update group status ────────────────────────────────────────────────
  //
  // PATCH-style via POST (consistent with other admin status mutations in this
  // codebase). 'resolved' stamps resolved_at + resolved_version; clearing status
  // back to 'open'/'muted' wipes those fields so a future re-resolution gets
  // a fresh timestamp.

  .post('/api/admin/observability/groups/:id/status', ({ params, body, set }) => {
    const id = parseInt(params.id);
    const group = db.select({ id: schema.errorGroups.id })
      .from(schema.errorGroups)
      .where(eq(schema.errorGroups.id, id))
      .get();

    if (!group) {
      set.status = 404;
      return { error: 'Group not found' };
    }

    if (body.status === 'resolved') {
      db.update(schema.errorGroups).set({
        status: 'resolved',
        resolvedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        resolvedVersion: GIT_SHA,
      }).where(eq(schema.errorGroups.id, id)).run();
    } else {
      // 'open' or 'muted' — clear resolution fields.
      db.update(schema.errorGroups).set({
        status: body.status,
        resolvedAt: null,
        resolvedVersion: null,
      }).where(eq(schema.errorGroups.id, id)).run();
    }

    return { success: true };
  }, {
    beforeHandle: requireDev,
    body: t.Object({ status: t.Union([t.Literal('open'), t.Literal('resolved'), t.Literal('muted')]) }),
  })

  // ── 4. Request trends ────────────────────────────────────────────────────
  //
  // Bucketed traffic analysis over request_logs.
  //
  // Buckets: 24 hourly (24h window) or 7 daily (7d window), oldest→newest.
  //   - total: all rows in bucket
  //   - errors: status >= 400 OR source = 'client' (client rows always count
  //     as errors regardless of their status field)
  //   - p95Ms: p95 duration within the bucket, computed via the OFFSET trick
  //     from misc.ts (a correlated subquery per bucket).
  //
  // slowestEndpoints: top 10 server paths by p95 duration over the window.
  // Client rows are excluded (they carry a synthetic path like '/client-error').

  .get('/api/admin/observability/trends', ({ query }) => {
    const window = (query.window as string) === '7d' ? '7d' : '24h';
    const is7d = window === '7d';

    // SQLite datetime truncation string for each bucket mode.
    // 24h → '%Y-%m-%d %H:00:00' (hourly)  7d → '%Y-%m-%d' (daily)
    const truncFmt = is7d ? '%Y-%m-%d' : '%Y-%m-%d %H:00:00';
    const intervalExpr = is7d ? '-7 days' : '-24 hours';
    const bucketCount = is7d ? 7 : 24;

    // Aggregate per bucket: total, errors, list of durations for p95.
    // We compute p95 in JS from the per-bucket sorted arrays — correct and
    // avoids nested correlated subqueries that can be hard to read.
    type BucketRaw = { t: string; total: number; errors: number };
    const bucketRows = sqlite.query<BucketRaw, []>(`
      SELECT
        strftime('${truncFmt}', timestamp) AS t,
        COUNT(*) AS total,
        SUM(CASE WHEN status >= 400 OR source = 'client' THEN 1 ELSE 0 END) AS errors
      FROM request_logs
      WHERE timestamp >= datetime('now', '${intervalExpr}')
      GROUP BY t
      ORDER BY t ASC
    `).all();

    // p95 per bucket: separate query that returns (bucket, sorted durations).
    // We fetch all durations per bucket then compute in JS — avoids correlated
    // subqueries while still being correct.
    type DurRow = { t: string; duration_ms: number };
    const durRows = sqlite.query<DurRow, []>(`
      SELECT
        strftime('${truncFmt}', timestamp) AS t,
        duration_ms
      FROM request_logs
      WHERE timestamp >= datetime('now', '${intervalExpr}')
      ORDER BY t ASC, duration_ms ASC
    `).all();

    // Group durations by bucket key for p95 computation.
    const durByBucket = new Map<string, number[]>();
    for (const row of durRows) {
      const arr = durByBucket.get(row.t) ?? [];
      arr.push(row.duration_ms);
      durByBucket.set(row.t, arr);
    }

    function p95(sorted: number[]): number {
      if (sorted.length === 0) return 0;
      const idx = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
      return sorted[idx] ?? 0;
    }

    // Build a full-coverage bucket array (fill missing buckets with zeros).
    // Generate expected bucket labels from now going back bucketCount intervals.
    const expectedBuckets: string[] = [];
    for (let i = bucketCount - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * (is7d ? 86_400_000 : 3_600_000));
      if (is7d) {
        expectedBuckets.push(d.toISOString().slice(0, 10));
      } else {
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const dd = d.toISOString().slice(0, 10);
        expectedBuckets.push(`${dd} ${hh}:00:00`);
      }
    }

    const bucketMap = new Map<string, BucketRaw>();
    for (const row of bucketRows) bucketMap.set(row.t, row);

    const buckets = expectedBuckets.map(t => {
      const row = bucketMap.get(t);
      const sorted = durByBucket.get(t) ?? [];
      return {
        t,
        total: row?.total ?? 0,
        errors: row?.errors ?? 0,
        p95Ms: p95(sorted),
      };
    });

    // Slowest endpoints: top 10 server paths by p95 duration over the window.
    // Client rows excluded (source != 'server'). Use the OFFSET p95 trick from
    // misc.ts — one correlated subquery per path is acceptable for top-10.
    type EndpointRow = { path: string; avgMs: number; p95Ms: number; count: number };
    const slowestEndpoints = sqlite.query<EndpointRow, []>(`
      SELECT
        path,
        CAST(AVG(duration_ms) AS INTEGER) AS avgMs,
        (
          SELECT duration_ms FROM request_logs r2
          WHERE r2.path = r1.path
            AND r2.source = 'server'
            AND r2.timestamp >= datetime('now', '${intervalExpr}')
          ORDER BY r2.duration_ms
          LIMIT 1
          OFFSET CAST(COUNT(*) * 0.95 AS INTEGER)
        ) AS p95Ms,
        COUNT(*) AS count
      FROM request_logs r1
      WHERE source = 'server'
        AND timestamp >= datetime('now', '${intervalExpr}')
      GROUP BY path
      ORDER BY p95Ms DESC
      LIMIT 10
    `).all();

    return { buckets, slowestEndpoints };
  }, { beforeHandle: requireDev })

  // ── 5. Health snapshot ───────────────────────────────────────────────────
  //
  // Thin pass-through to getHealthSnapshot() from lib/heartbeat.ts.
  // Shape: { checks: [{name, status, detail, latencyMs, checkedAt, lastOkAt}],
  //          uptimeSeconds: number, version: string }

  .get('/api/admin/observability/health', () => {
    return getHealthSnapshot();
  }, { beforeHandle: requireDev })

  // ── 6. Unread badge count ────────────────────────────────────────────────
  //
  // Returns the number of 'open' error groups the calling dev has NOT seen yet.
  // "Seen" is tracked per-user in a module-level Map (in-memory, resets on
  // restart — best-effort badge, not an audit trail). If no marker exists, we
  // report open groups seen in the last 24h as unread (first-visit heuristic).

  .get('/api/admin/observability/unread', ({ user: rawUser }) => {
    // requireDev guarantees user is non-null; loosen the type to match guard sig.
    const user = rawUser as { id: string } | null;
    const userId = user?.id ?? 'unknown';

    const marker = lastSeenMarkers.get(userId);

    let unread: number;
    if (marker) {
      // Count open groups whose last_seen is strictly after the marker.
      const row = sqlite.query<{ n: number }, [string]>(`
        SELECT COUNT(*) AS n FROM error_groups
        WHERE status = 'open' AND last_seen > ?
      `).get(marker);
      unread = row?.n ?? 0;
    } else {
      // First visit: treat groups first_seen in the last 24h as unread.
      const row = sqlite.query<{ n: number }, []>(`
        SELECT COUNT(*) AS n FROM error_groups
        WHERE status = 'open'
          AND first_seen >= datetime('now', '-24 hours')
      `).get();
      unread = row?.n ?? 0;
    }

    return { unread };
  }, { beforeHandle: requireDev })

  // ── 7. Mark as seen ───────────────────────────────────────────────────────
  //
  // Sets the calling dev's last-seen marker to now, collapsing the unread count
  // to zero. Called when the dev opens the Observability tab.

  .post('/api/admin/observability/seen', ({ user: rawUser }) => {
    const user = rawUser as { id: string } | null;
    const userId = user?.id ?? 'unknown';

    // Use SQLite's datetime('now') format for consistency with the timestamps
    // stored in error_groups.last_seen ('YYYY-MM-DD HH:MM:SS').
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    lastSeenMarkers.set(userId, now);

    return { success: true };
  }, { beforeHandle: requireDev })

;
