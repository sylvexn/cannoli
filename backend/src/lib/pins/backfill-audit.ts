/**
 * Pin audit-log backfill.
 *
 * Earlier auto-award + admin-mint flows wrote to `pins` without emitting a
 * matching `pin_awarded` activity_log row. This walks the `pins` table and
 * inserts any missing entries so the admin Activity Log surfaces full history.
 *
 * Idempotent: identifies "already logged" rows by matching activity_log
 * entries whose `metadata` JSON contains the same `(pinDefId, userId, seasonId)`
 * triple. Safe to re-run after seed or after a fresh import (e.g. S9 archive).
 *
 * Returns `{ inserted, skipped }` so callers can log a summary.
 */
import { db, schema } from '../../db';
import { eq, sql } from 'drizzle-orm';

export interface BackfillSummary {
  inserted: number;
  skipped: number;
}

export function backfillPinAuditLog(): BackfillSummary {
  const summary: BackfillSummary = { inserted: 0, skipped: 0 };

  // Pull every pin row joined to its definition + recipient username so we can
  // synthesize a description identical in shape to the live award path.
  const rows = db.select({
    pinId: schema.pins.id,
    userId: schema.pins.userId,
    pinDefId: schema.pins.pinDefId,
    seasonId: schema.pins.seasonId,
    awardedBy: schema.pins.awardedBy,
    awardedAt: schema.pins.awardedAt,
    metadata: schema.pins.metadata,
    username: schema.users.username,
    defName: schema.pinDefinitions.name,
  })
    .from(schema.pins)
    .innerJoin(schema.users, eq(schema.users.id, schema.pins.userId))
    .innerJoin(schema.pinDefinitions, eq(schema.pinDefinitions.id, schema.pins.pinDefId))
    .all();

  for (const r of rows) {
    // Idempotency probe — does an activity_log row already reference this
    // exact (pinDefId, userId, seasonId) triple? json_extract is null-safe in
    // sqlite, and the `seasonId IS NULL ↔ json_extract returns NULL` case is
    // handled with a coalesce.
    const existing = db.select({ c: sql<number>`COUNT(*)` })
      .from(schema.activityLog)
      .where(sql`
        ${schema.activityLog.type} = 'pin_awarded'
        AND json_extract(${schema.activityLog.metadata}, '$.pinDefId') = ${r.pinDefId}
        AND CAST(json_extract(${schema.activityLog.metadata}, '$.userId') AS INTEGER) = ${r.userId}
        AND COALESCE(CAST(json_extract(${schema.activityLog.metadata}, '$.seasonId') AS INTEGER), -1)
            = COALESCE(${r.seasonId ?? null}, -1)
      `)
      .get();
    if ((existing?.c ?? 0) > 0) {
      summary.skipped += 1;
      continue;
    }

    const auto = r.awardedBy == null;
    const actor = auto
      ? 'system'
      : db.select({ username: schema.users.username })
          .from(schema.users).where(eq(schema.users.id, r.awardedBy!)).get()?.username ?? 'system';

    let metaObj: Record<string, unknown> = {};
    if (r.metadata) {
      try { metaObj = JSON.parse(r.metadata) as Record<string, unknown>; } catch { /* noop */ }
    }

    db.insert(schema.activityLog).values({
      type: 'pin_awarded',
      category: 'admin',
      actor,
      leagueId: null,
      description: `${auto ? 'Auto-awarded' : 'Awarded'} '${r.defName}' to ${r.username}`,
      metadata: JSON.stringify({
        userId: r.userId,
        username: r.username,
        pinDefId: r.pinDefId,
        pinName: r.defName,
        seasonId: r.seasonId,
        awardedById: r.awardedBy,
        auto,
        backfilled: true,
        ...metaObj,
      }),
      // Backfilled rows mirror the original `awardedAt` so they sort in
      // historical position rather than spamming "now".
      timestamp: r.awardedAt ?? undefined,
    }).run();
    summary.inserted += 1;
  }

  return summary;
}
