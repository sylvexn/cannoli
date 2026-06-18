import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, sql, asc, desc } from 'drizzle-orm';
import { generateLeagueSchedule } from '../lib/schedule-generator';
import { isStaff } from '../lib/auth';
import { tx } from '../lib/tx';
import { advancePlayoffWinner, buildPlayoffMatchups } from '../lib/playoff-advance';
import { computeStandings, matchWinner } from '../lib/standings';
import { runAutoAwards } from '../lib/pins/auto-award';
import { getLeague } from '../lib/queries';
import { checkLeagueArchived, checkMatchArchived } from '../lib/archive-guard';
import { recordMatchResult, type RecordResultInput } from '../lib/match-service';

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

    // LEFT JOIN to rosters (team_id, pokemon_name) so each replay row can
    // surface the team's chosen nickname + shiny flag for that mon. match_pokemon
    // rows for traded-out mons may not match a current roster — those just get
    // null nickname / false isShiny.
    const entries = db.select({
      id: schema.matchPokemon.id,
      matchId: schema.matchPokemon.matchId,
      teamId: schema.matchPokemon.teamId,
      pokemonName: schema.matchPokemon.pokemonName,
      kills: schema.matchPokemon.kills,
      deaths: schema.matchPokemon.deaths,
      teraUsed: schema.matchPokemon.teraUsed,
      teraType: schema.matchPokemon.teraType,
      nickname: schema.rosters.nickname,
      isShiny: schema.rosters.isShiny,
    }).from(schema.matchPokemon)
      .leftJoin(
        schema.rosters,
        and(
          eq(schema.rosters.teamId, schema.matchPokemon.teamId),
          eq(schema.rosters.pokemonName, schema.matchPokemon.pokemonName),
        ),
      )
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
      nickname: mvpEntry.nickname ?? null,
      isShiny: !!mvpEntry.isShiny,
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
        nickname: m.nickname ?? null,
        isShiny: !!m.isShiny,
        kills: m.kills,
        deaths: m.deaths,
        teraUsed: m.teraUsed,
        teraType: m.teraType,
      })),
      away: awayMons.map(m => ({
        name: m.pokemonName,
        nickname: m.nickname ?? null,
        isShiny: !!m.isShiny,
        kills: m.kills,
        deaths: m.deaths,
        teraUsed: m.teraUsed,
        teraType: m.teraType,
      })),
    };
  })

  // ─── Replay payload (PS-format JSON for the in-site replay viewer) ───
  //
  // Returns the protocol log + minimal metadata in the shape the upstream
  // Pokemon Showdown replay client (replay.pokemonshowdown.com SPA) expects.
  // Consumed by the embed page on sim.cannoli.live, which is iframed by
  // the Cannoli replay viewer panel — no external link to PS required.
  //
  // Public on purpose: replays are spectator content and the embed page
  // (cross-origin) can't carry session cookies anyway. CORS allow-all so
  // either sim.cannoli.live or cannoli.live can fetch directly if we ever
  // skip the nginx proxy.

  .get('/api/matches/:matchId/replay.json', ({ params, set }) => {
    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId))
      .get();
    if (!match || !match.replayLog) {
      set.status = 404;
      return { error: 'Replay log not available for this match' };
    }

    const homeTeam = db.select().from(schema.teams)
      .where(eq(schema.teams.id, match.homeTeamId ?? '')).get();
    const awayTeam = db.select().from(schema.teams)
      .where(eq(schema.teams.id, match.awayTeamId ?? '')).get();

    // Format string is parsed back out of the log's `|tier|` line by the
    // viewer if absent. Try to surface it directly anyway so the title
    // line on the embed reads cleanly when the log is truncated.
    const tierMatch = match.replayLog.match(/\n\|tier\|([^|\n]*)/);
    const format = tierMatch ? tierMatch[1] : '[Gen 9] NatDex Draft';

    // Player name preference: the log's `|player|p1|<name>|...` line is the
    // ground truth (PS username at the time of the battle). Fall back to
    // team coach names if the log was scraped without `|player|` lines
    // (defensive — every PS replay has them).
    const p1Match = match.replayLog.match(/\n\|player\|p1\|([^|\n]*)/);
    const p2Match = match.replayLog.match(/\n\|player\|p2\|([^|\n]*)/);
    const p1 = p1Match?.[1] || homeTeam?.coachName || 'Home';
    const p2 = p2Match?.[1] || awayTeam?.coachName || 'Away';

    set.headers['Access-Control-Allow-Origin'] = '*';
    set.headers['Cache-Control'] = 'public, max-age=300';
    return {
      id: match.id,
      format,
      players: [p1, p2],
      log: match.replayLog,
      uploadtime: match.completedAt
        ? Math.floor(new Date(match.completedAt).getTime() / 1000)
        : Math.floor(Date.now() / 1000),
      views: 0,
      formatid: format.toLowerCase().replace(/[^a-z0-9]/g, ''),
      rating: null,
      private: 0,
      password: null,
    };
  })

  // ─── Match Details (pokemon K/D for a specific match) ────────────────

  .get('/api/matches/:matchId/pokemon', ({ params }) => {
    const entries = db.select({
      id: schema.matchPokemon.id,
      teamId: schema.matchPokemon.teamId,
      pokemonName: schema.matchPokemon.pokemonName,
      kills: schema.matchPokemon.kills,
      deaths: schema.matchPokemon.deaths,
      teraUsed: schema.matchPokemon.teraUsed,
      teraType: schema.matchPokemon.teraType,
      nickname: schema.rosters.nickname,
      isShiny: schema.rosters.isShiny,
    }).from(schema.matchPokemon)
      .leftJoin(
        schema.rosters,
        and(
          eq(schema.rosters.teamId, schema.matchPokemon.teamId),
          eq(schema.rosters.pokemonName, schema.matchPokemon.pokemonName),
        ),
      )
      .where(eq(schema.matchPokemon.matchId, params.matchId))
      .all();

    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId))
      .get();

    if (!match) return { home: [], away: [] };

    return {
      home: entries.filter(e => e.teamId === match.homeTeamId).map(e => ({
        name: e.pokemonName,
        nickname: e.nickname ?? null,
        isShiny: !!e.isShiny,
        kills: e.kills,
        deaths: e.deaths,
        teraUsed: e.teraUsed,
        teraType: e.teraType,
      })),
      away: entries.filter(e => e.teamId === match.awayTeamId).map(e => ({
        name: e.pokemonName,
        nickname: e.nickname ?? null,
        isShiny: !!e.isShiny,
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

    // Filter in SQL (uses matches_league_week_idx / matches_status_idx) and
    // select only the columns the admin list needs. Crucially we DON'T pull
    // `replayLog` — it holds the full battle protocol (tens of KB per row) and
    // is only needed as a boolean here; SELECTing it for every match across all
    // seasons was the load-time bottleneck. Order ascending by week (1→N).
    const leagueId = query.leagueId as string | undefined;
    const status = query.status as string | undefined;

    const conds = [];
    if (leagueId && leagueId !== 'all') {
      conds.push(eq(schema.matches.leagueId, leagueId));
    }
    if (status && status !== 'all') {
      conds.push(eq(schema.matches.status, status as typeof schema.matches.$inferSelect.status));
    }

    const rows = db.select({
      id: schema.matches.id,
      leagueId: schema.matches.leagueId,
      week: schema.matches.week,
      homeTeamId: schema.matches.homeTeamId,
      awayTeamId: schema.matches.awayTeamId,
      homeScore: schema.matches.homeScore,
      awayScore: schema.matches.awayScore,
      status: schema.matches.status,
      replayUrl: schema.matches.replayUrl,
      // Imported replays have a stored log but no live PS room URL. The
      // in-site viewer plays by match id off replayLog, so surface a flag
      // the UI can gate the "watch replay" affordance on independently of url.
      // Computed in SQL so we never ship the (large) log to the client.
      hasReplay: sql<number>`(${schema.matches.replayLog} is not null)`,
      warnings: schema.matches.warnings,
      phase: schema.matches.phase,
      playoffRound: schema.matches.playoffRound,
      startedAt: schema.matches.startedAt,
      completedAt: schema.matches.completedAt,
      psRoomId: schema.matches.psRoomId,
    })
      .from(schema.matches)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(schema.matches.week), asc(schema.matches.id))
      .all();

    return rows.map(m => ({
      ...m,
      hasReplay: !!m.hasReplay,
      warnings: m.warnings ? JSON.parse(m.warnings) : [],
    }));
  })

  // ─── Record match result ─────────────────────────────────────────────

  .post('/api/matches/:matchId/result', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkMatchArchived(params.matchId, query.force);
    if (archived) { set.status = 409; return archived; }

    const { homeScore, awayScore, replayUrl, pokemonData, warnings } =
      body as RecordResultInput;

    const outcome = recordMatchResult(
      params.matchId,
      { homeScore, awayScore, replayUrl, pokemonData, warnings },
      user.username,
    );
    if (!outcome.ok) {
      set.status = outcome.status ?? 400;
      const { ok, status, result, ...err } = outcome;
      return err;
    }
    return { success: true };
  })

  // ─── Dismiss match warnings ──────────────────────────────────────────

  .post('/api/matches/:matchId/dismiss-warnings', ({ params, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkMatchArchived(params.matchId, query.force);
    if (archived) { set.status = 409; return archived; }

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

        // If this was a playoff match, advance the bracket winner. This mirrors
        // what recordMatchResult does on the normal result path — without it a
        // dismissed disputed playoff match never fills the next-round slot.
        if (match.phase === 'playoffs' && match.playoffRound) {
          const winnerId = matchWinner({
            winnerTeamId: match.winnerTeamId,
            homeTeamId: match.homeTeamId,
            awayTeamId: match.awayTeamId,
            homeScore: match.homeScore,
            awayScore: match.awayScore,
          });
          if (winnerId) {
            const winnerSeed = winnerId === match.homeTeamId ? match.homeSeed : match.awaySeed;
            advancePlayoffWinner({
              matchId: params.matchId,
              leagueId: match.leagueId,
              playoffRound: match.playoffRound,
              winnerId,
              winnerSeed,
            });
          }
        }
      }

      return { success: true };
    });
  })

  // ─── Void match result (clear scores + per-pokemon, back to scheduled) ────

  .post('/api/matches/:matchId/void', ({ params, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkMatchArchived(params.matchId, query.force);
    if (archived) { set.status = 409; return archived; }

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
        const winnerId = matchWinner({
          winnerTeamId: match.winnerTeamId,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
        });
        if (!winnerId) {
          // scores are unequal (isPlayoffChainable guard) so this shouldn't
          // happen, but if winnerTeamId is stale/unknown, skip downstream clearing.
          downstreamToClear = [];
        } else {

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
        } // end else (winnerId != null)
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

      // Clear downstream playoff cells back to NULL (not-yet-determined) so a
      // re-record's advancePlayoffWinner call re-populates them cleanly.
      for (const d of downstreamToClear) {
        const updates: Record<string, unknown> = {};
        if (d.clearHome) updates.homeTeamId = null;
        if (d.clearAway) updates.awayTeamId = null;
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

  .post('/api/matches/:matchId/dispute', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkMatchArchived(params.matchId, query.force);
    if (archived) { set.status = 409; return archived; }
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

  .patch('/api/matches/:matchId', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkMatchArchived(params.matchId, query.force);
    if (archived) { set.status = 409; return archived; }

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

  .delete('/api/matches/:matchId', ({ params, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkMatchArchived(params.matchId, query.force);
    if (archived) { set.status = 409; return archived; }

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
        const winnerId = matchWinner({
          winnerTeamId: match.winnerTeamId,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
        });
        const downstream = winnerId ? db.select().from(schema.matches)
          .where(and(
            eq(schema.matches.leagueId, match.leagueId),
            eq(schema.matches.phase, 'playoffs'),
          ))
          .all()
          .filter(m => downstreamRounds.includes(m.playoffRound ?? '')
            && (m.homeTeamId === winnerId || m.awayTeamId === winnerId))
          : [];
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

  .post('/api/leagues/:leagueId/schedule/generate', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

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

  .post('/api/leagues/:leagueId/playoffs/generate', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

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

    // Bracket layout is shared with the simulator via buildPlayoffMatchups.
    const matchups = buildPlayoffMatchups(seedCount, maxWeek);

    let matchNum = 0;
    for (const m of matchups) {
      matchNum++;
      const homeTeam = m.homeSeed > 0 ? seeded[m.homeSeed - 1]?.id : null;
      const awayTeam = m.awaySeed > 0 ? seeded[m.awaySeed - 1]?.id : null;

      db.insert(schema.matches).values({
        id: `${params.leagueId}-p${m.round}${matchNum}`,
        leagueId: params.leagueId,
        week: m.week,
        homeTeamId: homeTeam ?? null,
        awayTeamId: awayTeam ?? null,
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
