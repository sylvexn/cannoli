import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { isStaff } from '../lib/auth';
import { tx } from '../lib/tx';
import { getLeague, getTeamRoster, isTradeDeadlinePassed as deadlinePassed } from '../lib/queries';
import { checkLeagueArchived } from '../lib/archive-guard';
import { effectiveCost } from '../lib/tera-cost';
import { getLeagueCostMap } from '../lib/league-costs';
import { validateRosterLegality } from '../lib/roster-legality';
import { refreshUserMap } from '../lib/ps-bot';
import { notifyStaff } from '../lib/notifications/notify';
import { validateProposedTrade, executeRosterSwap } from '../lib/trade-core';
import { resolveEffectiveWeek, notifyTradeScheduled } from '../lib/scheduled-transactions';
import { leaguePendingMoves } from '../lib/projected-roster';

/**
 * Phase gate for trade actions. Trades may only be proposed, responded-to,
 * or admin-approved while the league is in the 'regular' phase. Predraft/draft
 * are pre-roster; playoffs/offseason lock rosters.
 */
function regularPhaseError(league: { phase: string; name?: string } | null | undefined): string | null {
  if (!league) return 'League not found';
  if (league.phase !== 'regular') {
    return `Trades are only allowed during the regular season (current phase: ${league.phase})`;
  }
  return null;
}

function loadTradeContext(tradeId: number) {
  const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
  if (!trade) return null;
  // Both proposer and recipient teams must belong to the trade's league.
  // Otherwise treat the trade as not-found to avoid leaking existence and
  // to block cross-league actions on a crafted tradeId.
  const proposerTeam = db.select().from(schema.teams).where(eq(schema.teams.id, trade.proposerId)).get();
  const recipientTeam = db.select().from(schema.teams).where(eq(schema.teams.id, trade.recipientId)).get();
  if (!proposerTeam || !recipientTeam) return null;
  if (proposerTeam.leagueId !== trade.leagueId) return null;
  if (recipientTeam.leagueId !== trade.leagueId) return null;
  const league = getLeague(trade.leagueId);
  const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;
  return { trade, league, season, proposerTeam, recipientTeam };
}

