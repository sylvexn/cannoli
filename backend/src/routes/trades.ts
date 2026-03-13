import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, desc } from 'drizzle-orm';
import { isStaff } from '../lib/auth';
import { tx } from '../lib/tx';

function loadTradeContext(tradeId: number) {
  const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
  if (!trade) return null;
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, trade.leagueId)).get();
  const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;
  return { trade, league, season };
}

function deadlinePassed(season: { tradeDeadlineWeek: number; currentWeek: number } | null | undefined): boolean {
  if (!season) return false;
  if (season.tradeDeadlineWeek <= 0) return false;
  return season.currentWeek >= season.tradeDeadlineWeek;
}

/** Move pokemon between two team rosters atomically. Caller must already be inside tx(). */
function executeRosterSwap(opts: {
  proposerId: string;
  recipientId: string;
  offering: string[];   // proposer → recipient
  requesting: string[]; // recipient → proposer
  week: number;
  leagueId: string;
}) {
  const { proposerId, recipientId, offering, requesting, week, leagueId } = opts;

  for (const name of offering) {
    const row = db.select().from(schema.rosters)
      .where(and(eq(schema.rosters.teamId, proposerId), eq(schema.rosters.pokemonName, name)))
      .get();
    if (!row) throw new Error(`Trade invalid: ${proposerId} no longer has ${name}`);
    db.update(schema.rosters).set({
      teamId: recipientId,
      acquiredVia: 'trade',
      acquiredWeek: week,
      // Tera captain status doesn't transfer; the recipient must redesignate
      isTeraCaptain: false,
      teraType1: null, teraType2: null, teraType3: null,
    }).where(eq(schema.rosters.id, row.id)).run();
  }
  for (const name of requesting) {
    const row = db.select().from(schema.rosters)
      .where(and(eq(schema.rosters.teamId, recipientId), eq(schema.rosters.pokemonName, name)))
      .get();
    if (!row) throw new Error(`Trade invalid: ${recipientId} no longer has ${name}`);
    db.update(schema.rosters).set({
      teamId: proposerId,
      acquiredVia: 'trade',
      acquiredWeek: week,
      isTeraCaptain: false,
      teraType1: null, teraType2: null, teraType3: null,
    }).where(eq(schema.rosters.id, row.id)).run();
  }

  // One transaction row per Pokemon for record-keeping
  for (const name of offering) {
    const poke = db.select().from(schema.pokemon).where(eq(schema.pokemon.name, name)).get();
    db.insert(schema.transactions).values({
      leagueId, week, type: 'trade',
      teamId: proposerId, otherTeamId: recipientId,
      pokemonOut: name, pointsOut: poke?.tier ?? null,
    }).run();
  }
  for (const name of requesting) {
    const poke = db.select().from(schema.pokemon).where(eq(schema.pokemon.name, name)).get();
    db.insert(schema.transactions).values({
      leagueId, week, type: 'trade',
      teamId: recipientId, otherTeamId: proposerId,
      pokemonOut: name, pointsOut: poke?.tier ?? null,
    }).run();
  }
}

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

  // ─── Counterparty respond (accept → awaiting_admin, reject → rejected) ─

  .post('/api/trades/:id/respond', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const tradeId = parseInt(params.id);
    const ctx = loadTradeContext(tradeId);
    if (!ctx) { set.status = 404; return { error: 'Trade not found' }; }
    const { trade, season } = ctx;
    if (trade.status !== 'pending') { set.status = 400; return { error: 'Trade is not pending' }; }

    const { action, reason } = body as { action: 'accept' | 'reject'; reason?: string };
    if (action !== 'accept' && action !== 'reject') { set.status = 400; return { error: 'action must be accept or reject' }; }

    // Authorization: counterparty manager (owner of recipient team) or staff
    const recipientTeam = db.select().from(schema.teams).where(eq(schema.teams.id, trade.recipientId)).get();
    const isOwner = recipientTeam?.userId != null && recipientTeam.userId === parseInt(user.id);
    if (!isOwner && !isStaff(user)) { set.status = 403; return { error: 'Not your trade to respond to' }; }

    if (action === 'accept' && deadlinePassed(season)) {
      set.status = 400;
      return { error: `Trade deadline has passed (Week ${season!.tradeDeadlineWeek})`, code: 'TRADE_DEADLINE_PASSED' };
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

  // ─── Trade Approve/Reject (admin) ──────────────────────────────

  .post('/api/trades/:id/approve', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const tradeId = parseInt(params.id);
    const ctx = loadTradeContext(tradeId);
    if (!ctx) { set.status = 404; return { error: 'Trade not found' }; }
    const { trade, season } = ctx;
    if (trade.status !== 'pending' && trade.status !== 'awaiting_admin') {
      set.status = 400; return { error: `Trade is ${trade.status}` };
    }

    if (deadlinePassed(season)) {
      set.status = 400;
      return { error: `Trade deadline has passed (Week ${season!.tradeDeadlineWeek})`, code: 'TRADE_DEADLINE_PASSED' };
    }

    const offering = JSON.parse(trade.offering) as string[];
    const requesting = JSON.parse(trade.requesting) as string[];

    try {
      tx(() => {
        executeRosterSwap({
          proposerId: trade.proposerId,
          recipientId: trade.recipientId,
          offering,
          requesting,
          week: season?.currentWeek ?? trade.week,
          leagueId: trade.leagueId,
        });

        db.update(schema.trades).set({
          status: 'accepted',
          resolvedAt: new Date().toISOString(),
          resolvedBy: user.username,
        }).where(eq(schema.trades.id, tradeId)).run();

        db.insert(schema.activityLog).values({
          type: 'trade_approved',
          category: 'trade',
          actor: user.username,
          leagueId: trade.leagueId,
          description: `Approved trade: ${offering.join(', ')} for ${requesting.join(', ')}`,
          metadata: JSON.stringify({ tradeId, proposerId: trade.proposerId, recipientId: trade.recipientId }),
        }).run();
      });
    } catch (e) {
      set.status = 400;
      return { error: (e as Error).message };
    }

    return { success: true };
  })

  .post('/api/trades/:id/reject', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const tradeId = parseInt(params.id);
    const { reason } = (body || {}) as { reason?: string };

    const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
    if (!trade) { set.status = 404; return { error: 'Trade not found' }; }
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

    if (deadlinePassed(season)) {
      set.status = 400;
      return { error: `Trade deadline has passed (Week ${season!.tradeDeadlineWeek})`, code: 'TRADE_DEADLINE_PASSED' };
    }

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
  });
