/**
 * Simulator control API — `/api/admin/sim/*`.
 *
 * The HTTP surface a future control panel calls to drive and reset the Cannoli
 * mock-deployment season simulator. MOCK-ONLY.
 *
 * ── Triple-gate (the same Docker image ships to the live deployment) ─────────
 *  1. Mount-time: `admin/index.ts` only `.use()`s this group when
 *     `process.env.CANNOLI_MODE === 'mock'`. In live mode the routes literally
 *     do not exist in the Elysia tree.
 *  2. Per-request: every handler calls `assertMockMode()` first. If the mount
 *     guard is ever bypassed, the handler throws and `gate()` converts that to
 *     a flat 404 — indistinguishable from an unmounted route.
 *  3. Frontend gating is built separately (panel B6) and is not this file's
 *     concern.
 *
 * Reuse posture: bulk-sim work delegates to the simulator core
 * (`simulateDraft` / `simulateSeason` / `simulatePlayoffs`); week advancement
 * reuses the `advance-week` job; reset/void operations reuse the same SQL the
 * `seed-fresh` script and the match `void` route run. Only the orchestration
 * is new here.
 */
import { Elysia } from 'elysia';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { resolve } from 'path';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../../db';
import { isStaff } from '../../lib/auth';
import { isLeaguePhase } from '../../lib/queries';
import { tx } from '../../lib/tx';
import { assertMockMode, isMock } from '../../lib/sim/sim-guard';
import { MockRng } from '../../lib/sim/mock-rng';
import { simulateDraft } from '../../lib/sim/simulate-draft';
import { simulateSeason, simulatePlayoffs } from '../../lib/sim/simulate-season';
import { simulateMatch } from '../../lib/sim/simulate-match';
import { recordMatchResult } from '../../lib/match-service';
import { buildSimWorld, DEFAULT_SIM_SEED } from '../../lib/sim/build-world';
import { applyDueTransactions } from '../../lib/scheduled-transactions';
import { runAutoAwards } from '../../lib/pins/auto-award';
import { mintArchivePins } from '../../lib/pins/archive-mint';
import { assignFinishPositions } from '../../../scripts/import-xlsx';

const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../drizzle');
const SIM_ACTOR = 'simulator';

/**
 * Per-request gate. Runs `assertMockMode()` then the staff check. Returns a
 * response object on failure (caller returns it), or `null` to proceed.
 *
 * In live mode `assertMockMode()` throws — caught here and surfaced as a bare
 * 404 so the route is indistinguishable from one that was never mounted.
 */
function gate(
  user: { role: string } | null | undefined,
  set: { status?: number | string },
): { error: string } | null {
  try {
    assertMockMode();
  } catch {
    set.status = 404;
    return { error: 'Not found' };
  }
  if (!isStaff(user)) {
    set.status = 403;
    return { error: 'Forbidden' };
  }
  return null;
}

/** Load a team's roster in the shape `simulateMatch` expects. */
function loadRoster(teamId: string) {
  return db.select({
    pokemonName: schema.rosters.pokemonName,
    tier: schema.rosters.tier,
  })
    .from(schema.rosters)
    .where(eq(schema.rosters.teamId, teamId))
    .all();
}

/** Void a single match in place — same writes as `POST /api/matches/:id/void`. */
function voidMatch(matchId: string): void {
  tx(() => {
    db.delete(schema.matchPokemon)
      .where(eq(schema.matchPokemon.matchId, matchId))
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
    }).where(eq(schema.matches.id, matchId)).run();
    db.run(sql`
      DELETE FROM pins
      WHERE awarded_by IS NULL
        AND pin_def_id IN ('kingslayer', 'flawless')
        AND json_extract(metadata, '$.matchId') = ${matchId}
    `);
  });
}

/**
 * Season finalization — mirrors routes/admin/leagues.ts's phase→offseason
 * block: finish positions FIRST (champion/runner-up/SF/QF/regular), then the
 * archive pins that depend on them, and only then the generic season-end
 * auto-awards. Called AFTER the league is already sitting in `offseason` (not
 * inside a write transaction) — a throw here must never unwind the match
 * results that already committed, and every step is idempotent so a retry
 * after a partial failure is safe.
 */
