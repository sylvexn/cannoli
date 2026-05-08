import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, and, sql, desc } from 'drizzle-orm';
import { isStaff } from '../../lib/auth';
import { tx } from '../../lib/tx';
import { generateLeagueSchedule } from '../../lib/schedule-generator';
import { runAutoAwards } from '../../lib/pins/auto-award';
import { checkLeagueArchived } from '../../lib/archive-guard';

export const leagueAdminRoutes = new Elysia()

  // ─── Leagues CRUD ───────────────────────────────────────────────────

  .post('/api/leagues', ({ body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { name, color } = body as { name: string; color: string };
    if (!name?.trim()) { set.status = 400; return { error: 'Name required' }; }

    const id = name.trim().toLowerCase().replace(/\s+league$/i, '').replace(/\s+/g, '-');
    const season = db.select().from(schema.seasons).orderBy(desc(schema.seasons.seasonNumber)).get();
    if (!season) { set.status = 400; return { error: 'No active season' }; }

    db.insert(schema.leagues).values({ id, name: name.trim(), color: color || '#888888', seasonId: season.id }).run();
    return { id };
  })

  .put('/api/leagues/:leagueId', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const {
      name, color, draftDate, pointCap, teraCaptainSlots, tradeDeadlineWeek,
      weekDates, maxTeams: _maxTeams, rosterSize, paused, forfeitPolicy,
      playoffTeamCount,
    } = body as Record<string, unknown>;

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    // Archived seasons are read-only by default. Writes to a league belonging
    // to an archived season require ?force=1 (mirrors the schedule-regen and
    // delete-league guards).
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

    const leagueUpdates: Record<string, unknown> = {};
    if (name) leagueUpdates.name = name;
    if (color) leagueUpdates.color = color;
    if (draftDate !== undefined) leagueUpdates.draftDate = draftDate;
    if (tradeDeadlineWeek !== undefined) leagueUpdates.tradeDeadlineWeek = tradeDeadlineWeek;
    if (weekDates !== undefined) leagueUpdates.weekDates = typeof weekDates === 'string' ? weekDates : JSON.stringify(weekDates);
    if (paused !== undefined) leagueUpdates.paused = !!paused;
    if (forfeitPolicy !== undefined) leagueUpdates.forfeitPolicy = forfeitPolicy;
    if (playoffTeamCount !== undefined) {
      const n = Number(playoffTeamCount);
      if (![2, 4, 6, 8].includes(n)) {
        set.status = 400; return { error: 'playoffTeamCount must be one of 2, 4, 6, 8' };
      }
      // Lock once the bracket has been generated (any playoff matches exist),
      // otherwise editing here silently desyncs from the actual bracket.
      const playoffMatches = db.select({ c: sql<number>`COUNT(*)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.leagueId, params.leagueId), eq(schema.matches.phase, 'playoffs')))
        .get()?.c ?? 0;
      if (playoffMatches > 0) {
        set.status = 400;
        return { error: 'Cannot change bracket size after playoffs have been generated', code: 'playoffs_locked' };
      }
      leagueUpdates.playoffTeamCount = n;
    }

    // Phase-aware locks (phase now lives on the league row)
    const draftStarted = !!db.select().from(schema.draftState)
      .where(and(eq(schema.draftState.leagueId, params.leagueId), sql`current_pick_index > 0`)).get();
    if (pointCap !== undefined && draftStarted) {
      set.status = 400; return { error: 'Cannot change point cap once draft has begun' };
    }
    if (teraCaptainSlots !== undefined && league.phase !== 'predraft' && league.phase !== 'draft') {
      set.status = 400; return { error: `Cannot change tera captain slots in ${league.phase} phase` };
    }
    // rosterSize must be locked once any picks have been made — would invalidate
    // the snake order. Editable until draft starts.
    if (rosterSize !== undefined) {
      if (draftStarted || (league.phase !== 'predraft' && league.phase !== 'draft')) {
        set.status = 400;
        return { error: `Cannot change roster size once draft has started (phase: ${league.phase})` };
      }
      const n = Number(rosterSize);
      if (!Number.isInteger(n) || n < 2 || n > 20) {
        set.status = 400;
        return { error: 'rosterSize must be an integer between 2 and 20' };
      }
      leagueUpdates.rosterSize = n;
    }

    // pointCap and teraCaptainSlots remain season-wide settings.
    const seasonUpdates: Record<string, unknown> = {};
    if (pointCap !== undefined) seasonUpdates.pointCap = pointCap;
    if (teraCaptainSlots !== undefined) seasonUpdates.teraCaptainSlots = teraCaptainSlots;

    tx(() => {
      if (Object.keys(leagueUpdates).length > 0) {
        db.update(schema.leagues).set(leagueUpdates).where(eq(schema.leagues.id, params.leagueId)).run();
      }
      if (Object.keys(seasonUpdates).length > 0) {
        db.update(schema.seasons).set(seasonUpdates).where(eq(schema.seasons.id, league.seasonId)).run();
      }
      if (Object.keys(leagueUpdates).length > 0 || Object.keys(seasonUpdates).length > 0) {
        db.insert(schema.activityLog).values({
          type: 'league_config_updated',
          category: 'config',
          actor: user.username,
          leagueId: params.leagueId,
          description: `Updated config for ${league.name}`,
          metadata: JSON.stringify({ leagueUpdates, seasonUpdates }),
        }).run();
      }
    });

    return { success: true };
  })

  .delete('/api/leagues/:leagueId', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

    // Phase-aware destructive guard. A league mid-regular-season or in-playoffs
    // has live trades, match results, standings — silent deletion would wipe
    // all of that. Require ?force=1 + a typed-name confirm body, mirroring the
    // schedule-regen pattern.
    const force = query.force === '1' || query.force === 'true';
    const isLive = league.phase === 'regular' || league.phase === 'playoffs';
    if (isLive) {
      const confirmName = (body as Record<string, unknown> | null)?.confirmName;
      if (!force) {
        set.status = 409;
        return {
          error: `League is in ${league.phase} phase — pass ?force=1 and { confirmName: "${league.name}" } to delete`,
          code: 'league_active',
          phase: league.phase,
        };
      }
      if (typeof confirmName !== 'string' || confirmName.trim() !== league.name) {
        set.status = 409;
        return {
          error: `Force-delete requires confirmName to exactly match league name "${league.name}"`,
          code: 'league_confirm_required',
          phase: league.phase,
        };
      }
    }

    tx(() => {
      const teamIds = db.select({ id: schema.teams.id }).from(schema.teams)
        .where(eq(schema.teams.leagueId, params.leagueId)).all().map(t => t.id);

      for (const tid of teamIds) {
        db.delete(schema.rosters).where(eq(schema.rosters.teamId, tid)).run();
        db.delete(schema.matchPokemon).where(eq(schema.matchPokemon.teamId, tid)).run();
        db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.teamId, tid)).run();
        db.delete(schema.playerAvailability).where(eq(schema.playerAvailability.teamId, tid)).run();
      }
      db.delete(schema.draftState).where(eq(schema.draftState.leagueId, params.leagueId)).run();
      db.delete(schema.draftPicks).where(eq(schema.draftPicks.leagueId, params.leagueId)).run();
      db.delete(schema.matches).where(eq(schema.matches.leagueId, params.leagueId)).run();
      db.delete(schema.transactions).where(eq(schema.transactions.leagueId, params.leagueId)).run();
      db.delete(schema.trades).where(eq(schema.trades.leagueId, params.leagueId)).run();
      db.delete(schema.tradeBlockListings).where(eq(schema.tradeBlockListings.leagueId, params.leagueId)).run();
      db.delete(schema.teams).where(eq(schema.teams.leagueId, params.leagueId)).run();
      db.delete(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).run();

      db.insert(schema.activityLog).values({
        type: 'league_deleted',
        category: 'admin',
        actor: user.username,
        leagueId: null,
        description: isLive
          ? `FORCE-DELETED league ${league.name} (phase: ${league.phase})`
          : `Deleted league ${league.name}`,
        metadata: JSON.stringify({ leagueId: params.leagueId, phase: league.phase, forced: isLive }),
      }).run();
    });

    return { success: true };
  })

  // ─── Season Management ──────────────────────────────────────────────

  .post('/api/leagues/:leagueId/phase', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { phase, override, confirm } = body as { phase: string; override?: boolean; confirm?: string };
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

    // Phase now lives on the league — advancing one league no longer drags
    // the others in the same season along with it.
    const previousPhase = league.phase;

    // ─── Monotonic guard ─────────────────────────────────────────────────
    // Forward transitions (predraft → draft → regular → playoffs → offseason)
    // are one-click. Backward transitions are destructive (e.g. playoffs → regular
    // re-opens trade/FA gates, demotes brackets to draft state, etc.) so they
    // must be explicitly acknowledged with `{ override: true, confirm: 'I understand' }`.
    const phaseRank: Record<string, number> = {
      predraft: 0, draft: 1, regular: 2, playoffs: 3, offseason: 4,
    };
    const fromRank = phaseRank[previousPhase] ?? -1;
    const toRank = phaseRank[phase] ?? -1;
    if (toRank < fromRank && previousPhase !== phase) {
      if (!override || confirm !== 'I understand') {
        set.status = 409;
        return {
          error: `Backward phase transition (${previousPhase} → ${phase}) requires explicit override`,
          code: 'phase_backward_requires_override',
          from: previousPhase,
          to: phase,
        };
      }
    }

    // ─── Phase transition preconditions ────────────────────────────────
    const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, params.leagueId)).all();
    const draftState = db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, params.leagueId)).get();

    if (phase === 'draft') {
      const order: string[] = league.draftOrder ? JSON.parse(league.draftOrder) : [];
      if (order.length === 0) { set.status = 400; return { error: 'Cannot start draft: draft order not set' }; }
      if (order.length !== teams.length) {
        set.status = 400; return { error: `Draft order has ${order.length} teams but league has ${teams.length}` };
      }
      const teamIdSet = new Set(teams.map(t => t.id));
      const seen = new Set<string>();
      for (const tid of order) {
        if (!teamIdSet.has(tid)) { set.status = 400; return { error: `Draft order contains unknown team ${tid}` }; }
        if (seen.has(tid)) { set.status = 400; return { error: `Draft order has duplicate team ${tid}` }; }
        seen.add(tid);
      }
      if (draftState && draftState.status === 'in_progress') {
        set.status = 400; return { error: 'Draft already in progress' };
      }
    }

    if (phase === 'regular' && previousPhase === 'draft') {
      if (!draftState || draftState.status !== 'completed') {
        if (!override) {
          set.status = 400; return { error: 'Draft is not complete', code: 'DRAFT_NOT_COMPLETE' };
        }
      }
    }

    if (phase === 'playoffs') {
      const incomplete = db.select({ count: sql<number>`COUNT(*)` })
        .from(schema.matches)
        .where(and(
          eq(schema.matches.leagueId, params.leagueId),
          eq(schema.matches.phase, 'regular'),
          sql`(home_score IS NULL OR away_score IS NULL OR status = 'disputed')`,
        )).get()?.count ?? 0;
      if (incomplete > 0 && !override) {
        set.status = 400;
        return { error: `${incomplete} regular-season matches still missing scores or disputed`, code: 'REGULAR_INCOMPLETE' };
      }
    }

    let scheduleGenerated = false;
    let pinsAwarded = 0;
    tx(() => {
      const leagueUpdates: Record<string, unknown> = { phase: phase as any };
      if (phase === 'regular' && previousPhase !== 'regular') {
        leagueUpdates.currentWeek = 1;
      }
      db.update(schema.leagues).set(leagueUpdates).where(eq(schema.leagues.id, params.leagueId)).run();

      // Auto-generate schedule when advancing from draft → regular
      if (previousPhase === 'draft' && phase === 'regular') {
        const result = generateLeagueSchedule(params.leagueId);
        scheduleGenerated = result.success;
      }

      // Season finalization → run auto-award pass (idempotent).
      // We treat any *transition into* offseason as the trigger, even from
      // playoffs→offseason that's the normal path or regular→offseason for
      // leagues that skip playoffs. Re-runs from another phase change won't
      // dupe.
      if (phase === 'offseason' && previousPhase !== 'offseason') {
        const summary = runAutoAwards(params.leagueId, {
          trigger: 'season-end',
          awardedBy: user.id ? parseInt(user.id) : null,
        });
        pinsAwarded = summary.awarded.length;
      }

      const isBackward = toRank < fromRank;
      db.insert(schema.activityLog).values({
        type: isBackward ? 'phase_reverted' : 'phase_advanced',
        category: 'config',
        actor: user.username,
        leagueId: params.leagueId,
        description: isBackward
          ? `REVERTED phase: ${previousPhase} → ${phase} (override)`
          : `Phase: ${previousPhase} → ${phase}${override ? ' (override)' : ''}`,
        metadata: JSON.stringify({ from: previousPhase, to: phase, override: !!override, backward: isBackward, scheduleGenerated, pinsAwarded }),
      }).run();
    });

    return { success: true, scheduleGenerated, pinsAwarded };
  })

  .post('/api/leagues/:leagueId/week', ({ params, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

    const newWeek = league.currentWeek + 1;
    tx(() => {
      db.update(schema.leagues).set({ currentWeek: newWeek }).where(eq(schema.leagues.id, params.leagueId)).run();
      db.insert(schema.activityLog).values({
        type: 'week_advanced',
        category: 'config',
        actor: user.username,
        leagueId: params.leagueId,
        description: `Week ${league.currentWeek} → ${newWeek}`,
        metadata: JSON.stringify({ from: league.currentWeek, to: newWeek }),
      }).run();
    });
    return { success: true, week: newWeek };
  })

  .post('/api/leagues/:leagueId/draft-order', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { order } = body as { order: string[] };

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }
    // Lock once we're past draft phase
    if (league.phase !== 'predraft' && league.phase !== 'draft') {
      set.status = 400; return { error: `Cannot change draft order in ${league.phase} phase` };
    }
    // Lock once the draft has begun (any picks made)
    const draftState = db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, params.leagueId)).get();
    if (draftState && draftState.currentPickIndex > 0) {
      set.status = 400; return { error: 'Cannot change draft order once picks have been made' };
    }

    tx(() => {
      db.update(schema.leagues).set({ draftOrder: JSON.stringify(order) }).where(eq(schema.leagues.id, params.leagueId)).run();
      db.insert(schema.activityLog).values({
        type: 'draft_order_set',
        category: 'config',
        actor: user.username,
        leagueId: params.leagueId,
        description: `Set draft order (${order.length} teams)`,
        metadata: JSON.stringify({ order }),
      }).run();
    });
    return { success: true };
  })

;
