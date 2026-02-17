import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, sql, asc, desc } from 'drizzle-orm';

export const matchRoutes = new Elysia()

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
    if (!user || (user.role !== 'dev' && user.role !== 'admin')) {
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
    if (!user || user.role !== 'dev') { set.status = 403; return { error: 'Forbidden' }; }

    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId))
      .get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }

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

    // Update match
    db.update(schema.matches).set({
      homeScore,
      awayScore,
      replayUrl: replayUrl || match.replayUrl,
      status: (warnings?.length ?? 0) > 0 ? 'disputed' : 'completed',
      completedAt: new Date().toISOString(),
      warnings: warnings?.length ? JSON.stringify(warnings) : null,
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
      metadata: JSON.stringify({ matchId: params.matchId, homeScore, awayScore, warningCount: warnings?.length ?? 0 }),
    }).run();

    return { success: true };
  })

  // ─── Dismiss match warnings ──────────────────────────────────────────

  .post('/api/matches/:matchId/dismiss-warnings', ({ params, user, set }) => {
    if (!user || user.role !== 'dev') { set.status = 403; return { error: 'Forbidden' }; }

    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, params.matchId))
      .get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }

    db.update(schema.matches).set({
      warnings: null,
      status: match.homeScore !== null ? 'completed' : match.status,
    }).where(eq(schema.matches.id, params.matchId)).run();

    db.insert(schema.activityLog).values({
      type: 'warnings_dismissed',
      category: 'match',
      actor: user.username,
      leagueId: match.leagueId,
      description: `Dismissed warnings for ${match.homeTeamId} vs ${match.awayTeamId}`,
      metadata: JSON.stringify({ matchId: params.matchId }),
    }).run();

    return { success: true };
  })

  // ─── Playoff bracket generation ──────────────────────────────────────

  .post('/api/leagues/:leagueId/playoffs/generate', ({ params, body, user, set }) => {
    if (!user || user.role !== 'dev') { set.status = 403; return { error: 'Forbidden' }; }

    const { topN } = (body || {}) as { topN?: number };
    const seedCount = topN ?? 6;

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    // Get teams sorted by W-L-Diff
    const teams = db.select().from(schema.teams)
      .where(eq(schema.teams.leagueId, params.leagueId))
      .all();

    const teamRecords = teams.map(team => {
      const homeWins = db.select({ count: sql<number>`count(*)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.homeTeamId, team.id), sql`home_score > away_score`, eq(schema.matches.phase, 'regular')))
        .get()?.count || 0;
      const awayWins = db.select({ count: sql<number>`count(*)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.awayTeamId, team.id), sql`away_score > home_score`, eq(schema.matches.phase, 'regular')))
        .get()?.count || 0;
      const homeLosses = db.select({ count: sql<number>`count(*)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.homeTeamId, team.id), sql`home_score < away_score`, eq(schema.matches.phase, 'regular')))
        .get()?.count || 0;
      const awayLosses = db.select({ count: sql<number>`count(*)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.awayTeamId, team.id), sql`away_score < home_score`, eq(schema.matches.phase, 'regular')))
        .get()?.count || 0;
      const homeDiff = db.select({ diff: sql<number>`COALESCE(SUM(home_score - away_score), 0)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.homeTeamId, team.id), sql`home_score IS NOT NULL`, eq(schema.matches.phase, 'regular')))
        .get()?.diff || 0;
      const awayDiff = db.select({ diff: sql<number>`COALESCE(SUM(away_score - home_score), 0)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.awayTeamId, team.id), sql`away_score IS NOT NULL`, eq(schema.matches.phase, 'regular')))
        .get()?.diff || 0;

      return {
        id: team.id,
        wins: homeWins + awayWins,
        losses: homeLosses + awayLosses,
        differential: homeDiff + awayDiff,
      };
    });

    // Sort: wins desc, then differential desc
    teamRecords.sort((a, b) => b.wins - a.wins || b.differential - a.differential);
    const seeded = teamRecords.slice(0, seedCount);

    // Clear existing playoff matches
    db.delete(schema.matches)
      .where(and(eq(schema.matches.leagueId, params.leagueId), eq(schema.matches.phase, 'playoffs')))
      .run();

    // Get max week from regular season
    const maxWeek = db.select({ max: sql<number>`MAX(week)` })
      .from(schema.matches)
      .where(and(eq(schema.matches.leagueId, params.leagueId), eq(schema.matches.phase, 'regular')))
      .get()?.max || 0;

    // Generate standard bracket: 6-team → QF(3v6, 4v5), SF(1vQF1, 2vQF2), F
    const matchups: { round: string; homeSeed: number; awaySeed: number; week: number }[] = [];

    if (seedCount >= 6) {
      // Quarterfinals: #3 vs #6, #4 vs #5
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
