/**
 * Scheduled (future-week) trades and FA requests.
 *
 * An admin approving a trade / FA request picks the league week it takes effect
 * in — by default the week AFTER the current one, so a mid-week approval never
 * changes the roster a team is already playing with. When that week is in the
 * future the approval is recorded but rosters are NOT touched; the row sits with
 * `applied_at IS NULL` until the league reaches its effective week, at which
 * point `applyDueTransactions()` re-validates and applies it.
 *
 * The sweep is idempotent and driven purely by DB state (league.currentWeek vs
 * effective_week), so it's safe to call from the hourly scheduler, straight
 * after a manual week advance, or twice in a row.
 */
import { db, schema } from '../db';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { tx } from './tx';
import { notifyUser, notifyStaff } from './notifications/notify';
import { validateProposedTrade, executeRosterSwap } from './trade-core';
import { applyFaPickup, applyTeraCaptains } from './free-agency';

type LeagueRow = typeof schema.leagues.$inferSelect;

/**
 * Resolve the league week an approval takes effect in.
 *
 * Default is `currentWeek + 1` — trades and FA moves land on the NEXT week, not
 * the one already in progress. An explicit admin choice wins but is clamped to
 * a real integer week in [currentWeek, totalWeeks]: an admin may deliberately
 * apply something to the current week (the escape hatch), never to a past one.
 */
export function resolveEffectiveWeek(opts: {
  requested?: number;
  league: LeagueRow | null | undefined;
  fallbackWeek: number;
}): number {
  const { requested, league, fallbackWeek } = opts;
  const currentWeek = league?.currentWeek ?? fallbackWeek;
  // totalWeeks lives on the league row, not the season.
  const maxWeek = league?.totalWeeks ?? 30;
  // Outside the regular season (currentWeek 0 in predraft/draft) there is no
  // "next week" to defer to — fall back to week 1 so the clamp stays sane.
  const defaultWeek = Math.max(1, currentWeek + 1);
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return Math.min(defaultWeek, maxWeek);
  }
  return Math.min(Math.max(Math.max(1, currentWeek), Math.trunc(requested)), maxWeek);
}

function notifyTeamOwner(teamId: string, leagueId: string, msg: { title: string; body: string; link?: string }) {
  try {
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    if (team?.userId == null) return;
    notifyUser(team.userId, {
      type: 'system',
      title: msg.title,
      body: msg.body,
      link: msg.link ?? `/league/${leagueId}`,
    });
  } catch { /* best-effort */ }
}

/** Tell both sides of a trade when it takes effect. */
export function notifyTradeScheduled(opts: {
  proposerId: string;
  recipientId: string;
  leagueId: string;
  effectiveWeek: number;
  applied: boolean;
}) {
  const { proposerId, recipientId, leagueId, effectiveWeek, applied } = opts;
  const title = applied ? 'Trade approved' : 'Trade approved — scheduled';
  const body = applied
    ? `Your trade was approved and is live for Week ${effectiveWeek}.`
    : `Your trade was approved and takes effect at the start of Week ${effectiveWeek}. Rosters are unchanged until then.`;
  for (const teamId of [proposerId, recipientId]) {
    notifyTeamOwner(teamId, leagueId, { title, body, link: `/league/${leagueId}/market/trades` });
  }
}

function logActivity(opts: { type: string; leagueId: string; description: string; metadata: unknown }) {
  db.insert(schema.activityLog).values({
    type: opts.type,
    category: 'trade',
    actor: 'system',
    leagueId: opts.leagueId,
    description: opts.description,
    metadata: JSON.stringify(opts.metadata),
  }).run();
}

/**
 * A scheduled row that no longer validates when its week arrives (the roster
 * shifted under it via another trade/FA) is terminated rather than retried
 * forever: it flips to rejected with the reason, and everyone involved is told.
 */
function failScheduled(kind: 'trade' | 'fa', id: number, leagueId: string, reason: string, teamIds: string[]) {
  const stamp = new Date().toISOString();
  tx(() => {
    if (kind === 'trade') {
      db.update(schema.trades).set({
        status: 'rejected', rejectReason: `Auto-apply failed: ${reason}`, resolvedAt: stamp, resolvedBy: 'system',
      }).where(eq(schema.trades.id, id)).run();
    } else {
      db.update(schema.faRequests).set({
        status: 'rejected', rejectReason: `Auto-apply failed: ${reason}`, resolvedAt: stamp, resolvedBy: 'system',
      }).where(eq(schema.faRequests.id, id)).run();
    }
    logActivity({
      type: kind === 'trade' ? 'trade_auto_apply_failed' : 'fa_auto_apply_failed',
      leagueId,
      description: `Scheduled ${kind} #${id} could not be applied: ${reason}`,
      metadata: { id, reason },
    });
  });
  for (const teamId of teamIds) {
    notifyTeamOwner(teamId, leagueId, {
      title: kind === 'trade' ? 'Scheduled trade could not be applied' : 'Scheduled pickup could not be applied',
      body: `${reason} — it was cancelled. Re-submit if you still want it.`,
    });
  }
  notifyStaff({
    type: 'system',
    title: `Scheduled ${kind} auto-apply failed`,
    body: `${kind} #${id}: ${reason}`,
    link: '/admin/trades',
  });
  console.warn(`[apply-scheduled] ${kind} #${id} failed: ${reason}`);
}

