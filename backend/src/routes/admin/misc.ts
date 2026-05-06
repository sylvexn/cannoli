import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, desc } from 'drizzle-orm';
import { isStaff } from '../../lib/auth';
import { tx } from '../../lib/tx';
import { getBotStatus } from '../../lib/ps-bot';
import { runOnce } from '../../lib/scheduler';

export const miscRoutes = new Elysia()

  // ─── PS Bot Status ──────────────────────────────────────────────────

  .get('/api/admin/bot-status', ({ user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    return getBotStatus();
  })

  // ─── Manual job trigger (admin tool) ────────────────────────────────

  .post('/api/admin/jobs/:name/run', async ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
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

  .post('/api/admin/matches/:matchId/force-result', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
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

    tx(() => {
      db.update(schema.matches).set({
        status: 'completed',
        homeScore: homeScore ?? 0,
        awayScore: awayScore ?? 0,
        forfeitedBy: forfeitedBy ?? null,
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

  .get('/api/activity-log', ({ user, set, query }) => {
    if (!isStaff(user)) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

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

;
