import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, sql, asc, desc } from 'drizzle-orm';
import { generateLeagueSchedule } from '../lib/schedule-generator';
import { isStaff } from '../lib/auth';
import { tx } from '../lib/tx';
import { advancePlayoffWinner } from '../lib/playoff-advance';
import { computeStandings } from '../lib/standings';
import { runAutoAwards } from '../lib/pins/auto-award';
import { getLeague } from '../lib/queries';
import { validatePokemonDataForMatch } from '../lib/match-validation';

export const matchRoutes = new Elysia()

  // ─── Replay summary (MVP / sweep / teras / score line) ──────────────
  //
  // Cheap computation from matchPokemon (already has per-mon K/D + tera) plus
  // the match row's scores. No log parsing required — this is what powers the
  // replay-row glance line and post-roll mini-card on the stream cockpit.

  .get('/api/matches/:matchId/replay-summary', ({ params }) => {
    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId))
      .get();
    if (!match) return null;

    const entries = db.select().from(schema.matchPokemon)
      .where(eq(schema.matchPokemon.matchId, params.matchId))
      .all();

    const homeMons = entries.filter(e => e.teamId === match.homeTeamId);
    const awayMons = entries.filter(e => e.teamId === match.awayTeamId);

    // MVP — top kill-getter across both teams, ties broken by lower deaths
    const allMons = [...homeMons, ...awayMons];
    const mvpEntry = allMons.length > 0
      ? allMons.reduce((best, m) => {
          if (m.kills > best.kills) return m;
          if (m.kills === best.kills && m.deaths < best.deaths) return m;
          return best;
        })
      : null;
    const mvp = mvpEntry ? {
      name: mvpEntry.pokemonName,
      kills: mvpEntry.kills,
      deaths: mvpEntry.deaths,
      teamId: mvpEntry.teamId,
    } : null;

    const homeScore = match.homeScore ?? 0;
    const awayScore = match.awayScore ?? 0;
    const isComplete = match.homeScore != null && match.awayScore != null;

    const teraCount = entries.filter(e => e.teraUsed).length;
    const sweep = isComplete && (
      (homeScore === 6 && awayScore === 0) ||
      (awayScore === 6 && homeScore === 0)
    );

    return {
      matchId: match.id,
      isComplete,
      mvp,
      teraCount,
      sweep,
      // Margin of victory; useful for "blowout" / "nailbiter" classification
      margin: Math.abs(homeScore - awayScore),
      scoreLine: isComplete ? `${homeScore}-${awayScore}` : null,
      // pokemon entries returned so the row's MVP popover doesn't need a
      // second round-trip to /pokemon
      home: homeMons.map(m => ({
        name: m.pokemonName,
        kills: m.kills,
        deaths: m.deaths,
        teraUsed: m.teraUsed,
        teraType: m.teraType,
      })),
      away: awayMons.map(m => ({
        name: m.pokemonName,
        kills: m.kills,
        deaths: m.deaths,
        teraUsed: m.teraUsed,
        teraType: m.teraType,
      })),
    };
  })

  // ─── Match Details (pokemon K/D for a specific match) ────────────────

  .get('/api/matches/:matchId/pokemon', ({ params }) => {
    const entries = db.select().from(schema.matchPokemon)
      .where(eq(schema.matchPokemon.matchId, params.matchId))
      .all();

    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId))
      .get();

    if (!match) return { home: [], away: [] };

    return {
      home: entries.filter(e => e.teamId === match.homeTeamId).map(e => ({
        name: e.pokemonName,
        kills: e.kills,
        deaths: e.deaths,
        teraUsed: e.teraUsed,
        teraType: e.teraType,
      })),
      away: entries.filter(e => e.teamId === match.awayTeamId).map(e => ({
        name: e.pokemonName,
        kills: e.kills,
        deaths: e.deaths,
        teraUsed: e.teraUsed,
        teraType: e.teraType,
      })),
    };
  })

  // ─── All matches (admin view — cross-league) ────────────────────────

  .get('/api/admin/matches', ({ user, set, query }) => {
    if (!isStaff(user)) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    let q = db.select().from(schema.matches)
      .orderBy(desc(schema.matches.week))
      .all();

    const leagueId = query.leagueId as string | undefined;
    if (leagueId && leagueId !== 'all') {
      q = q.filter(m => m.leagueId === leagueId);
    }

    const status = query.status as string | undefined;
    if (status && status !== 'all') {
      q = q.filter(m => m.status === status);
    }

    return q.map(m => ({
      id: m.id,
      leagueId: m.leagueId,
      week: m.week,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      status: m.status,
      replayUrl: m.replayUrl,
      warnings: m.warnings ? JSON.parse(m.warnings) : [],
      phase: m.phase,
      playoffRound: m.playoffRound,
      startedAt: m.startedAt,
      completedAt: m.completedAt,
      psRoomId: m.psRoomId,
    }));
  })

  // ─── Record match result ─────────────────────────────────────────────

  .post('/api/matches/:matchId/result', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId))
      .get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }

    // State machine enforcement
    if (match.status === 'completed' || match.status === 'disputed') {
      set.status = 400;
      return { error: `Match already ${match.status} — dismiss warnings or contact admin to re-record` };
    }
    if (match.homeTeamId === 'TBD' || match.awayTeamId === 'TBD') {
      set.status = 400;
      return { error: 'Cannot record result for a match with TBD teams' };
    }

    const { homeScore, awayScore, replayUrl, pokemonData, warnings } = body as {
      homeScore: number;
      awayScore: number;
      replayUrl?: string;
      pokemonData?: { teamId: string; pokemonName: string; kills: number; deaths: number; teraUsed?: boolean; teraType?: string }[];
      warnings?: string[];
    };

    if (homeScore === undefined || awayScore === undefined) {
      set.status = 400;
      return { error: 'homeScore and awayScore required' };
    }

    // Validate pokemonData (teamId in {home,away}; pokemonName on roster).
    // Done before the tx so we don't churn the WAL on bad input.
    let mergedWarnings: string[] = warnings?.slice() ?? [];
    if (pokemonData?.length) {
      const validation = validatePokemonDataForMatch(
        pokemonData,
        match.homeTeamId,
        match.awayTeamId,
        { homeScore, awayScore },
      );
      if (!validation.ok) {
        set.status = 400;
        return {
          error: 'Invalid pokemonData entries',
          code: 'invalid_pokemon_data',
          invalid: validation.errors,
        };
      }
      // Soft warnings (score/deaths sum mismatch, >6 mons) flow into the
      // existing disputed-status path rather than blocking — admin can
      // dismiss them post-record.
      if (validation.warnings.length > 0) {
        mergedWarnings = mergedWarnings.concat(validation.warnings);
      }
    }

    const newStatus = mergedWarnings.length > 0 ? 'disputed' : 'completed';

    return tx(() => {
    // Update match
    db.update(schema.matches).set({
      homeScore,
      awayScore,
      replayUrl: replayUrl || match.replayUrl,
      status: newStatus,
      completedAt: new Date().toISOString(),
      warnings: mergedWarnings.length ? JSON.stringify(mergedWarnings) : null,
    }).where(eq(schema.matches.id, params.matchId)).run();

    // Insert per-pokemon K/D if provided
    if (pokemonData?.length) {
      // Clear existing pokemon data for this match
      db.delete(schema.matchPokemon).where(eq(schema.matchPokemon.matchId, params.matchId)).run();

      for (const p of pokemonData) {
        db.insert(schema.matchPokemon).values({
          matchId: params.matchId,
          teamId: p.teamId,
          pokemonName: p.pokemonName,
          kills: p.kills,
          deaths: p.deaths,
          teraUsed: p.teraUsed ?? false,
          teraType: p.teraType ?? null,
        }).run();
      }
    }

    // Activity log
    db.insert(schema.activityLog).values({
      type: 'match_result',
      category: 'match',
      actor: user.username,
      leagueId: match.leagueId,
      description: `Recorded result for ${match.homeTeamId} vs ${match.awayTeamId}: ${homeScore}-${awayScore}`,
      metadata: JSON.stringify({ matchId: params.matchId, homeScore, awayScore, warningCount: mergedWarnings.length }),
    }).run();

    // ─── Playoff auto-advancement ─────────────────────────────────
    if (newStatus === 'completed' && match.phase === 'playoffs' && match.playoffRound) {
      const winnerId = homeScore > awayScore ? match.homeTeamId : match.awayTeamId;
      const winnerSeed = homeScore > awayScore ? match.homeSeed : match.awaySeed;

      advancePlayoffWinner({
        matchId: params.matchId,
        leagueId: match.leagueId,
        playoffRound: match.playoffRound,
        winnerId,
        winnerSeed,
      });
    }

    // ─── Auto-award per-match pins (Kingslayer, Flawless) ─────────
    // Idempotent — re-running on a re-record (after dismiss-warnings) will
    // skip already-awarded rows via the unique index. Safe to run on
    // disputed-status results too: the helpers gate on status='completed'
    // internally, so a 'disputed' record waits until warnings clear.
    if (newStatus === 'completed') {
      runAutoAwards(match.leagueId, { trigger: 'match', matchId: params.matchId });
    }

    return { success: true };
    });
  })

  // ─── Dismiss match warnings ──────────────────────────────────────────

  .post('/api/matches/:matchId/dismiss-warnings', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId))
      .get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }

    // Only flip to 'completed' if BOTH scores are recorded — otherwise we
    // promote a half-recorded result into the standings. Mirrors the
    // homeScore/awayScore guard the result handler enforces on the way in.
    const hasFullScore = match.homeScore !== null && match.awayScore !== null;
    const flippedToCompleted = hasFullScore && match.status === 'disputed';

    return tx(() => {
      db.update(schema.matches).set({
        warnings: null,
        status: hasFullScore ? 'completed' : match.status,
      }).where(eq(schema.matches.id, params.matchId)).run();

      db.insert(schema.activityLog).values({
        type: 'warnings_dismissed',
        category: 'match',
        actor: user.username,
        leagueId: match.leagueId,
        description: `Dismissed warnings for ${match.homeTeamId} vs ${match.awayTeamId}`,
        metadata: JSON.stringify({ matchId: params.matchId }),
      }).run();

      if (flippedToCompleted) {
        runAutoAwards(match.leagueId, { trigger: 'match', matchId: params.matchId });
      }

      return { success: true };
    });
  })

  // ─── Void match result (clear scores + per-pokemon, back to scheduled) ────

  .post('/api/matches/:matchId/void', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId))
      .get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }

    // ─── Playoff downstream chain handling ────────────────────────────
    // If this match was a completed playoff round, its winner has already
    // been propagated into downstream cells. Compute downstream rounds and
    // the prior winner, then either reject (if any downstream is itself
    // completed — to avoid silent cascading rollback) or queue downstream
    // cells to be cleared back to 'TBD' so a re-record re-fires advancement.
    const wasCompleted = match.status === 'completed';
    const isPlayoffChainable =
      wasCompleted
      && match.phase === 'playoffs'
      && !!match.playoffRound
      && match.homeScore != null
      && match.awayScore != null
      && match.homeScore !== match.awayScore;

    let downstreamToClear: { id: string; clearHome: boolean; clearAway: boolean }[] = [];
    if (isPlayoffChainable) {
      const downstreamRounds = match.playoffRound === 'qf'
        ? ['sf', 'f']
        : match.playoffRound === 'sf'
          ? ['f']
          : [];

      if (downstreamRounds.length > 0) {
        const winnerId = (match.homeScore as number) > (match.awayScore as number)
          ? match.homeTeamId
          : match.awayTeamId;

        const downstream = db.select().from(schema.matches)
          .where(and(
            eq(schema.matches.leagueId, match.leagueId),
            eq(schema.matches.phase, 'playoffs'),
          ))
          .all()
          .filter(m => downstreamRounds.includes(m.playoffRound ?? '')
            && (m.homeTeamId === winnerId || m.awayTeamId === winnerId));

        // If any downstream is itself completed, refuse — admin must void
        // those first to avoid an implicit cascading rollback.
        const lockedDownstream = downstream.filter(m => m.status === 'completed');
        if (lockedDownstream.length > 0) {
          set.status = 409;
          return {
            error: `Cannot void completed playoff match — downstream rounds depend on its winner and are themselves completed. Void the dependent matches first.`,
            code: 'playoff_chain_locked',
            lockedMatchIds: lockedDownstream.map(m => m.id),
          };
        }

        downstreamToClear = downstream.map(m => ({
          id: m.id,
          clearHome: m.homeTeamId === winnerId,
          clearAway: m.awayTeamId === winnerId,
        }));
      }
    }

    tx(() => {
      db.delete(schema.matchPokemon)
        .where(eq(schema.matchPokemon.matchId, params.matchId))
        .run();

      db.update(schema.matches).set({
        homeScore: null,
        awayScore: null,
        status: 'scheduled',
        completedAt: null,
        startedAt: null,
        replayUrl: null,
        replayLog: null,
        warnings: null,
        forfeitedBy: null,
        readyHome: false,
        readyAway: false,
      }).where(eq(schema.matches.id, params.matchId)).run();

      // Clear downstream playoff cells back to 'TBD' so a re-record's
      // advancePlayoffWinner call re-populates them cleanly.
      for (const d of downstreamToClear) {
        const updates: Record<string, unknown> = {};
        if (d.clearHome) updates.homeTeamId = 'TBD';
        if (d.clearAway) updates.awayTeamId = 'TBD';
        if (Object.keys(updates).length > 0) {
          db.update(schema.matches)
            .set(updates)
            .where(eq(schema.matches.id, d.id))
            .run();
        }
      }

      // Clear per-match auto-pins (kingslayer, flawless). Re-record will
      // re-mint via runAutoAwards. Scoped by metadata.matchId (set by both
      // awarders) and awarded_by IS NULL (only auto pins).
      db.run(sql`
        DELETE FROM pins
        WHERE awarded_by IS NULL
          AND pin_def_id IN ('kingslayer', 'flawless')
          AND json_extract(metadata, '$.matchId') = ${params.matchId}
      `);

      db.insert(schema.activityLog).values({
        type: 'match_voided',
        category: 'admin',
        actor: user.username,
        leagueId: match.leagueId,
        description: `Voided result for ${match.homeTeamId} vs ${match.awayTeamId} (W${match.week}) — was ${match.homeScore ?? '-'}-${match.awayScore ?? '-'}`,
        metadata: JSON.stringify({
          matchId: params.matchId,
          previousStatus: match.status,
          previousHomeScore: match.homeScore,
          previousAwayScore: match.awayScore,
          clearedDownstream: downstreamToClear.map(d => d.id),
        }),
      }).run();
    });

    return { success: true };
  })

  // ─── Force-mark a match as disputed (admin freeze, pending review) ───
  // Unlike void this does NOT clear scores, pokemon data, or per-match pins —
  // it only flags the match for review. Use void to roll back.

  .post('/api/matches/:matchId/dispute', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { reason } = body as { reason: string };
    if (!reason || typeof reason !== 'string') { set.status = 400; return { error: 'reason required' }; }

    const match = db.select().from(schema.matches).where(eq(schema.matches.id, params.matchId)).get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }
    if (match.status === 'scheduled' || match.status === 'ready') {
      set.status = 400;
      return { error: 'Cannot dispute a match that has not been recorded' };
    }

    return tx(() => {
      db.update(schema.matches)
        .set({ status: 'disputed', warnings: JSON.stringify([`Admin dispute: ${reason}`]) })
        .where(eq(schema.matches.id, params.matchId))
        .run();

      db.insert(schema.activityLog).values({
        type: 'match_disputed',
        category: 'match',
        actor: user.username,
        leagueId: match.leagueId,
        description: `Disputed: ${match.homeTeamId} vs ${match.awayTeamId} (W${match.week}) — ${reason}`,
        metadata: JSON.stringify({ matchId: params.matchId, reason, prevStatus: match.status }),
      }).run();

      return { success: true };
    });
  })

  // ─── Move match (week / deadline) ───────────────────────────────────────

  .patch('/api/matches/:matchId', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId))
      .get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }

    const { week, deadline } = (body || {}) as { week?: number; deadline?: string | null };

    const updates: Record<string, unknown> = {};
    if (week !== undefined) {
      if (!Number.isInteger(week) || week < 1) {
        set.status = 400;
        return { error: 'week must be a positive integer' };
      }
      updates.week = week;
    }
    if (deadline !== undefined) {
      updates.deadline = deadline; // string | null
    }
    if (Object.keys(updates).length === 0) {
      set.status = 400;
      return { error: 'No fields to update (week, deadline)' };
    }

    db.update(schema.matches).set(updates).where(eq(schema.matches.id, params.matchId)).run();

    db.insert(schema.activityLog).values({
      type: 'match_rescheduled',
      category: 'admin',
      actor: user.username,
      leagueId: match.leagueId,
      description: `Moved ${match.homeTeamId} vs ${match.awayTeamId}${week !== undefined ? ` from W${match.week} → W${week}` : ''}`,
      metadata: JSON.stringify({
        matchId: params.matchId,
        oldWeek: match.week,
        newWeek: week ?? match.week,
        oldDeadline: match.deadline,
        newDeadline: deadline === undefined ? match.deadline : deadline,
      }),
    }).run();

    return { success: true };
  })

  // ─── Delete match ────────────────────────────────────────────────────

  .delete('/api/matches/:matchId', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId))
      .get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }

    // Guard: don't allow deletion of completed playoff matches when a downstream
    // round already references the winner — that would orphan the bracket.
    if (match.phase === 'playoffs' && match.status === 'completed' && match.playoffRound) {
      const downstreamRounds = match.playoffRound === 'qf'
        ? ['sf', 'f']
        : match.playoffRound === 'sf'
          ? ['f']
          : [];
      if (downstreamRounds.length > 0) {
        const winnerId = (match.homeScore ?? 0) > (match.awayScore ?? 0)
          ? match.homeTeamId
          : match.awayTeamId;
        const downstream = db.select().from(schema.matches)
          .where(and(
            eq(schema.matches.leagueId, match.leagueId),
            eq(schema.matches.phase, 'playoffs'),
          ))
          .all()
          .filter(m => downstreamRounds.includes(m.playoffRound ?? '')
            && (m.homeTeamId === winnerId || m.awayTeamId === winnerId));
        if (downstream.length > 0) {
          set.status = 409;
          return {
            error: `Cannot delete completed playoff match — downstream rounds depend on its winner. Void the dependent matches first.`,
            code: 'playoff_chain_locked',
          };
        }
      }
    }

    tx(() => {
      db.delete(schema.matchPokemon)
        .where(eq(schema.matchPokemon.matchId, params.matchId))
        .run();
      db.delete(schema.matches)
        .where(eq(schema.matches.id, params.matchId))
        .run();

      db.insert(schema.activityLog).values({
        type: 'match_deleted',
        category: 'admin',
        actor: user.username,
        leagueId: match.leagueId,
        description: `Deleted match ${match.homeTeamId} vs ${match.awayTeamId} (W${match.week})`,
        metadata: JSON.stringify({
          matchId: params.matchId,
          week: match.week,
          phase: match.phase,
          previousStatus: match.status,
          previousHomeScore: match.homeScore,
          previousAwayScore: match.awayScore,
        }),
      }).run();
    });

    return { success: true };
  })

  // ─── Schedule generation ─────────────────────────────────────────────

  .post('/api/leagues/:leagueId/schedule/generate', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const { force, confirmName } = (body || {}) as { force?: boolean; confirmName?: string };

    const league = getLeague(params.leagueId);
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    // Safety lock: refuse to nuke an in-flight regular season or playoffs
    // unless the caller forces AND types the league name verbatim.
    const phase = league.phase;
    const locked = phase === 'regular' || phase === 'playoffs';
    if (locked) {
      if (!force) {
        set.status = 409;
        return {
          error: `League is in ${phase} phase — regenerating will delete all matches and results. Pass { force: true, confirmName } to override.`,
          code: 'regeneration_locked',
          phase,
          leagueName: league.name,
        };
      }
      if (typeof confirmName !== 'string' || confirmName.trim() !== league.name) {
        set.status = 409;
        return {
          error: `confirmName must match the league name exactly ("${league.name}") to force regeneration.`,
          code: 'regeneration_locked',
          phase,
          leagueName: league.name,
        };
      }
    }

    // Snapshot what we're about to destroy for the activity log
    const existingMatches = db.select({ count: sql<number>`COUNT(*)` })
      .from(schema.matches)
      .where(eq(schema.matches.leagueId, params.leagueId))
      .get()?.count ?? 0;
    const completedMatches = db.select({ count: sql<number>`COUNT(*)` })
      .from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, params.leagueId),
        sql`home_score IS NOT NULL AND away_score IS NOT NULL`,
      ))
      .get()?.count ?? 0;

    const result = generateLeagueSchedule(params.leagueId);
    if (!result.success) {
      set.status = 400;
      return { error: result.error || 'Failed to generate schedule' };
    }

    // Activity log
    const destructive = locked || completedMatches > 0;
    db.insert(schema.activityLog).values({
      type: destructive ? 'schedule_regenerated_forced' : 'schedule_generated',
      category: 'match',
      actor: user.username,
      leagueId: params.leagueId,
      description: destructive
        ? `Forced schedule regeneration in ${phase} phase — destroyed ${existingMatches} matches (${completedMatches} with results), created ${result.matchCount}`
        : `Generated round-robin schedule (${result.matchCount} matches)`,
      metadata: JSON.stringify({
        matchCount: result.matchCount,
        destroyedMatches: existingMatches,
        destroyedCompleted: completedMatches,
        phase,
        forced: !!force,
      }),
    }).run();

    return { success: true, matchCount: result.matchCount, byeCount: result.byeCount };
  })

  // ─── Playoff bracket generation ──────────────────────────────────────

  .post('/api/leagues/:leagueId/playoffs/generate', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const { topN } = (body || {}) as { topN?: number };

    const league = getLeague(params.leagueId);
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    // Bracket size: explicit override > league config > default 6
    const requested = topN ?? league.playoffTeamCount ?? 6;
    if (![2, 4, 6, 8].includes(requested)) {
      set.status = 400;
      return { error: `playoffTeamCount must be one of 2, 4, 6, 8 (got ${requested})`, code: 'invalid_bracket_size' };
    }
    const seedCount = requested;

    // Sort using shared standings hierarchy (wins → H2H → diff → kills → id)
    const teamRecords = computeStandings(params.leagueId, { phase: 'regular' });
    const seeded = teamRecords.slice(0, seedCount);

    return tx(() => {
    // Clear existing playoff matches
    db.delete(schema.matches)
      .where(and(eq(schema.matches.leagueId, params.leagueId), eq(schema.matches.phase, 'playoffs')))
      .run();

    // Get max week from regular season
    const maxWeek = db.select({ max: sql<number>`MAX(week)` })
      .from(schema.matches)
      .where(and(eq(schema.matches.leagueId, params.leagueId), eq(schema.matches.phase, 'regular')))
      .get()?.max || 0;

    // Generate bracket per configured size:
    //   2 → F only
    //   4 → SF (1v4, 2v3) + F
    //   6 → QF (3v6, 4v5) + SF (1 + 2 with QF winners) + F  [top 2 bye]
    //   8 → QF (1v8, 2v7, 3v6, 4v5) + SF + F
    const matchups: { round: string; homeSeed: number; awaySeed: number; week: number }[] = [];

    if (seedCount === 8) {
      matchups.push({ round: 'qf', homeSeed: 1, awaySeed: 8, week: maxWeek + 1 });
      matchups.push({ round: 'qf', homeSeed: 4, awaySeed: 5, week: maxWeek + 1 });
      matchups.push({ round: 'qf', homeSeed: 2, awaySeed: 7, week: maxWeek + 1 });
      matchups.push({ round: 'qf', homeSeed: 3, awaySeed: 6, week: maxWeek + 1 });
      matchups.push({ round: 'sf', homeSeed: 0, awaySeed: 0, week: maxWeek + 2 });
      matchups.push({ round: 'sf', homeSeed: 0, awaySeed: 0, week: maxWeek + 2 });
      matchups.push({ round: 'f', homeSeed: 0, awaySeed: 0, week: maxWeek + 3 });
    } else if (seedCount === 6) {
      // Quarterfinals: #3 vs #6, #4 vs #5; #1 and #2 receive byes into SF
      matchups.push({ round: 'qf', homeSeed: 3, awaySeed: 6, week: maxWeek + 1 });
      matchups.push({ round: 'qf', homeSeed: 4, awaySeed: 5, week: maxWeek + 1 });
      // Semifinals: #1 vs winner(3v6), #2 vs winner(4v5)
      matchups.push({ round: 'sf', homeSeed: 1, awaySeed: 0, week: maxWeek + 2 }); // awaySeed TBD
      matchups.push({ round: 'sf', homeSeed: 2, awaySeed: 0, week: maxWeek + 2 });
      // Finals
      matchups.push({ round: 'f', homeSeed: 0, awaySeed: 0, week: maxWeek + 3 });
    } else if (seedCount === 4) {
      matchups.push({ round: 'sf', homeSeed: 1, awaySeed: 4, week: maxWeek + 1 });
      matchups.push({ round: 'sf', homeSeed: 2, awaySeed: 3, week: maxWeek + 1 });
      matchups.push({ round: 'f', homeSeed: 0, awaySeed: 0, week: maxWeek + 2 });
    } else if (seedCount === 2) {
      matchups.push({ round: 'f', homeSeed: 1, awaySeed: 2, week: maxWeek + 1 });
    }

    let matchNum = 0;
    for (const m of matchups) {
      matchNum++;
      const homeTeam = m.homeSeed > 0 ? seeded[m.homeSeed - 1]?.id : null;
      const awayTeam = m.awaySeed > 0 ? seeded[m.awaySeed - 1]?.id : null;

      db.insert(schema.matches).values({
        id: `${params.leagueId}-p${m.round}${matchNum}`,
        leagueId: params.leagueId,
        week: m.week,
        homeTeamId: homeTeam || 'TBD',
        awayTeamId: awayTeam || 'TBD',
        phase: 'playoffs',
        playoffRound: m.round,
        homeSeed: m.homeSeed || null,
        awaySeed: m.awaySeed || null,
        status: 'scheduled',
      }).run();
    }

    // Update team ranks based on seeding
    for (let i = 0; i < teamRecords.length; i++) {
      db.update(schema.teams)
        .set({ rank: i + 1 })
        .where(eq(schema.teams.id, teamRecords[i].id))
        .run();
    }

    // Activity log
    db.insert(schema.activityLog).values({
      type: 'playoffs_generated',
      category: 'match',
      actor: user.username,
      leagueId: params.leagueId,
      description: `Generated ${seedCount}-team playoff bracket`,
      metadata: JSON.stringify({ seedCount, seedings: seeded.map((s, i) => ({ seed: i + 1, teamId: s.id })) }),
    }).run();

    return { success: true, matchCount: matchups.length, seedings: seeded.map((s, i) => ({ seed: i + 1, teamId: s.id })) };
    });
  })

  // ─── Scrims ──────────────────────────────────────────────────────────

  .get('/api/scrims', ({ query }) => {
    let rows = db.select().from(schema.scrims)
      .orderBy(desc(schema.scrims.playedAt))
      .all();

    const leagueId = query.leagueId as string | undefined;
    if (leagueId) {
      rows = rows.filter(s => s.leagueId === leagueId);
    }

    return rows.map(s => ({
      id: s.id,
      leagueId: s.leagueId,
      homeTeamId: s.homeTeamId,
      awayTeamId: s.awayTeamId,
      homeScore: s.homeScore,
      awayScore: s.awayScore,
      replayUrl: s.replayUrl,
      psRoomId: s.psRoomId,
      playedAt: s.playedAt,
    }));
  })

  .post('/api/scrims', ({ body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const { leagueId, homeTeamId, awayTeamId, homeScore, awayScore, replayUrl, psRoomId, pokemonData } = body as {
      leagueId?: string;
      homeTeamId: string;
      awayTeamId: string;
      homeScore: number;
      awayScore: number;
      replayUrl?: string;
      psRoomId?: string;
      pokemonData?: { teamId: string; pokemonName: string; kills: number; deaths: number; teraUsed?: boolean; teraType?: string }[];
    };

    if (!homeTeamId || !awayTeamId) { set.status = 400; return { error: 'homeTeamId and awayTeamId required' }; }

    const result = db.insert(schema.scrims).values({
      leagueId: leagueId || null,
      homeTeamId,
      awayTeamId,
      homeScore: homeScore ?? null,
      awayScore: awayScore ?? null,
      replayUrl: replayUrl || null,
      psRoomId: psRoomId || null,
    }).returning().get();

    // Insert per-pokemon data if provided
    if (pokemonData?.length) {
      for (const p of pokemonData) {
        db.insert(schema.scrimPokemon).values({
          scrimId: result.id,
          teamId: p.teamId,
          pokemonName: p.pokemonName,
          kills: p.kills,
          deaths: p.deaths,
          teraUsed: p.teraUsed ?? false,
          teraType: p.teraType ?? null,
        }).run();
      }
    }

    // Activity log
    db.insert(schema.activityLog).values({
      type: 'scrim_played',
      category: 'scrim',
      actor: user.username,
      leagueId: leagueId || null,
      description: `Scrim: ${homeTeamId} vs ${awayTeamId} (${homeScore}-${awayScore})`,
      metadata: JSON.stringify({ scrimId: result.id }),
    }).run();

    return { id: result.id };
  })

  .get('/api/scrims/:scrimId/pokemon', ({ params }) => {
    const entries = db.select().from(schema.scrimPokemon)
      .where(eq(schema.scrimPokemon.scrimId, parseInt(params.scrimId)))
      .all();

    const scrim = db.select().from(schema.scrims)
      .where(eq(schema.scrims.id, parseInt(params.scrimId)))
      .get();

    if (!scrim) return { home: [], away: [] };

    return {
      home: entries.filter(e => e.teamId === scrim.homeTeamId).map(e => ({
        name: e.pokemonName,
        kills: e.kills,
        deaths: e.deaths,
        teraUsed: e.teraUsed,
        teraType: e.teraType,
      })),
      away: entries.filter(e => e.teamId === scrim.awayTeamId).map(e => ({
        name: e.pokemonName,
        kills: e.kills,
        deaths: e.deaths,
        teraUsed: e.teraUsed,
        teraType: e.teraType,
      })),
    };
  });