export const tradeRoutes = new Elysia()

  // Trade Reads

  .get('/api/leagues/:leagueId/trades', ({ params }) => {
    return db.select().from(schema.trades)
      .where(eq(schema.trades.leagueId, params.leagueId))
      .orderBy(desc(schema.trades.proposedAt))
      .all()
      .map(t => ({
        id: String(t.id),
        leagueId: t.leagueId,
        week: t.week,
        status: t.status,
        proposerId: t.proposerId,
        recipientId: t.recipientId,
        offering: JSON.parse(t.offering),
        requesting: JSON.parse(t.requesting),
        proposedAt: t.proposedAt,
        resolvedAt: t.resolvedAt,
        resolvedBy: t.resolvedBy,
        rejectReason: t.rejectReason,
        effectiveWeek: t.effectiveWeek,
        appliedAt: t.appliedAt,
      }));
  })

  // Projected rosters for teams with approved-but-unapplied moves, so the trade
  // composer's point meter matches what validateProposedTrade will actually see.
  // Keyed by team id; teams with nothing pending are omitted.
  .get('/api/leagues/:leagueId/pending-moves', ({ params, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    return leaguePendingMoves(params.leagueId);
  })

  .get('/api/leagues/:leagueId/trade-block', ({ params }) => {
    return db.select().from(schema.tradeBlockListings)
      .where(eq(schema.tradeBlockListings.leagueId, params.leagueId))
      .all()
      .map(l => ({
        id: l.id,
        teamId: l.teamId,
        pokemonName: l.pokemonName,
        note: l.note,
      }));
  })

  // Counterparty respond (accept → awaiting_admin, reject → rejected)

  .post('/api/trades/:id/respond', ({ params, query, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const tradeId = parseInt(params.id);
    const ctx = loadTradeContext(tradeId);
    if (!ctx) { set.status = 404; return { error: 'Trade not found' }; }
    const { trade, league, proposerTeam, recipientTeam, season } = ctx;
    const archived = checkLeagueArchived(trade.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }
    if (trade.status !== 'pending') { set.status = 400; return { error: 'Trade is not pending' }; }

    const { action, reason } = body as { action: 'accept' | 'reject'; reason?: string };
    if (action !== 'accept' && action !== 'reject') { set.status = 400; return { error: 'action must be accept or reject' }; }

    // Authorization: counterparty manager (owner of recipient team) or staff
    const isOwner = recipientTeam.userId != null && recipientTeam.userId === parseInt(user.id);
    if (!isOwner && !isStaff(user)) { set.status = 403; return { error: 'Not your trade to respond to' }; }

    // Phase gate: only allow accept/reject during the regular season. If the
    // league has rolled into playoffs or back to predraft (rare, admin-driven),
    // the trade can no longer execute even if accepted.
    if (action === 'accept') {
      const phaseErr = regularPhaseError(league);
      if (phaseErr) {
        set.status = 409;
        return { error: phaseErr, code: 'TRADE_WRONG_PHASE', phase: league?.phase };
      }
      if (deadlinePassed(league)) {
        set.status = 400;
        return { error: `Trade deadline has passed (Week ${league!.tradeDeadlineWeek})`, code: 'TRADE_DEADLINE_PASSED' };
      }

      // Re-validate legality at accept time — rosters may have shifted (other
      // accepted trades / FA pickups) since the proposal. Don't queue a
      // now-illegal trade for the admin to discover later; reject it here.
      const offering = JSON.parse(trade.offering) as string[];
      const requesting = JSON.parse(trade.requesting) as string[];
      const legalityErr = validateProposedTrade({
        proposerId: trade.proposerId,
        recipientId: trade.recipientId,
        offering, requesting,
        pointCap: season?.pointCap ?? 110,
        leagueId: trade.leagueId,
        minRosterSize: league ? (league.minRosterSize ?? league.rosterSize) : undefined,
        maxRosterSize: league ? (league.maxRosterSize ?? league.rosterSize) : undefined,
        excludeTradeId: tradeId,
      });
      if (legalityErr) {
        set.status = 409;
        return { error: legalityErr, code: 'TRADE_NO_LONGER_LEGAL' };
      }
    }

    return tx(() => {
      if (action === 'accept') {
        db.update(schema.trades).set({
          status: 'awaiting_admin',
        }).where(eq(schema.trades.id, tradeId)).run();

        db.insert(schema.activityLog).values({
          type: 'trade_counterparty_accepted',
          category: 'trade',
          actor: user.username,
          leagueId: trade.leagueId,
          description: `${user.username} accepted trade — awaiting admin approval`,
          metadata: JSON.stringify({ tradeId, proposerId: trade.proposerId, recipientId: trade.recipientId }),
        }).run();

        notifyStaff({
          type: 'system',
          title: 'Trade needs approval',
          body: `${proposerTeam.teamName} ↔ ${recipientTeam.teamName}`,
          link: '/admin/trades',
          dedupeKey: `trade:awaiting:${tradeId}`,
        });
      } else {
        db.update(schema.trades).set({
          status: 'rejected',
          resolvedAt: new Date().toISOString(),
          resolvedBy: user.username,
          rejectReason: reason || null,
        }).where(eq(schema.trades.id, tradeId)).run();

        db.insert(schema.activityLog).values({
          type: 'trade_counterparty_rejected',
          category: 'trade',
          actor: user.username,
          leagueId: trade.leagueId,
          description: `${user.username} rejected trade${reason ? ': ' + reason : ''}`,
          metadata: JSON.stringify({ tradeId, reason }),
        }).run();
      }
      return { success: true };
    });
  })

  // Trade Approve/Reject (admin)

  .post('/api/trades/:id/approve', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const tradeId = parseInt(params.id);
    const ctx = loadTradeContext(tradeId);
    if (!ctx) { set.status = 404; return { error: 'Trade not found' }; }
    const { trade, league, season } = ctx;
    const archived = checkLeagueArchived(trade.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

    // Which league week this trade takes effect in. Default = NEXT week, so
    // approving mid-week never changes the roster a team is already playing
    // with. An explicit admin choice wins but is clamped to
    // [currentWeek, totalWeeks] — the UI enforces this, but a direct API caller
    // could otherwise stamp a negative / fractional / past week.
    const { effectiveWeek: bodyEffectiveWeek } = (body || {}) as { effectiveWeek?: number };
    const effectiveWeek = resolveEffectiveWeek({
      requested: bodyEffectiveWeek, league, fallbackWeek: trade.week,
    });
    // A future effective week means the swap is SCHEDULED — recorded now, applied
    // by the apply-scheduled sweep once the league reaches that week.
    const deferred = (league?.currentWeek ?? 0) < effectiveWeek;

    // Approval requires the recipient to have accepted first (status
    // 'awaiting_admin'). A still-'pending' trade must not be approved — that
    // would let an admin who proposed it skip the recipient's acceptance
    // (self-approval of the admin step itself stays allowed).
    if (trade.status === 'pending') {
      set.status = 400;
      return { error: 'Trade must be accepted by the recipient before it can be approved', code: 'TRADE_NOT_ACCEPTED' };
    }
    if (trade.status !== 'awaiting_admin') {
      set.status = 400; return { error: `Trade is ${trade.status}` };
    }

    const phaseErr = regularPhaseError(league);
    if (phaseErr) {
      set.status = 409;
      return { error: phaseErr, code: 'TRADE_WRONG_PHASE', phase: league?.phase };
    }

    if (deadlinePassed(league)) {
      set.status = 400;
      return { error: `Trade deadline has passed (Week ${league!.tradeDeadlineWeek})`, code: 'TRADE_DEADLINE_PASSED' };
    }
    // An admin can't push an approval arbitrarily far past the deadline by
    // picking a later effective week. Deadline week trades are legal and land
    // the following week, so deadline + 1 is the furthest a trade may land.
    if (league && league.tradeDeadlineWeek > 0 && effectiveWeek > league.tradeDeadlineWeek + 1) {
      set.status = 400;
      return {
        error: `Week ${effectiveWeek} is past the trade deadline (Week ${league.tradeDeadlineWeek})`,
        code: 'TRADE_DEADLINE_PASSED',
      };
    }

    const offering = JSON.parse(trade.offering) as string[];
    const requesting = JSON.parse(trade.requesting) as string[];

    // Re-validate at approval time — rosters may have shifted (other accepted trades/FA) since proposal.
    const approveErr = validateProposedTrade({
      proposerId: trade.proposerId,
      recipientId: trade.recipientId,
      offering, requesting,
      pointCap: season?.pointCap ?? 110,
      leagueId: trade.leagueId,
      minRosterSize: league ? (league.minRosterSize ?? league.rosterSize) : undefined,
      maxRosterSize: league ? (league.maxRosterSize ?? league.rosterSize) : undefined,
      excludeTradeId: tradeId,
    });
    if (approveErr) { set.status = 400; return { error: approveErr, code: 'TRADE_INVALID' }; }

    try {
      tx(() => {
        // Only swap now if the trade is effective this week. A future week is
        // recorded with a null appliedAt and left for applyDueTransactions().
        if (!deferred) {
          executeRosterSwap({
            proposerId: trade.proposerId,
            recipientId: trade.recipientId,
            offering,
            requesting,
            week: effectiveWeek,
            leagueId: trade.leagueId,
          });
        }

        db.update(schema.trades).set({
          status: 'accepted',
          resolvedAt: new Date().toISOString(),
          resolvedBy: user.username,
          effectiveWeek,
          appliedAt: deferred ? null : new Date().toISOString(),
        }).where(eq(schema.trades.id, tradeId)).run();

        db.insert(schema.activityLog).values({
          type: 'trade_approved',
          category: 'trade',
          actor: user.username,
          leagueId: trade.leagueId,
          description: deferred
            ? `Approved trade for Week ${effectiveWeek}: ${offering.join(', ')} for ${requesting.join(', ')}`
            : `Approved trade: ${offering.join(', ')} for ${requesting.join(', ')}`,
          metadata: JSON.stringify({ tradeId, proposerId: trade.proposerId, recipientId: trade.recipientId, effectiveWeek, deferred }),
        }).run();
      });
    } catch (e) {
      set.status = 400;
      return { error: (e as Error).message };
    }

    notifyTradeScheduled({
      proposerId: trade.proposerId,
      recipientId: trade.recipientId,
      leagueId: trade.leagueId,
      effectiveWeek,
      applied: !deferred,
    });

    // Best-effort: refresh the PS bot's user→team map so it stays current.
    // Never let this fail the request.
    try { refreshUserMap(); } catch {}

    return { success: true, effectiveWeek, scheduled: deferred };
  })

  .post('/api/trades/:id/reject', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const tradeId = parseInt(params.id);
    const { reason } = (body || {}) as { reason?: string };

    const ctx = loadTradeContext(tradeId);
    if (!ctx) { set.status = 404; return { error: 'Trade not found' }; }
    const { trade } = ctx;
    const archived = checkLeagueArchived(trade.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }
    if (trade.status !== 'pending' && trade.status !== 'awaiting_admin') {
      set.status = 400; return { error: `Trade is ${trade.status}` };
    }

    tx(() => {
      db.update(schema.trades).set({
        status: 'rejected',
        resolvedAt: new Date().toISOString(),
        resolvedBy: user.username,
        rejectReason: reason || null,
      }).where(eq(schema.trades.id, tradeId)).run();

      db.insert(schema.activityLog).values({
        type: 'trade_rejected',
        category: 'trade',
        actor: user.username,
        leagueId: trade.leagueId,
        description: `Rejected trade${reason ? ': ' + reason : ''}`,
        metadata: JSON.stringify({ tradeId, reason }),
      }).run();
    });

    return { success: true };
  })

  // Trade Block Listings (user writes)

  .post('/api/leagues/:leagueId/trade-block', ({ params, query, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

    const team = db.select().from(schema.teams)
      .where(and(eq(schema.teams.leagueId, params.leagueId), eq(schema.teams.userId, parseInt(user.id))))
      .get();

    const { pokemonName, note, teamId: bodyTeamId } =
      body as { pokemonName: string; note?: string; teamId?: string };
    const teamId = (isStaff(user) && bodyTeamId) ? bodyTeamId : team?.id;
    if (!teamId) { set.status = 403; return { error: 'You don\'t have a team in this league' }; }

    if (!pokemonName?.trim()) { set.status = 400; return { error: 'Pokemon name required' }; }

    const result = db.insert(schema.tradeBlockListings).values({
      leagueId: params.leagueId,
      teamId,
      pokemonName: pokemonName.trim(),
      note: note?.trim() || null,
    }).returning().get();

    return { id: result.id };
  })

  .delete('/api/trade-block-listings/:id', ({ params, query, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const listing = db.select().from(schema.tradeBlockListings)
      .where(eq(schema.tradeBlockListings.id, parseInt(params.id)))
      .get();
    if (!listing) { set.status = 404; return { error: 'Listing not found' }; }

    const archived = checkLeagueArchived(listing.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

    if (!isStaff(user)) {
      const team = db.select().from(schema.teams)
        .where(and(eq(schema.teams.id, listing.teamId), eq(schema.teams.userId, parseInt(user.id))))
        .get();
      if (!team) { set.status = 403; return { error: 'Not your listing' }; }
    }

    db.delete(schema.tradeBlockListings).where(eq(schema.tradeBlockListings.id, parseInt(params.id))).run();
    return { success: true };
  })

  // Trade Proposals (user writes)

  .post('/api/leagues/:leagueId/trades/propose', ({ params, query, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

    const team = db.select().from(schema.teams)
      .where(and(eq(schema.teams.leagueId, params.leagueId), eq(schema.teams.userId, parseInt(user.id))))
      .get();

    const { recipientId, offering, requesting, proposerId: bodyProposerId } = body as {
      recipientId: string; offering: string[]; requesting: string[]; proposerId?: string;
    };
    const proposerId = (isStaff(user) && bodyProposerId) ? bodyProposerId : team?.id;
    if (!proposerId) { set.status = 403; return { error: 'You don\'t have a team in this league' }; }

    if (!recipientId) { set.status = 400; return { error: 'Recipient required' }; }
    if (!offering?.length) { set.status = 400; return { error: 'Must offer at least one Pokemon' }; }
    if (!requesting?.length) { set.status = 400; return { error: 'Must request at least one Pokemon' }; }
    if (recipientId === proposerId) { set.status = 400; return { error: 'Cannot trade with yourself' }; }

    // Both teams must belong to the trade's league
    const proposerTeamRow = db.select().from(schema.teams).where(eq(schema.teams.id, proposerId)).get();
    const recipientTeamRow = db.select().from(schema.teams).where(eq(schema.teams.id, recipientId)).get();
    if (!proposerTeamRow || proposerTeamRow.leagueId !== params.leagueId) {
      set.status = 400; return { error: 'Proposer team is not in this league' };
    }
    if (!recipientTeamRow || recipientTeamRow.leagueId !== params.leagueId) {
      set.status = 400; return { error: 'Recipient team is not in this league' };
    }

    const league = getLeague(params.leagueId);
    const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;
    const week = league?.currentWeek || 0;

    // Phase gate: trades can only be proposed during the regular season.
    const phaseErr = regularPhaseError(league);
    if (phaseErr) {
      set.status = 409;
      return { error: phaseErr, code: 'TRADE_WRONG_PHASE', phase: league?.phase };
    }

    if (deadlinePassed(league)) {
      set.status = 400;
      return { error: `Trade deadline has passed (Week ${league!.tradeDeadlineWeek})`, code: 'TRADE_DEADLINE_PASSED' };
    }

    // Roster legality (point cap + mega + dex + roster size)
    const validationErr = validateProposedTrade({
      proposerId, recipientId, offering, requesting,
      pointCap: season?.pointCap ?? 110,
      leagueId: params.leagueId,
      minRosterSize: league ? (league.minRosterSize ?? league.rosterSize) : undefined,
      maxRosterSize: league ? (league.maxRosterSize ?? league.rosterSize) : undefined,
    });
    if (validationErr) { set.status = 400; return { error: validationErr, code: 'TRADE_INVALID' }; }

    const tradeId = tx(() => {
      const result = db.insert(schema.trades).values({
        leagueId: params.leagueId,
        week,
        status: 'pending',
        proposerId,
        recipientId,
        offering: JSON.stringify(offering),
        requesting: JSON.stringify(requesting),
      }).returning().get();

      db.insert(schema.activityLog).values({
        type: 'trade_proposed',
        category: 'trade',
        actor: user.username,
        leagueId: params.leagueId,
        description: `${proposerId} proposed: ${offering.join(', ')} ↔ ${requesting.join(', ')} (${recipientId})`,
        metadata: JSON.stringify({ tradeId: result.id, proposerId, recipientId, offering, requesting }),
      }).run();

      return result.id;
    });

    return { id: String(tradeId) };
  })

  // Withdraw (proposer cancels their own pending trade)

  .post('/api/trades/:id/withdraw', ({ params, query, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const tradeId = parseInt(params.id);
    const ctx = loadTradeContext(tradeId);
    if (!ctx) { set.status = 404; return { error: 'Trade not found' }; }
    const { trade, proposerTeam } = ctx;
    const archived = checkLeagueArchived(trade.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

    if (trade.status !== 'pending' && trade.status !== 'awaiting_admin') {
      set.status = 400; return { error: `Trade is ${trade.status}` };
    }

    // Authorization: proposer manager or staff. (Counterparty has reject;
    // staff has admin reject.)
    const isProposer = proposerTeam.userId != null && proposerTeam.userId === parseInt(user.id);
    if (!isProposer && !isStaff(user)) {
      set.status = 403; return { error: 'Only the proposer can withdraw a trade' };
    }

    return tx(() => {
      db.update(schema.trades).set({
        status: 'rejected',
        resolvedAt: new Date().toISOString(),
        resolvedBy: user.username,
        rejectReason: 'Withdrawn by proposer',
      }).where(eq(schema.trades.id, tradeId)).run();

      db.insert(schema.activityLog).values({
        type: 'trade_withdrawn',
        category: 'trade',
        actor: user.username,
        leagueId: trade.leagueId,
        description: `${user.username} withdrew their trade proposal`,
        metadata: JSON.stringify({ tradeId, proposerId: trade.proposerId, recipientId: trade.recipientId }),
      }).run();

      return { success: true };
    });
  })

  // Counter-proposal
  // Recipient counters with a different offering/requesting payload. The
  // original trade is closed (status='rejected', reason='Countered') and a
  // new trade is created in the *reverse* direction (the original recipient
  // becomes the new proposer).
  .post('/api/trades/:id/counter', ({ params, query, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const tradeId = parseInt(params.id);
    const ctx = loadTradeContext(tradeId);
    if (!ctx) { set.status = 404; return { error: 'Trade not found' }; }
    const { trade, league, season, recipientTeam } = ctx;
    const archived = checkLeagueArchived(trade.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

    if (trade.status !== 'pending') {
      set.status = 400; return { error: `Trade is ${trade.status}; only pending trades can be countered` };
    }

    // Authorization: original recipient manager (or staff override)
    const isOwner = recipientTeam.userId != null && recipientTeam.userId === parseInt(user.id);
    if (!isOwner && !isStaff(user)) { set.status = 403; return { error: 'Not your trade to counter' }; }

    const phaseErr = regularPhaseError(league);
    if (phaseErr) {
      set.status = 409;
      return { error: phaseErr, code: 'TRADE_WRONG_PHASE', phase: league?.phase };
    }
    if (deadlinePassed(league)) {
      set.status = 400;
      return { error: `Trade deadline has passed (Week ${league!.tradeDeadlineWeek})`, code: 'TRADE_DEADLINE_PASSED' };
    }

    // Counter payload: from the *new proposer* (= original recipient) → original proposer.
    const { offering, requesting } = body as { offering: string[]; requesting: string[] };
    if (!Array.isArray(offering) || !offering.length) { set.status = 400; return { error: 'Counter must offer at least one Pokemon' }; }
    if (!Array.isArray(requesting) || !requesting.length) { set.status = 400; return { error: 'Counter must request at least one Pokemon' }; }

    const newProposerId = trade.recipientId;
    const newRecipientId = trade.proposerId;

    const validationErr = validateProposedTrade({
      proposerId: newProposerId,
      recipientId: newRecipientId,
      offering,
      requesting,
      pointCap: season?.pointCap ?? 110,
      leagueId: trade.leagueId,
      minRosterSize: league ? (league.minRosterSize ?? league.rosterSize) : undefined,
      maxRosterSize: league ? (league.maxRosterSize ?? league.rosterSize) : undefined,
    });
    if (validationErr) { set.status = 400; return { error: validationErr, code: 'TRADE_INVALID' }; }

    const newTradeId = tx(() => {
      // Close the original
      db.update(schema.trades).set({
        status: 'rejected',
        resolvedAt: new Date().toISOString(),
        resolvedBy: user.username,
        rejectReason: 'Countered',
      }).where(eq(schema.trades.id, tradeId)).run();

      // Insert the counter
      const inserted = db.insert(schema.trades).values({
        leagueId: trade.leagueId,
        week: league?.currentWeek || trade.week,
        status: 'pending',
        proposerId: newProposerId,
        recipientId: newRecipientId,
        offering: JSON.stringify(offering),
        requesting: JSON.stringify(requesting),
      }).returning().get();

      db.insert(schema.activityLog).values({
        type: 'trade_countered',
        category: 'trade',
        actor: user.username,
        leagueId: trade.leagueId,
        description: `${user.username} countered trade #${tradeId} → new trade #${inserted.id}`,
        metadata: JSON.stringify({
          originalTradeId: tradeId,
          counterTradeId: inserted.id,
          newProposerId, newRecipientId,
          offering, requesting,
        }),
      }).run();

      return inserted.id;
    });

    return { id: String(newTradeId), originalId: String(tradeId) };
  });
