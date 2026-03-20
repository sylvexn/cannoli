/**
 * Expire-trades job — flips long-pending or post-deadline trade proposals to
 * status='expired'.
 *
 * Two expiry triggers:
 *   1. Age-based: proposedAt older than siteSettings.tradeExpiryDays (default 7)
 *   2. Deadline-based: league's currentWeek >= season.tradeDeadlineWeek
 *
 * Idempotent — driven entirely by DB state. Mutations are wrapped in tx().
 */

import { db, schema } from '../../db';
import { and, eq, sql, inArray } from 'drizzle-orm';
import { tx } from '../tx';

export function runExpireTrades() {
  const now = new Date();
  const nowIso = now.toISOString();

  const settings = db.select().from(schema.siteSettings).get();
  const expiryDays = settings?.tradeExpiryDays ?? 7;
  const cutoffMs = now.getTime() - expiryDays * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  // 1) Age-based candidates (proposedAt < cutoff, status pending or awaiting_admin)
  const ageRows = db.select().from(schema.trades)
    .where(and(
      inArray(schema.trades.status, ['pending', 'awaiting_admin']),
      sql`${schema.trades.proposedAt} IS NOT NULL`,
      sql`${schema.trades.proposedAt} < ${cutoffIso}`,
    ))
    .all();

  // 2) Deadline-based candidates: trades whose league's season has currentWeek >= tradeDeadlineWeek
  // Filter by status in JS after the join read; small N, simple is fine.
  const liveTrades = db.select().from(schema.trades)
    .where(inArray(schema.trades.status, ['pending', 'awaiting_admin']))
    .all();

  const deadlineRows = liveTrades.filter(t => {
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, t.leagueId)).get();
    if (!league) return false;
    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get();
    if (!season) return false;
    if (season.tradeDeadlineWeek <= 0) return false;
    return season.currentWeek >= season.tradeDeadlineWeek;
  });

  // De-dupe by id
  const byId = new Map<number, { trade: typeof ageRows[number]; reason: 'age' | 'deadline' }>();
  for (const t of ageRows) byId.set(t.id, { trade: t, reason: 'age' });
  for (const t of deadlineRows) if (!byId.has(t.id)) byId.set(t.id, { trade: t, reason: 'deadline' });

  if (byId.size === 0) return;

  for (const { trade, reason } of byId.values()) {
    tx(() => {
      // Re-check status inside tx to avoid racing approve/reject endpoints
      const fresh = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id)).get();
      if (!fresh) return;
      if (fresh.status !== 'pending' && fresh.status !== 'awaiting_admin') return;

      db.update(schema.trades).set({
        status: 'expired',
        resolvedAt: nowIso,
        resolvedBy: 'system',
      }).where(eq(schema.trades.id, trade.id)).run();

      db.insert(schema.activityLog).values({
        type: 'trade_expired',
        category: 'trade',
        actor: 'system',
        leagueId: trade.leagueId,
        description: reason === 'deadline'
          ? `Trade ${trade.id} expired (deadline reached)`
          : `Trade ${trade.id} expired after ${expiryDays}d`,
        metadata: JSON.stringify({
          tradeId: trade.id,
          reason,
          proposedAt: trade.proposedAt,
          proposerId: trade.proposerId,
          recipientId: trade.recipientId,
        }),
      }).run();
    });

    console.log(`[expire-trades] trade ${trade.id} (${reason})`);
  }
}