/**
 * Apply every approved-but-not-yet-applied trade / FA request whose effective
 * week the league has now reached. Oldest approval first, so two moves touching
 * the same Pokemon resolve in the order the admin signed off on them.
 *
 * Returns the number of rows applied (used by the scheduler log / tests).
 */
export function applyDueTransactions(leagueId?: string): number {
  const leagues = leagueId
    ? [db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get()].filter(Boolean) as LeagueRow[]
    : db.select().from(schema.leagues).all();

  let applied = 0;
  for (const league of leagues) {
    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get();

    // Trades
    const dueTrades = db.select().from(schema.trades)
      .where(and(
        eq(schema.trades.leagueId, league.id),
        eq(schema.trades.status, 'accepted'),
        isNull(schema.trades.appliedAt),
        lte(schema.trades.effectiveWeek, league.currentWeek),
      ))
      .orderBy(asc(schema.trades.resolvedAt), asc(schema.trades.id))
      .all();

    for (const trade of dueTrades) {
      const offering = JSON.parse(trade.offering) as string[];
      const requesting = JSON.parse(trade.requesting) as string[];
      const invalid = validateProposedTrade({
        proposerId: trade.proposerId,
        recipientId: trade.recipientId,
        offering, requesting,
        pointCap: season?.pointCap ?? 110,
        leagueId: league.id,
        minRosterSize: league.minRosterSize ?? league.rosterSize,
        maxRosterSize: league.maxRosterSize ?? league.rosterSize,
      });
      if (invalid) {
        failScheduled('trade', trade.id, league.id, invalid, [trade.proposerId, trade.recipientId]);
        continue;
      }
      try {
        tx(() => {
          executeRosterSwap({
            proposerId: trade.proposerId,
            recipientId: trade.recipientId,
            offering, requesting,
            week: trade.effectiveWeek ?? league.currentWeek,
            leagueId: league.id,
          });
          db.update(schema.trades).set({ appliedAt: new Date().toISOString() })
            .where(eq(schema.trades.id, trade.id)).run();
          logActivity({
            type: 'trade_applied',
            leagueId: league.id,
            description: `Scheduled trade took effect (Week ${trade.effectiveWeek}): ${offering.join(', ')} for ${requesting.join(', ')}`,
            metadata: { tradeId: trade.id, effectiveWeek: trade.effectiveWeek },
          });
        });
        applied++;
        notifyTradeScheduled({
          proposerId: trade.proposerId,
          recipientId: trade.recipientId,
          leagueId: league.id,
          effectiveWeek: trade.effectiveWeek ?? league.currentWeek,
          applied: true,
        });
      } catch (e) {
        failScheduled('trade', trade.id, league.id, (e as Error).message, [trade.proposerId, trade.recipientId]);
      }
    }

    // FA requests (pickups + tera changes)
    const dueFa = db.select().from(schema.faRequests)
      .where(and(
        eq(schema.faRequests.leagueId, league.id),
        eq(schema.faRequests.status, 'approved'),
        isNull(schema.faRequests.appliedAt),
        lte(schema.faRequests.effectiveWeek, league.currentWeek),
      ))
      .orderBy(asc(schema.faRequests.resolvedAt), asc(schema.faRequests.id))
      .all();

    for (const req of dueFa) {
      const week = req.effectiveWeek ?? league.currentWeek;
      const actor = req.requestedBy ?? req.resolvedBy ?? 'system';
      if (req.requestType === 'tera_change') {
        const captains = JSON.parse(req.teraChanges || '[]') as { pokemonName: string; teraTypes: string[] }[];
        const result = applyTeraCaptains(req.teamId, captains, actor, week);
        if (!result.ok) {
          failScheduled('fa', req.id, league.id, result.error, [req.teamId]);
          continue;
        }
      } else {
        const result = applyFaPickup({
          leagueId: league.id,
          teamId: req.teamId,
          pickupNames: JSON.parse(req.pickups || '[]') as string[],
          dropNames: JSON.parse(req.drops || '[]') as string[],
          actorUsername: actor,
          dryRun: false,
          effectiveWeek: week,
        });
        if (!result.ok) {
          failScheduled('fa', req.id, league.id, result.error, [req.teamId]);
          continue;
        }
      }
      db.update(schema.faRequests).set({ appliedAt: new Date().toISOString() })
        .where(eq(schema.faRequests.id, req.id)).run();
      applied++;
      notifyTeamOwner(req.teamId, league.id, {
        title: req.requestType === 'tera_change' ? 'Tera change now live' : 'Free agent pickup now live',
        body: `Your approved ${req.requestType === 'tera_change' ? 'tera change' : 'pickup'} took effect for Week ${week}.`,
        link: `/league/${league.id}/market/free-agents`,
      });
    }
  }

  if (applied > 0) console.log(`[apply-scheduled] applied ${applied} scheduled transaction(s)`);
  return applied;
}