function finalizeSeason(leagueId: string, awardedBy: number | null): number {
  try {
    assignFinishPositions(sqlite, [leagueId]);
    const archive = mintArchivePins(leagueId, { awardedBy });
    const summary = runAutoAwards(leagueId, { trigger: 'season-end', awardedBy });
    return summary.awarded.length + archive.awarded.length;
  } catch (err) {
    console.error(`[sim] season-end finalize failed for ${leagueId}:`, err);
    return 0;
  }
}

export const simRoutes = new Elysia()

  // GET /state — drive the control panel UI
  .get('/api/admin/sim/state', ({ user, set }) => {
    const denied = gate(user, set);
    if (denied) return denied;

    const seasons = db.select().from(schema.seasons)
      .orderBy(asc(schema.seasons.seasonNumber))
      .all();
    const leagues = db.select().from(schema.leagues).all();

    return {
      ok: true,
      mode: process.env.CANNOLI_MODE ?? null,
      seasons: seasons.map(s => ({
        id: s.id,
        seasonNumber: s.seasonNumber,
        pointCap: s.pointCap,
        teraCaptainSlots: s.teraCaptainSlots,
      })),
      leagues: leagues.map(lg => {
        const matches = db.select().from(schema.matches)
          .where(eq(schema.matches.leagueId, lg.id))
          .all();
        const done = (m: typeof matches[number]) =>
          m.status === 'completed' || m.status === 'disputed';
        const regular = matches.filter(m => m.phase === 'regular');
        const playoffs = matches.filter(m => m.phase === 'playoffs');
        return {
          id: lg.id,
          name: lg.name,
          seasonId: lg.seasonId,
          phase: lg.phase,
          currentWeek: lg.currentWeek,
          totalWeeks: lg.totalWeeks,
          paused: lg.paused,
          regular: { completed: regular.filter(done).length, total: regular.length },
          playoffs: { completed: playoffs.filter(done).length, total: playoffs.length },
        };
      }),
    };
  })

  // POST /advance-week — sim current week, then advance the pointer
  .post('/api/admin/sim/advance-week', ({ body, user, set }) => {
    const denied = gate(user, set);
    if (denied) return denied;

    const { leagueId } = (body ?? {}) as { leagueId?: string };
    if (!leagueId) { set.status = 400; return { error: 'leagueId required' }; }
    const league = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    // simulateSeason is idempotent — it plays every still-scheduled match up to
    // the cutoff week, so passing the *current* week sims this week's matches.
    const sim = simulateSeason({
      leagueId,
      throughWeek: Math.max(1, league.currentWeek),
      rng: new MockRng((Date.now() ^ league.currentWeek) >>> 0),
    });
    if (!sim.success) { set.status = 400; return { error: sim.error }; }

    // Schedule-INDEPENDENT advance: the production advance-week cron only bumps
    // the pointer when weekDates[nextWeek] is a *past* date, so a live sim
    // season (future week dates) would never advance. The simulator's headline
    // control must always move, so we bump the pointer directly — guarded only
    // by phase and the total-weeks ceiling.
    const weekBefore = league.currentWeek;
    const nextWeek = weekBefore + 1;
    let weekAfter = weekBefore;
    if (league.phase === 'regular' && nextWeek <= league.totalWeeks) {
      tx(() => {
        db.update(schema.leagues)
          .set({ currentWeek: nextWeek })
          .where(eq(schema.leagues.id, leagueId))
          .run();
        db.insert(schema.activityLog).values({
          type: 'sim_week_advanced',
          category: 'admin',
          actor: user!.username,
          leagueId,
          description: `Sim: advanced ${league.name} week ${weekBefore} → ${nextWeek}`,
          metadata: JSON.stringify({ leagueId, from: weekBefore, to: nextWeek }),
        }).run();
      });
      weekAfter = nextWeek;
      applyDueTransactions(leagueId);
    }

    return {
      ok: true,
      leagueId,
      matchesPlayed: sim.matchesPlayed,
      weekBefore,
      weekAfter,
    };
  })

  // POST /match/:matchId — simulate one specific scheduled match
  .post('/api/admin/sim/match/:matchId', ({ params, user, set }) => {
    const denied = gate(user, set);
    if (denied) return denied;

    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId)).get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }
    if (match.status === 'completed' || match.status === 'disputed') {
      set.status = 409;
      return { error: 'Match already has a result — void it first', code: 'match_already_played' };
    }
    if (match.homeTeamId == null || match.awayTeamId == null) {
      set.status = 409;
      return { error: 'Match has an unfilled TBD slot', code: 'match_tbd' };
    }

    const sim = simulateMatch({
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeRoster: loadRoster(match.homeTeamId),
      awayRoster: loadRoster(match.awayTeamId),
      rng: new MockRng((Date.now() ^ match.id.length) >>> 0),
      isPlayoff: match.phase === 'playoffs',
    });
    const outcome = recordMatchResult(match.id, {
      homeScore: sim.homeScore,
      awayScore: sim.awayScore,
      replayUrl: sim.replayUrl,
      pokemonData: sim.pokemonData,
    }, SIM_ACTOR);
    if (!outcome.ok) { set.status = 400; return { error: outcome.error }; }

    return {
      ok: true,
      matchId: match.id,
      homeScore: sim.homeScore,
      awayScore: sim.awayScore,
    };
  })

  // POST /week/:week — simulate every scheduled match in a week
  .post('/api/admin/sim/week/:week', ({ params, body, user, set }) => {
    const denied = gate(user, set);
    if (denied) return denied;

    const { leagueId } = (body ?? {}) as { leagueId?: string };
    if (!leagueId) { set.status = 400; return { error: 'leagueId required' }; }
    const week = parseInt(params.week, 10);
    if (!Number.isFinite(week) || week < 1) {
      set.status = 400; return { error: 'week must be a positive integer' };
    }
    const league = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    // simulateSeason(throughWeek) skips already-completed matches, so playing
    // "through week N" then is exactly "sim everything up to and including N".
    const sim = simulateSeason({
      leagueId,
      throughWeek: week,
      rng: new MockRng((Date.now() ^ week) >>> 0),
    });
    if (!sim.success) { set.status = 400; return { error: sim.error }; }

    return {
      ok: true,
      leagueId,
      week,
      matchesPlayed: sim.matchesPlayed,
      throughWeek: sim.throughWeek,
    };
  })

  // POST /draft/auto-complete — run a synthetic snake draft
  .post('/api/admin/sim/draft/auto-complete', ({ body, user, set }) => {
    const denied = gate(user, set);
    if (denied) return denied;

    const { leagueId } = (body ?? {}) as { leagueId?: string };
    if (!leagueId) { set.status = 400; return { error: 'leagueId required' }; }
    const league = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }
    if (league.phase !== 'draft' && league.phase !== 'predraft') {
      set.status = 409;
      return {
        error: `League must be in draft/predraft phase to auto-draft (is ${league.phase})`,
        code: 'wrong_phase',
      };
    }

    const sim = simulateDraft(leagueId, new MockRng(Date.now() >>> 0));
    if (!sim.success) { set.status = 400; return { error: sim.error }; }

    return {
      ok: true,
      leagueId,
      picks: sim.picks,
      captainsAssigned: sim.captainsAssigned,
    };
  })

  // POST /playoffs/generate — build + play the playoff bracket
  .post('/api/admin/sim/playoffs/generate', ({ body, user, set }) => {
    const denied = gate(user, set);
    if (denied) return denied;

    const { leagueId } = (body ?? {}) as { leagueId?: string };
    if (!leagueId) { set.status = 400; return { error: 'leagueId required' }; }
    const league = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const sim = simulatePlayoffs(leagueId, new MockRng(Date.now() >>> 0));
    if (!sim.success) { set.status = 400; return { error: sim.error }; }

    // simulatePlayoffs already flipped the league to `offseason` internally
    // (lib/sim/simulate-season.ts) — finalize the season now the same way the
    // real phase-advance route does, so a sim'd bracket gets finish positions
    // + archive pins + season-end awards just like a real one.
    const pinsAwarded = finalizeSeason(
      leagueId,
      user!.id ? parseInt(user!.id) : null,
    );

    return {
      ok: true,
      leagueId,
      matchesPlayed: sim.matchesPlayed,
      championId: sim.championId,
      pinsAwarded,
    };
  })

  // POST /phase — pass-through to the real phase-change logic
  // Mirrors `POST /api/leagues/:leagueId/phase` precondition + monotonic
  // guards so phase gates still apply to sim-driven transitions.
  .post('/api/admin/sim/phase', ({ body, user, set }) => {
    const denied = gate(user, set);
    if (denied) return denied;

    const { leagueId, phase, override, confirm } = (body ?? {}) as {
      leagueId?: string; phase?: string; override?: boolean; confirm?: string;
    };
    if (!leagueId || !phase) {
      set.status = 400; return { error: 'leagueId and phase required' };
    }
    const league = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const phaseRank: Record<string, number> = {
      predraft: 0, draft: 1, regular: 2, playoffs: 3, offseason: 4,
    };
    if (!isLeaguePhase(phase)) {
      set.status = 400; return { error: `Unknown phase ${phase}` };
    }
    const previousPhase = league.phase;
    const fromRank = phaseRank[previousPhase] ?? -1;
    const toRank = phaseRank[phase] ?? -1;
    if (toRank < fromRank && previousPhase !== phase) {
      if (!override || confirm !== 'I understand') {
        set.status = 409;
        return {
          error: `Backward phase transition (${previousPhase} → ${phase}) requires override`,
          code: 'phase_backward_requires_override',
          from: previousPhase,
          to: phase,
        };
      }
    }

    const teams = db.select().from(schema.teams)
      .where(eq(schema.teams.leagueId, leagueId)).all();
    const draftState = db.select().from(schema.draftState)
      .where(eq(schema.draftState.leagueId, leagueId)).get();

    if (phase === 'regular' && previousPhase === 'draft') {
      if ((!draftState || draftState.status !== 'completed') && !override) {
        set.status = 400;
        return { error: 'Draft is not complete', code: 'DRAFT_NOT_COMPLETE' };
      }
    }
    if (phase === 'playoffs') {
      const incomplete = db.select({ count: sql<number>`COUNT(*)` })
        .from(schema.matches)
        .where(and(
          eq(schema.matches.leagueId, leagueId),
          eq(schema.matches.phase, 'regular'),
          sql`(home_score IS NULL OR away_score IS NULL OR status = 'disputed')`,
        )).get()?.count ?? 0;
      if (incomplete > 0 && !override) {
        set.status = 400;
        return {
          error: `${incomplete} regular-season matches still missing scores or disputed`,
          code: 'REGULAR_INCOMPLETE',
        };
      }
    }

    tx(() => {
      const updates: Record<string, unknown> = { phase };
      if (phase === 'regular' && previousPhase !== 'regular') {
        updates.currentWeek = 1;
      }
      db.update(schema.leagues).set(updates)
        .where(eq(schema.leagues.id, leagueId)).run();
    });

    // Season finalization — same "any transition into offseason" trigger as
    // routes/admin/leagues.ts's real phase route. Runs AFTER the phase write
    // commits (not inside its transaction) so a finalize failure can't unwind
    // the phase change; idempotent, so a retry via another phase nudge is safe.
    const pinsAwarded = phase === 'offseason' && previousPhase !== 'offseason'
      ? finalizeSeason(leagueId, user!.id ? parseInt(user!.id) : null)
      : 0;

    db.insert(schema.activityLog).values({
      type: 'sim_phase_change',
      category: 'admin',
      actor: user!.username,
      leagueId,
      description: `Sim: ${league.name} phase ${previousPhase} → ${phase}`,
      metadata: JSON.stringify({ leagueId, from: previousPhase, to: phase, pinsAwarded }),
    }).run();

    return { ok: true, leagueId, from: previousPhase, to: phase, teams: teams.length, pinsAwarded };
  })

  // POST /reset — destructive full rebuild of the sim world
  .post('/api/admin/sim/reset', ({ body, user, set }) => {
    const denied = gate(user, set);
    if (denied) return denied;

    const { confirm, masterSeed } = (body ?? {}) as {
      confirm?: string; masterSeed?: number;
    };
    if (confirm !== 'reset') {
      set.status = 400;
      return {
        error: "Destructive — body must include { confirm: 'reset' }",
        code: 'confirm_required',
      };
    }

    // Defense-in-depth: refuse to drop tables if any env signal indicates this
    // is a live deployment.  The triple-gate above (mount-time + assertMockMode
    // + auth) should have already blocked the request, but we add one more cheap
    // absolute-last-resort check before the first destructive write.
    const dbPath = process.env.CANNOLI_DB_PATH ?? '';
    const isLikelyLive =
      process.env.CANNOLI_MODE === 'live' ||
      /live/i.test(dbPath);
    if (isLikelyLive) {
      set.status = 403;
      return { error: 'Sim reset is not permitted in live mode', code: 'live_mode_forbidden' };
    }

    // Wipe in place (seed-fresh pattern) on the already-open `sqlite` handle:
    // drop every user table, vacuum, re-run migrations, then rebuild.
    sqlite.exec('PRAGMA foreign_keys = OFF');
    const tables = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];
    for (const { name } of tables) {
      sqlite.exec(`DROP TABLE IF EXISTS "${name}"`);
    }
    sqlite.exec('VACUUM');
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    sqlite.exec('PRAGMA foreign_keys = ON');

    const seed = (typeof masterSeed === 'number' ? masterSeed : DEFAULT_SIM_SEED) >>> 0;
    const result = buildSimWorld({ masterSeed: seed });

    return {
      ok: true,
      droppedTables: tables.length,
      masterSeed: result.masterSeed,
      totals: result.totals,
      seasons: result.seasons.map(s => ({
        seasonId: s.seasonId,
        seasonNumber: s.seasonNumber,
        status: s.status,
        leagues: s.leagues.length,
      })),
    };
  })

  // POST /reset-week/:week — void a week + rewind currentWeek
  .post('/api/admin/sim/reset-week/:week', ({ params, body, user, set }) => {
    const denied = gate(user, set);
    if (denied) return denied;

    const { leagueId } = (body ?? {}) as { leagueId?: string };
    if (!leagueId) { set.status = 400; return { error: 'leagueId required' }; }
    const week = parseInt(params.week, 10);
    if (!Number.isFinite(week) || week < 1) {
      set.status = 400; return { error: 'week must be a positive integer' };
    }
    const league = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const matches = db.select().from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, leagueId),
        eq(schema.matches.week, week),
      ))
      .orderBy(asc(schema.matches.id))
      .all();

    let voided = 0;
    for (const m of matches) {
      if (m.status === 'completed' || m.status === 'disputed') {
        voidMatch(m.id);
        voided++;
      }
    }

    // Rewind the week pointer to the week before the one we just cleared.
    const rewound = Math.max(1, week - 1);
    if (league.currentWeek > rewound) {
      db.update(schema.leagues).set({ currentWeek: rewound })
        .where(eq(schema.leagues.id, leagueId)).run();
    }
    db.insert(schema.activityLog).values({
      type: 'sim_week_reset',
      category: 'admin',
      actor: user!.username,
      leagueId,
      description: `Sim: reset week ${week} of ${league.name} (${voided} matches voided)`,
      metadata: JSON.stringify({ leagueId, week, voided }),
    }).run();

    return {
      ok: true,
      leagueId,
      week,
      matchesVoided: voided,
      currentWeek: Math.min(league.currentWeek, rewound),
    };
  })

  // POST /reset-match/:matchId — void a single match
  .post('/api/admin/sim/reset-match/:matchId', ({ params, user, set }) => {
    const denied = gate(user, set);
    if (denied) return denied;

    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId)).get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }
    if (match.status !== 'completed' && match.status !== 'disputed') {
      set.status = 409;
      return { error: 'Match has no result to void', code: 'match_not_played' };
    }

    voidMatch(match.id);
    db.insert(schema.activityLog).values({
      type: 'sim_match_reset',
      category: 'admin',
      actor: user!.username,
      leagueId: match.leagueId,
      description: `Sim: voided match ${match.id}`,
      metadata: JSON.stringify({ matchId: match.id }),
    }).run();

    return { ok: true, matchId: match.id };
  });

/**
 * The sim route group, but only when running as the mock deployment. In live
 * mode this is an empty Elysia instance — the `/api/admin/sim/*` paths simply
 * do not exist (mount-time gate, layer 1 of the triple-gate).
 */
export const simRoutesGated = isMock() ? simRoutes : new Elysia();
