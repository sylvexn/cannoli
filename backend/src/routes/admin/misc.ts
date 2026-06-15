import { Elysia } from 'elysia';
import { db, schema, sqlite } from '../../db';
import { eq, desc, and, gte, lt, like, or, type SQL } from 'drizzle-orm';
import { tx } from '../../lib/tx';
import { getBotStatus, restartBot } from '../../lib/ps-bot';
import { runOnce } from '../../lib/scheduler';
import { backfillPinAuditLog } from '../../lib/pins/backfill-audit';
import { checkMatchArchived } from '../../lib/archive-guard';
import { requireStaff, requireDev } from '../../lib/auth-guards';

export const miscRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })

  // ─── PS Bot Status ──────────────────────────────────────────────────

  .get('/api/admin/bot-status', () => {
    return getBotStatus();
  })

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
  })

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
    const { homeScore, awayScore, forfeitedBy, note, pokemonData } = body as {
      homeScore: number; awayScore: number;
      forfeitedBy?: 'home' | 'away' | 'both' | null;
      note?: string;
      /** Optional K/D rewrite — if provided, replaces existing match_pokemon
       *  rows for this match. Snapshot of prior rows still goes to activity log. */
      pokemonData?: { teamId: string; pokemonName: string; kills: number; deaths: number; teraUsed?: boolean; teraType?: string }[];
    };
    const match = db.select().from(schema.matches).where(eq(schema.matches.id, params.matchId)).get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }

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
    if (forfeitedBy === 'home') forceWinnerTeamId = match.awayTeamId;
    else if (forfeitedBy === 'away') forceWinnerTeamId = match.homeTeamId;
    else if (forfeitedBy === 'both') forceWinnerTeamId = null;
    else forceWinnerTeamId = hs > as ? match.homeTeamId : as > hs ? match.awayTeamId : null;

    tx(() => {
      db.update(schema.matches).set({
        status: 'completed',
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
        description: `Force-recorded ${params.matchId}: ${homeScore}-${awayScore}${forfeitedBy ? ` (forfeit: ${forfeitedBy})` : ''}${note ? ' — ' + note : ''}`,
        metadata: JSON.stringify({ matchId: params.matchId, homeScore, awayScore, forfeitedBy, note, pokemonRewritten: !!pokemonData }),
      }).run();
    });

    return { success: true };
  })

  // ─── Activity Log ───────────────────────────────────────────────────

  .get('/api/activity-log', ({ query }) => {
    let rows = db.select().from(schema.activityLog)
      .orderBy(desc(schema.activityLog.timestamp))
      .all();

    const category = query.category as string | undefined;
    if (category && category !== 'all') {
      rows = rows.filter(r => r.category === category);
    }

    const leagueId = query.leagueId as string | undefined;
    if (leagueId && leagueId !== 'all') {
      rows = rows.filter(r => r.leagueId === leagueId);
    }

    const actor = query.actor as string | undefined;
    if (actor && actor !== 'all') {
      rows = rows.filter(r => r.actor === actor);
    }

    const search = (query.search as string || '').toLowerCase();
    if (search) {
      rows = rows.filter(r =>
        r.description.toLowerCase().includes(search) ||
        r.actor.toLowerCase().includes(search) ||
        r.type.toLowerCase().includes(search) ||
        (r.metadata || '').toLowerCase().includes(search)
      );
    }

    const limit = parseInt(query.limit as string) || 50;
    const offset = parseInt(query.offset as string) || 0;
    const total = rows.length;
    rows = rows.slice(offset, offset + limit);

    return {
      events: rows.map(r => ({
        id: String(r.id),
        type: r.type,
        category: r.category,
        actor: r.actor,
        leagueId: r.leagueId,
        description: r.description,
        metadata: r.metadata ? JSON.parse(r.metadata) : {},
        timestamp: r.timestamp,
      })),
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
