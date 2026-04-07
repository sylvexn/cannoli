import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { isStaff } from '../lib/auth';
import { tx } from '../lib/tx';

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

/**
 * Validate that a proposed trade would leave both rosters legal:
 *   - point cap not exceeded (using costAtDraft, captain markup not modeled
 *     because tera captain status is cleared on transfer)
 *   - max 1 mega per team
 *   - no duplicate national-dex on either team
 *   - roster size invariant: each team's post-trade roster size must equal
 *     pre-trade size (= league.rosterSize). Asymmetric trades not supported.
 *
 * Returns null if valid, or an error message string.
 */
function validateProposedTrade(opts: {
  proposerId: string;
  recipientId: string;
  offering: string[];
  requesting: string[];
  pointCap: number;
}): string | null {
  const { proposerId, recipientId, offering, requesting, pointCap } = opts;

  if (offering.length === 0) return 'Must offer at least one Pokemon';
  if (requesting.length === 0) return 'Must request at least one Pokemon';

  // Roster-size invariant: trades must swap equal counts so neither team
  // ends up below (or above) league.rosterSize. Asymmetric trades aren't
  // supported — they'd leave the loser's roster short come matchday.
  if (offering.length !== requesting.length) {
    return `Trade must offer and request the same number of Pokemon (offered ${offering.length}, requested ${requesting.length})`;
  }

  // Pull rosters
  const proposerRoster = db.select().from(schema.rosters).where(eq(schema.rosters.teamId, proposerId)).all();
  const recipientRoster = db.select().from(schema.rosters).where(eq(schema.rosters.teamId, recipientId)).all();

  // Verify ownership
  for (const name of offering) {
    if (!proposerRoster.some(r => r.pokemonName === name)) {
      return `Proposer no longer has ${name}`;
    }
  }
  for (const name of requesting) {
    if (!recipientRoster.some(r => r.pokemonName === name)) {
      return `Recipient no longer has ${name}`;
    }
  }

  // Pull pokemon metadata for offered + requested + every roster mon (for natdex/mega)
  const allNames = new Set<string>([
    ...proposerRoster.map(r => r.pokemonName),
    ...recipientRoster.map(r => r.pokemonName),
  ]);
  const pokemonRows = db.select().from(schema.pokemon).where(inArray(schema.pokemon.name, [...allNames])).all();
  const pokeByName = new Map(pokemonRows.map(p => [p.name, p]));

  // Build post-trade rosters
  const postProposer = [
    ...proposerRoster.filter(r => !offering.includes(r.pokemonName)),
    ...recipientRoster.filter(r => requesting.includes(r.pokemonName)),
  ];
  const postRecipient = [
    ...recipientRoster.filter(r => !requesting.includes(r.pokemonName)),
    ...proposerRoster.filter(r => offering.includes(r.pokemonName)),
  ];

  for (const [side, roster] of [['Proposer', postProposer], ['Recipient', postRecipient]] as const) {
    // Point cap (use costAtDraft as the canonical points; captain markup cleared on transfer)
    const total = roster.reduce((s, r) => s + (r.costAtDraft || r.tier || 0), 0);
    if (total > pointCap) {
      return `${side} would exceed point cap (${total} > ${pointCap})`;
    }

    // Mega cap
    let megaCount = 0;
    for (const r of roster) {
      const p = pokeByName.get(r.pokemonName);
      if (p?.formCategory === 'mega') megaCount++;
    }
    if (megaCount > 1) {
      return `${side} would have ${megaCount} megas (max 1)`;
    }

    // Duplicate national dex
    const dexSeen = new Map<number, string>();
    for (const r of roster) {
      const p = pokeByName.get(r.pokemonName);
      if (p?.nationalDexNumber == null) continue;
      const prev = dexSeen.get(p.nationalDexNumber);
      if (prev) {
        return `${side} would have duplicate dex#${p.nationalDexNumber} (${prev} + ${r.pokemonName})`;
      }
      dexSeen.set(p.nationalDexNumber, r.pokemonName);
    }
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
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, trade.leagueId)).get();
  const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;
  return { trade, league, season, proposerTeam, recipientTeam };
}

/** Deadline check now scopes to the league's own currentWeek + tradeDeadlineWeek. */
function deadlinePassed(league: { tradeDeadlineWeek: number; currentWeek: number } | null | undefined): boolean {
  if (!league) return false;
  if (league.tradeDeadlineWeek <= 0) return false;
  return league.currentWeek >= league.tradeDeadlineWeek;
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

  // Drop any trade-block listings on EITHER side for any mon that just
  // changed hands — the previous owner no longer has it, so the listing is
  // stale; the new owner may re-list if they want. Same league only.
  const allMoved = [...offering, ...requesting];
  if (allMoved.length > 0) {
    db.delete(schema.tradeBlockListings)
      .where(and(
        eq(schema.tradeBlockListings.leagueId, leagueId),
        inArray(schema.tradeBlockListings.pokemonName, allMoved),
      ))
      .run();
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
    const { trade, league, recipientTeam } = ctx;
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
    const { trade, league, season } = ctx;
    if (trade.status !== 'pending' && trade.status !== 'awaiting_admin') {
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

    const offering = JSON.parse(trade.offering) as string[];
    const requesting = JSON.parse(trade.requesting) as string[];

    // Re-validate at approval time — rosters may have shifted (other accepted trades/FA) since proposal.
    const approveErr = validateProposedTrade({
      proposerId: trade.proposerId,
      recipientId: trade.recipientId,
      offering, requesting,
      pointCap: season?.pointCap ?? 110,
    });
    if (approveErr) { set.status = 400; return { error: approveErr, code: 'TRADE_INVALID' }; }

    try {
      tx(() => {
        executeRosterSwap({
          proposerId: trade.proposerId,
          recipientId: trade.recipientId,
          offering,
          requesting,
          week: league?.currentWeek ?? trade.week,
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

    const ctx = loadTradeContext(tradeId);
    if (!ctx) { set.status = 404; return { error: 'Trade not found' }; }
    const { trade } = ctx;
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

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
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

    // Roster legality (point cap + mega + dex)
    const validationErr = validateProposedTrade({
      proposerId, recipientId, offering, requesting,
      pointCap: season?.pointCap ?? 110,
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

  // ─── Withdraw (proposer cancels their own pending trade) ───────────────

  .post('/api/trades/:id/withdraw', ({ params, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const tradeId = parseInt(params.id);
    const ctx = loadTradeContext(tradeId);
    if (!ctx) { set.status = 404; return { error: 'Trade not found' }; }
    const { trade, proposerTeam } = ctx;

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

  // ─── Counter-proposal ─────────────────────────────────────────────────
  // Recipient counters with a different offering/requesting payload. The
  // original trade is closed (status='rejected', reason='Countered') and a
  // new trade is created in the *reverse* direction (the original recipient
  // becomes the new proposer).
  .post('/api/trades/:id/counter', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const tradeId = parseInt(params.id);
    const ctx = loadTradeContext(tradeId);
    if (!ctx) { set.status = 404; return { error: 'Trade not found' }; }
    const { trade, league, season, recipientTeam } = ctx;

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
