import { Elysia } from 'elysia';
import { db, schema, sqlite } from '../../db';
import { eq, desc, and, gte, lt, like, or, type SQL } from 'drizzle-orm';
import { tx } from '../../lib/tx';
import { getBotStatus, restartBot, importBattleForMatch, importBattleFromReplay } from '../../lib/ps-bot';
import { runOnce } from '../../lib/scheduler';
import { backfillPinAuditLog } from '../../lib/pins/backfill-audit';
import { checkMatchArchived } from '../../lib/archive-guard';
import { requireStaff, requireDev } from '../../lib/auth-guards';
import { backfillFeedbackNotifications } from '../../lib/notifications/notify';

export const miscRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })

  // ─── PS Bot Status ──────────────────────────────────────────────────
  //
  // DEV-ONLY: the per-route requireDev guard narrows these below the group's
  // requireStaff — PS Bot monitoring/control is dev tooling, not for admins.

  .get('/api/admin/bot-status', () => {
    return getBotStatus();
  }, { beforeHandle: requireDev })

  // Force-reconnect the PS Monitor Bot. Closes the current WS and immediately
  // reopens — used when the bot is wedged or after credential rotations.
  .post('/api/admin/bot/reconnect', ({ user, set }) => {
    restartBot();
    db.insert(schema.activityLog).values({
      type: 'bot_reconnect',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: 'Force-reconnected PS Monitor Bot',
      metadata: '{}',
    }).run();
    return { success: true };
  }, { beforeHandle: requireDev })

  // Backfill pin_awarded activity-log entries for pins missing them.
  // Idempotent — safe to re-run; returns how many rows were emitted.
  .post('/api/admin/pins/backfill-audit', ({ user, set }) => {
    const result = backfillPinAuditLog();
    db.insert(schema.activityLog).values({
      type: 'pin_audit_backfilled',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Backfilled ${result.inserted} pin_awarded log entries (${result.skipped} already present)`,
      metadata: JSON.stringify(result),
    }).run();
    return result;
  })

  // ─── Manual job trigger (admin tool) ────────────────────────────────

  .post('/api/admin/jobs/:name/run', async ({ params, user, set }) => {
    const ok = await runOnce(params.name);
    if (!ok) { set.status = 404; return { error: `Unknown job: ${params.name}` }; }
    db.insert(schema.activityLog).values({
      type: 'job_run',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Manually ran job: ${params.name}`,
      metadata: JSON.stringify({ jobName: params.name }),
    }).run();
    return { success: true };
  })

  // ─── Force match result (admin override for forfeits / disputes) ────

  .post('/api/admin/matches/:matchId/force-result', ({ params, query, body, user, set }) => {
    const archived = checkMatchArchived(params.matchId, query.force);
    if (archived) { set.status = 409; return archived; }
    const { homeScore, awayScore, forfeitedBy, note, pokemonData, homeTeamId, awayTeamId } = body as {
      homeScore: number; awayScore: number;
      forfeitedBy?: 'home' | 'away' | 'both' | null;
      note?: string;
      /** Optional K/D rewrite — if provided, replaces existing match_pokemon
       *  rows for this match. Snapshot of prior rows still goes to activity log. */
      pokemonData?: { teamId: string; pokemonName: string; kills: number; deaths: number; teraUsed?: boolean; teraType?: string }[];
      /** Optional team reassignment — fixes "teams on the wrong side" while
       *  force-setting a result. Each must reference a team in the match's league. */
      homeTeamId?: string;
      awayTeamId?: string;
    };
    const match = db.select().from(schema.matches).where(eq(schema.matches.id, params.matchId)).get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }

    // Optional team reassignment, applied BEFORE the winner is derived. When a
    // side is supplied it must be a real team in this match's league, and the
    // two sides can't be the same team. Absent → keep the current assignment.
    const reassign = homeTeamId != null || awayTeamId != null;
    const newHomeTeamId = homeTeamId ?? match.homeTeamId;
    const newAwayTeamId = awayTeamId ?? match.awayTeamId;
    if (reassign) {
      for (const tid of [homeTeamId, awayTeamId]) {
        if (tid == null) continue;
        const team = db.select({ leagueId: schema.teams.leagueId })
          .from(schema.teams).where(eq(schema.teams.id, tid)).get();
        if (!team || team.leagueId !== match.leagueId) {
          set.status = 400;
          return { error: `Team ${tid} is not in this match's league` };
        }
      }
      if (newHomeTeamId && newAwayTeamId && newHomeTeamId === newAwayTeamId) {
        set.status = 400;
        return { error: 'Home and away must be different teams' };
      }
    }

    // If overwriting a previously-recorded result, snapshot prior K/D rows so
    // history isn't silently destroyed. Activity log metadata is the system of
    // record (no separate history table).
    const isOverwrite = match.status === 'completed' || match.status === 'disputed';
    const priorPokemon = isOverwrite
      ? db.select().from(schema.matchPokemon)
          .where(eq(schema.matchPokemon.matchId, params.matchId))
          .all()
      : [];

    // Winner: a forfeit names the survivor (the non-forfeiting side) regardless
    // of the KO score — a 2-2 forfeit still records a clean win. Double-forfeit
    // and a plain tie record no winner. Otherwise fall back to the score.
    const hs = homeScore ?? 0;
    const as = awayScore ?? 0;
    let forceWinnerTeamId: string | null;
    if (forfeitedBy === 'home') forceWinnerTeamId = newAwayTeamId;
    else if (forfeitedBy === 'away') forceWinnerTeamId = newHomeTeamId;
    else if (forfeitedBy === 'both') forceWinnerTeamId = null;
    else forceWinnerTeamId = hs > as ? newHomeTeamId : as > hs ? newAwayTeamId : null;

    tx(() => {
      db.update(schema.matches).set({
        status: 'completed',
        homeTeamId: newHomeTeamId,
        awayTeamId: newAwayTeamId,
        homeScore: hs,
        awayScore: as,
        forfeitedBy: forfeitedBy ?? null,
        winnerTeamId: forceWinnerTeamId,
        completedAt: new Date().toISOString(),
        warnings: null,
      }).where(eq(schema.matches.id, params.matchId)).run();

      // Replace per-Pokemon K/D when caller supplies it. Otherwise leave the
      // existing rows untouched (admins can adjust scores without rewriting K/D).
      if (pokemonData && Array.isArray(pokemonData)) {
        db.delete(schema.matchPokemon).where(eq(schema.matchPokemon.matchId, params.matchId)).run();
        for (const p of pokemonData) {
          if (!p.pokemonName?.trim() || !p.teamId?.trim()) continue;
          db.insert(schema.matchPokemon).values({
            matchId: params.matchId,
            teamId: p.teamId,
            pokemonName: p.pokemonName.trim(),
            kills: p.kills ?? 0,
            deaths: p.deaths ?? 0,
            teraUsed: !!p.teraUsed,
            teraType: p.teraType ?? null,
          }).run();
        }
      }

      if (isOverwrite) {
        db.insert(schema.activityLog).values({
          type: 'match_result_overwritten',
          category: 'admin',
          actor: user.username,
          leagueId: match.leagueId,
          description: `Overwrote prior result for ${params.matchId}: was ${match.homeScore ?? '-'}-${match.awayScore ?? '-'}, now ${homeScore}-${awayScore}`,
          metadata: JSON.stringify({
            matchId: params.matchId,
            previous: priorPokemon,
            new: pokemonData ?? [],
            priorScore: { home: match.homeScore, away: match.awayScore },
            newScore: { home: homeScore, away: awayScore },
            by: user.username,
          }),
        }).run();
      }

      db.insert(schema.activityLog).values({
        type: 'match_force_result',
        category: 'admin',
        actor: user.username,
        leagueId: match.leagueId,
        description: `Force-recorded ${params.matchId}: ${homeScore}-${awayScore}${forfeitedBy ? ` (forfeit: ${forfeitedBy})` : ''}${reassign ? ` (teams reassigned: ${newHomeTeamId} vs ${newAwayTeamId})` : ''}${note ? ' — ' + note : ''}`,
        metadata: JSON.stringify({ matchId: params.matchId, homeScore, awayScore, forfeitedBy, note, pokemonRewritten: !!pokemonData, teamsReassigned: reassign, homeTeamId: newHomeTeamId, awayTeamId: newAwayTeamId }),
      }).run();
    });

    return { success: true };
  })

  // ─── Swap match home/away sides (fix teams on the wrong side) ───────
  //
  // Flips which column each team sits in WITHOUT changing the result. Swaps
  // homeTeamId↔awayTeamId, homeScore↔awayScore, and homeSeed↔awaySeed (playoff
  // bracket seeds). winnerTeamId is a team id, so it stays correct as-is, and
  // match_pokemon rows are keyed by teamId so they need no change. Works on both
  // unplayed and completed matches — the result stays semantically identical.

  .post('/api/admin/matches/:matchId/swap-sides', ({ params, query, user, set }) => {
    const archived = checkMatchArchived(params.matchId, query.force);
    if (archived) { set.status = 409; return archived; }
    const match = db.select().from(schema.matches).where(eq(schema.matches.id, params.matchId)).get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }

    tx(() => {
      db.update(schema.matches).set({
        homeTeamId: match.awayTeamId,
        awayTeamId: match.homeTeamId,
        homeScore: match.awayScore,
        awayScore: match.homeScore,
        homeSeed: match.awaySeed,
        awaySeed: match.homeSeed,
      }).where(eq(schema.matches.id, params.matchId)).run();

      db.insert(schema.activityLog).values({
        type: 'match_sides_swapped',
        category: 'admin',
        actor: user.username,
        leagueId: match.leagueId,
        description: `Swapped home/away for ${params.matchId}: ${match.homeTeamId ?? 'TBD'} ↔ ${match.awayTeamId ?? 'TBD'}`,
        metadata: JSON.stringify({
          matchId: params.matchId,
          previous: { homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId, homeScore: match.homeScore, awayScore: match.awayScore, homeSeed: match.homeSeed, awaySeed: match.awaySeed },
          new: { homeTeamId: match.awayTeamId, awayTeamId: match.homeTeamId, homeScore: match.awayScore, awayScore: match.homeScore, homeSeed: match.awaySeed, awaySeed: match.homeSeed },
          by: user.username,
        }),
      }).run();
    });

    return { success: true };
  })

  // ─── Import a played battle into a scheduled match ──────────────────
  //
  // Attaches a finished PS battle (e.g. one played outside the Arena flow) to
  // a scheduled match and records it through the regular completion path
  // (result + per-Pokemon K/D + replay URL). Two sources:
  //   - `replay`: the replay itself — a downloaded PS `.html`, a `.log.json`,
  //     or raw protocol text. Used for league battles that never touched this
  //     backend's disk.
  //   - `roomId`: read a PS autosave off this backend's disk (legacy/sim path).
  // `replay` wins when both are present. v1 refuses to overwrite a finalized
  // match. A full `.html` is tens of KB — Bun's default body limit handles it
  // and the app sets no custom maxBody, so no special config is needed.

  .post('/api/admin/matches/:matchId/import-battle', ({ params, query, body, user, set }) => {
    const archived = checkMatchArchived(params.matchId, query.force);
    if (archived) { set.status = 409; return archived; }

    const { roomId, replay, sideOverride } = (body ?? {}) as {
      roomId?: string;
      replay?: string;
      /**
       * Admin-supplied side assignment when auto-detection is wrong or uncertain.
       * 'p1IsHome' — the p1 player is the Cannoli home team.
       * 'p2IsHome' — the p2 player is the Cannoli home team.
       * Omit / null to use auto-detection.
       */
      sideOverride?: 'p1IsHome' | 'p2IsHome' | null;
    };

    const override: 'p1IsHome' | 'p2IsHome' | null =
      sideOverride === 'p1IsHome' || sideOverride === 'p2IsHome' ? sideOverride : null;

    let result;
    let source: string;
    if (replay && replay.trim()) {
      result = importBattleFromReplay(params.matchId, replay, override);
      source = 'replay';
    } else if (roomId && roomId.trim()) {
      result = importBattleForMatch(params.matchId, roomId, override);
      source = 'disk';
    } else {
      set.status = 422;
      return { error: 'Provide a replay or a roomId' };
    }

    if (!result.ok) {
      set.status = result.status;
      return { error: result.error };
    }

    // Look the match up for the leagueId on the audit row.
    const match = db.select().from(schema.matches).where(eq(schema.matches.id, params.matchId)).get();
    db.insert(schema.activityLog).values({
      type: 'battle_imported',
      category: 'match',
      actor: user.username,
      leagueId: match?.leagueId ?? null,
      description: `Imported battle (${source}) into ${params.matchId}: ${result.homeScore}-${result.awayScore} (${result.pokemonCount} Pokemon, status ${result.status}${result.sidesUncertain ? ' — sides uncertain' : ''})`,
      metadata: JSON.stringify({
        matchId: params.matchId,
        source,
        roomId: source === 'disk' ? roomId : null,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        winnerTeamId: result.winnerTeamId,
        pokemonCount: result.pokemonCount,
        status: result.status,
        sidesUncertain: result.sidesUncertain,
        sideOverride: override,
        by: user.username,
      }),
    }).run();

    return {
      success: true,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      winnerTeamId: result.winnerTeamId,
      pokemonCount: result.pokemonCount,
      /** True when orientation could not be auto-detected — admin should confirm or re-import with sideOverride. */
      sidesUncertain: result.sidesUncertain,
      detectedP1: result.detectedP1,
      detectedP2: result.detectedP2,
    };
  })

  // ─── Activity Log ───────────────────────────────────────────────────

  .get('/api/activity-log', ({ query }) => {
    const baseRows = db.select().from(schema.activityLog)
      .orderBy(desc(schema.activityLog.timestamp))
      .all();

    // ─── Results-reveal gate: redact unpublished match scores ──────────────
    // Score-bearing match entries leak the result through their description
    // text (e.g. "...: 3-2") and metadata. When the entry's match falls in an
    // UNPUBLISHED week (its league's resultsRevealedThrough is non-null AND the
    // match's week > it), replace the description with a neutral notice and drop
    // the score-bearing metadata. Non-result entries pass through untouched, and
    // a league with NULL gate (archived/ungated) is never redacted. Redaction
    // happens BEFORE the search filter so a score query can't correlate hidden
    // matches by their raw text.
    const SCORE_TYPES = new Set([
      'match_result', 'match_result_overwritten', 'battle_imported', 'match_force_result',
    ]);
    // Cache league gates + match weeks across the page to avoid per-row lookups.
    const gateCache = new Map<string, number | null>();
    const leagueGate = (leagueId: string | null): number | null => {
      if (!leagueId) return null;
      if (gateCache.has(leagueId)) return gateCache.get(leagueId)!;
      const lg = db.select({ gate: schema.leagues.resultsRevealedThrough })
        .from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
      const gate = lg?.gate ?? null;
      gateCache.set(leagueId, gate);
      return gate;
    };
    const weekCache = new Map<string, number | null>();
    const matchWeek = (matchId: string): number | null => {
      if (weekCache.has(matchId)) return weekCache.get(matchId)!;
      const mr = db.select({ week: schema.matches.week })
        .from(schema.matches).where(eq(schema.matches.id, matchId)).get();
      const week = mr?.week ?? null;
      weekCache.set(matchId, week);
      return week;
    };
    const isUnpublishedResult = (r: typeof baseRows[number]): boolean => {
      if (!SCORE_TYPES.has(r.type)) return false;
      const gate = leagueGate(r.leagueId);
      if (gate == null) return false; // gate off → nothing hidden
      let meta: Record<string, unknown> = {};
      try { meta = r.metadata ? JSON.parse(r.metadata) : {}; } catch { meta = {}; }
      const matchId = typeof meta.matchId === 'string' ? meta.matchId : null;
      if (!matchId) return false; // can't resolve a week → leave as-is
      const week = matchWeek(matchId);
      if (week == null) return false;
      return week > gate;
    };
    // Project each row into its public (possibly redacted) shape once.
    const REDACTED_DESC = 'A battle result was recorded (hidden until published)';
    const rows = baseRows.map(r => {
      const redacted = isUnpublishedResult(r);
      return {
        id: String(r.id),
        type: r.type,
        category: r.category,
        actor: r.actor,
        leagueId: r.leagueId,
        timestamp: r.timestamp,
        description: redacted ? REDACTED_DESC : r.description,
        metadata: redacted ? { redacted: true } : (r.metadata ? JSON.parse(r.metadata) : {}),
        // searchable text mirrors the post-redaction description/metadata so a
        // score search can't surface a hidden match.
        _search: (redacted
          ? `${REDACTED_DESC} ${r.actor} ${r.type}`
          : `${r.description} ${r.actor} ${r.type} ${r.metadata || ''}`).toLowerCase(),
      };
    });

    let filtered = rows;

    const category = query.category as string | undefined;
    if (category && category !== 'all') {
      filtered = filtered.filter(r => r.category === category);
    }

    const leagueId = query.leagueId as string | undefined;
    if (leagueId && leagueId !== 'all') {
      filtered = filtered.filter(r => r.leagueId === leagueId);
    }

    const actor = query.actor as string | undefined;
    if (actor && actor !== 'all') {
      filtered = filtered.filter(r => r.actor === actor);
    }

    const search = (query.search as string || '').toLowerCase();
    if (search) {
      filtered = filtered.filter(r => r._search.includes(search));
    }

    const limit = parseInt(query.limit as string) || 50;
    const offset = parseInt(query.offset as string) || 0;
    const total = filtered.length;
    const page = filtered.slice(offset, offset + limit);

    return {
      events: page.map(({ _search, ...e }) => e),
      total,
    };
  })

  // ─── API Request Logs (raw HTTP traffic + errors) ───────────────────
  //
  // Backs the admin "API Logs" tab. Server-side filtered + paginated (the
  // table can hold thousands of rows). `stats` is computed over the whole
  // table as an at-a-glance overview, independent of the active filters.
  //
  // DEV-ONLY: the per-route requireDev guard narrows these below the group's
  // requireStaff — admins can't see raw traffic/stack traces, only devs.

  .get('/api/admin/request-logs', ({ query }) => {
    const conds: SQL[] = [];

    // Status class: 2xx / 3xx / 4xx / 5xx, or "errors" (any >= 400).
    const statusClass = (query.status as string) || 'all';
    if (statusClass === 'errors') {
      conds.push(gte(schema.requestLogs.status, 400));
    } else if (/^[2345]xx$/.test(statusClass)) {
      const base = parseInt(statusClass[0]) * 100;
      conds.push(and(gte(schema.requestLogs.status, base), lt(schema.requestLogs.status, base + 100))!);
    }

    const method = (query.method as string) || 'all';
    if (method !== 'all') conds.push(eq(schema.requestLogs.method, method.toUpperCase()));

    // Origin: server HTTP traffic vs. browser-reported faults.
    const source = (query.source as string) || 'all';
    if (source === 'server' || source === 'client') conds.push(eq(schema.requestLogs.source, source));

    const search = ((query.search as string) || '').trim();
    if (search) {
      const pat = `%${search}%`;
      conds.push(or(
        like(schema.requestLogs.path, pat),
        like(schema.requestLogs.username, pat),
        like(schema.requestLogs.errorMessage, pat),
      )!);
    }

    const where = conds.length ? and(...conds) : undefined;
    const limit = Math.min(parseInt(query.limit as string) || 100, 500);
    const offset = parseInt(query.offset as string) || 0;

    const rows = db.select().from(schema.requestLogs)
      .where(where)
      .orderBy(desc(schema.requestLogs.id))
      .limit(limit)
      .offset(offset)
      .all();

    // Filtered total (for pagination): count rows matching the same predicate.
    const filteredTotal = db.select({ id: schema.requestLogs.id })
      .from(schema.requestLogs).where(where).all().length;

    // Overview stats across the whole table (not the filtered view).
    const stats = sqlite.query<{
      total: number; c4xx: number; c5xx: number; avg_ms: number | null; p95_ms: number | null;
    }, []>(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) AS c4xx,
        SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS c5xx,
        CAST(AVG(duration_ms) AS INTEGER) AS avg_ms,
        (SELECT duration_ms FROM request_logs ORDER BY duration_ms
           LIMIT 1 OFFSET CAST((SELECT COUNT(*) FROM request_logs) * 0.95 AS INTEGER)) AS p95_ms
      FROM request_logs
    `).get();

    return {
      logs: rows.map(r => ({
        id: String(r.id),
        source: r.source,
        method: r.method,
        path: r.path,
        status: r.status,
        durationMs: r.durationMs,
        userId: r.userId != null ? String(r.userId) : null,
        username: r.username,
        ip: r.ip,
        errorId: r.errorId,
        errorName: r.errorName,
        errorMessage: r.errorMessage,
        errorStack: r.errorStack,
        timestamp: r.timestamp,
      })),
      total: filteredTotal,
      stats: {
        total: stats?.total ?? 0,
        errors4xx: stats?.c4xx ?? 0,
        errors5xx: stats?.c5xx ?? 0,
        avgMs: stats?.avg_ms ?? 0,
        p95Ms: stats?.p95_ms ?? 0,
      },
    };
  }, { beforeHandle: requireDev })

  // ─── Backfill feedback notifications from GitHub ─────────────────────
  // Re-run the issue-close detector for historical issues. Safe to re-run —
  // dedupeKey on notifications ensures no double-notifications.

  .post('/api/admin/notifications/backfill-feedback', async ({ body, user }) => {
    const { issues } = (body ?? {}) as { issues?: number[] };
    const result = await backfillFeedbackNotifications(issues?.length ? issues : undefined);
    db.insert(schema.activityLog).values({
      type: 'notifications_backfilled',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Backfilled feedback notifications: ${result.inserted} inserted, ${result.skipped} skipped, ${result.noUser} no-user`,
      metadata: JSON.stringify({ issues: issues ?? null, ...result }),
    }).run();
    return result;
  }, { beforeHandle: requireDev })

  // Wipe the request log (dev housekeeping). Returns how many rows cleared.
  .post('/api/admin/request-logs/clear', ({ user }) => {
    const n = sqlite.query('SELECT COUNT(*) AS n FROM request_logs').get() as { n: number };
    sqlite.exec('DELETE FROM request_logs');
    db.insert(schema.activityLog).values({
      type: 'request_logs_cleared',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Cleared ${n.n} API request log rows`,
      metadata: '{}',
    }).run();
    return { cleared: n.n };
  }, { beforeHandle: requireDev })

;
