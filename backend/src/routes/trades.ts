import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, desc } from 'drizzle-orm';
import { isStaff } from '../lib/auth';

export const tradeRoutes = new Elysia()

  // ─── Trade Reads ───────────────────────────────────────────────────

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
      }));
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

  // ─── Trade Approve/Reject (dev only) ──────────────────────────────

  .post('/api/trades/:id/approve', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const tradeId = parseInt(params.id);
    const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
    if (!trade) { set.status = 404; return { error: 'Trade not found' }; }
    if (trade.status !== 'pending') { set.status = 400; return { error: 'Trade is not pending' }; }

    db.update(schema.trades).set({
      status: 'accepted',
      resolvedAt: new Date().toISOString(),
      resolvedBy: user.username,
    }).where(eq(schema.trades.id, tradeId)).run();

    const offering = JSON.parse(trade.offering) as string[];
    const requesting = JSON.parse(trade.requesting) as string[];

    db.insert(schema.transactions).values({
      leagueId: trade.leagueId,
      week: trade.week,
      type: 'trade',
      teamId: trade.proposerId,
      otherTeamId: trade.recipientId,
      pokemonOut: offering[0] || null,
      pokemonIn: requesting[0] || null,
    }).run();

    // Log activity
    db.insert(schema.activityLog).values({
      type: 'trade_approved',
      category: 'trade',
      actor: user.username,
      leagueId: trade.leagueId,
      description: `Approved trade: ${offering.join(', ')} for ${requesting.join(', ')}`,
      metadata: JSON.stringify({ tradeId, proposerId: trade.proposerId, recipientId: trade.recipientId }),
    }).run();

    return { success: true };
  })

  .post('/api/trades/:id/reject', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const tradeId = parseInt(params.id);
    const { reason } = (body || {}) as { reason?: string };

    const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
    if (!trade) { set.status = 404; return { error: 'Trade not found' }; }
    if (trade.status !== 'pending') { set.status = 400; return { error: 'Trade is not pending' }; }

    db.update(schema.trades).set({
      status: 'rejected',
      resolvedAt: new Date().toISOString(),
      resolvedBy: user.username,
      rejectReason: reason || null,
    }).where(eq(schema.trades.id, tradeId)).run();

    return { success: true };
  })

  // ─── Trade Block Listings (user writes) ────────────────────────────

  .post('/api/leagues/:leagueId/trade-block', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const team = db.select().from(schema.teams)
      .where(and(eq(schema.teams.leagueId, params.leagueId), eq(schema.teams.userId, parseInt(user.id))))
      .get();

    const teamId = (isStaff(user) && (body as any).teamId) ? (body as any).teamId : team?.id;
    if (!teamId) { set.status = 403; return { error: 'You don\'t have a team in this league' }; }

    const { pokemonName, note } = body as { pokemonName: string; note?: string };
    if (!pokemonName?.trim()) { set.status = 400; return { error: 'Pokemon name required' }; }

    const result = db.insert(schema.tradeBlockListings).values({
      leagueId: params.leagueId,
      teamId,
      pokemonName: pokemonName.trim(),
      note: note?.trim() || null,
    }).returning().get();

    return { id: result.id };
  })

  .delete('/api/trade-block-listings/:id', ({ params, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const listing = db.select().from(schema.tradeBlockListings)
      .where(eq(schema.tradeBlockListings.id, parseInt(params.id)))
      .get();
    if (!listing) { set.status = 404; return { error: 'Listing not found' }; }

    if (!isStaff(user)) {
      const team = db.select().from(schema.teams)
        .where(and(eq(schema.teams.id, listing.teamId), eq(schema.teams.userId, parseInt(user.id))))
        .get();
      if (!team) { set.status = 403; return { error: 'Not your listing' }; }
    }

    db.delete(schema.tradeBlockListings).where(eq(schema.tradeBlockListings.id, parseInt(params.id))).run();
    return { success: true };
  })

  // ─── Trade Proposals (user writes) ─────────────────────────────────

  .post('/api/leagues/:leagueId/trades/propose', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const team = db.select().from(schema.teams)
      .where(and(eq(schema.teams.leagueId, params.leagueId), eq(schema.teams.userId, parseInt(user.id))))
      .get();

    const proposerId = (isStaff(user) && (body as any).proposerId) ? (body as any).proposerId : team?.id;
    if (!proposerId) { set.status = 403; return { error: 'You don\'t have a team in this league' }; }

    const { recipientId, offering, requesting } = body as {
      recipientId: string; offering: string[]; requesting: string[];
    };

    if (!recipientId) { set.status = 400; return { error: 'Recipient required' }; }
    if (!offering?.length) { set.status = 400; return { error: 'Must offer at least one Pokemon' }; }
    if (!requesting?.length) { set.status = 400; return { error: 'Must request at least one Pokemon' }; }

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;
    const week = season?.currentWeek || 0;

    // Enforce trade deadline
    if (season && season.tradeDeadlineWeek > 0 && week > season.tradeDeadlineWeek) {
      set.status = 400;
      return { error: `Trade deadline has passed (Week ${season.tradeDeadlineWeek})` };
    }

    const result = db.insert(schema.trades).values({
      leagueId: params.leagueId,
      week,
      status: 'pending',
      proposerId,
      recipientId,
      offering: JSON.stringify(offering),
      requesting: JSON.stringify(requesting),
    }).returning().get();

    return { id: String(result.id) };
  });
