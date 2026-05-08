/**
 * Archive read endpoints — every season-historical surface the frontend
 * archive routes (/archive, /archive/:s, /archive/:s/:l, /archive/:s/:l/:t)
 * load from. All public, all GET-only; reads against archived seasons need
 * no auth. The existing /api/seasons + /api/seasons/:id/leagues remain in
 * routes/leagues/archive.ts for the season-grid use case; this file adds:
 *
 *   GET  /api/archive/leagues/:leagueId/full        — schedule, draft, txns, leaderboards
 *   GET  /api/archive/leagues/:leagueId/teams/:teamId — single team-season report
 *   GET  /api/archive/all-time                       — cross-season aggregates
 *
 * Implementation note: each endpoint is structured as a small set of bulk
 * SELECT queries + in-memory grouping rather than the N+1 pattern in the
 * legacy /api/seasons/:id/leagues. For S9-scale data (~36 teams × 12 mons,
 * ~150 matches, ~150 transactions per season), every endpoint completes in
 * under ~10 SQL round-trips regardless of season size.
 */
import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, sql, asc, desc, inArray } from 'drizzle-orm';
import { computeStandings } from '../lib/standings';

export const archiveDeepRoutes = new Elysia()

  // ─── League full archive ────────────────────────────────────────────
  .get('/api/archive/leagues/:leagueId/full', ({ params, set }) => {
    const league = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const season = db.select().from(schema.seasons)
      .where(eq(schema.seasons.id, league.seasonId)).get();

    // Bulk-fetch teams once; everything below is JOIN-or-group on this set.
    const teamRows = db.select().from(schema.teams)
      .where(eq(schema.teams.leagueId, league.id))
      .all();
    const teamMap = new Map(teamRows.map(t => [t.id, t]));

    const standings = computeStandings(league.id, { phase: 'all' });
    const standingsMap = new Map(standings.map(s => [s.id, s]));

    // Roster bulk join — every team's full roster in one query.
    const rosters = db.select({
      teamId: schema.rosters.teamId,
      pokemonName: schema.rosters.pokemonName,
      nickname: schema.rosters.nickname,
      tier: schema.rosters.tier,
      costAtDraft: schema.rosters.costAtDraft,
      isTeraCaptain: schema.rosters.isTeraCaptain,
      teraType1: schema.rosters.teraType1,
      teraType2: schema.rosters.teraType2,
      teraType3: schema.rosters.teraType3,
      isShiny: schema.rosters.isShiny,
      acquiredVia: schema.rosters.acquiredVia,
      acquiredWeek: schema.rosters.acquiredWeek,
      type1: schema.pokemon.type1,
      type2: schema.pokemon.type2,
    })
      .from(schema.rosters)
      .leftJoin(schema.pokemon, eq(schema.pokemon.name, schema.rosters.pokemonName))
      .where(inArray(schema.rosters.teamId, teamRows.map(t => t.id)))
      .all();
    const rostersByTeam = new Map<string, typeof rosters>();
    for (const r of rosters) {
      if (!rostersByTeam.has(r.teamId)) rostersByTeam.set(r.teamId, []);
      rostersByTeam.get(r.teamId)!.push(r);
    }

    const teams = standings
      .map(s => teamMap.get(s.id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map(team => {
        const roster = (rostersByTeam.get(team.id) ?? []).map(r => ({
          name: r.pokemonName,
          nickname: r.nickname ?? null,
          tier: r.costAtDraft || r.tier,
          types: [r.type1, r.type2].filter(Boolean).map(t => (t as string).toLowerCase()),
          isTeraCaptain: r.isTeraCaptain,
          teraTypes: [r.teraType1, r.teraType2, r.teraType3].filter(Boolean) as string[],
          isShiny: r.isShiny,
          acquiredVia: r.acquiredVia,
          acquiredWeek: r.acquiredWeek,
        }));
        const standing = standingsMap.get(team.id)!;
        return {
          id: team.id,
          coachName: team.coachName,
          teamName: team.teamName,
          teamAbbrev: team.teamAbbrev,
          teamColor: team.teamColor,
          userId: team.userId,
          rank: team.rank,
          roster,
          record: {
            wins: standing.wins,
            losses: standing.losses,
            differential: standing.differential,
            kills: standing.kills,
            deaths: standing.deaths,
          },
          tiebreaker: standing.tiebreaker,
        };
      });

    // Schedule (regular + playoff matches in one go, ordered).
    const schedule = db.select({
      id: schema.matches.id,
      week: schema.matches.week,
      phase: schema.matches.phase,
      playoffRound: schema.matches.playoffRound,
      homeTeamId: schema.matches.homeTeamId,
      awayTeamId: schema.matches.awayTeamId,
      homeScore: schema.matches.homeScore,
      awayScore: schema.matches.awayScore,
      homeSeed: schema.matches.homeSeed,
      awaySeed: schema.matches.awaySeed,
      status: schema.matches.status,
      replayUrl: schema.matches.replayUrl,
      forfeitedBy: schema.matches.forfeitedBy,
    })
      .from(schema.matches)
      .where(eq(schema.matches.leagueId, league.id))
      .orderBy(asc(schema.matches.week), asc(schema.matches.id))
      .all();

    // Draft picks (full snake order).
    const draft = db.select({
      pickNumber: schema.draftPicks.pickNumber,
      teamId: schema.draftPicks.teamId,
      pokemonName: schema.draftPicks.pokemonName,
      tier: schema.draftPicks.tier,
    })
      .from(schema.draftPicks)
      .where(eq(schema.draftPicks.leagueId, league.id))
      .orderBy(asc(schema.draftPicks.pickNumber))
      .all();

    // Transactions (trades, F/A, tera changes).
    const transactions = db.select().from(schema.transactions)
      .where(eq(schema.transactions.leagueId, league.id))
      .orderBy(asc(schema.transactions.week), asc(schema.transactions.id))
      .all();

    // Leaderboards: per-Pokemon aggregates over all completed matches.
    const aggregates = db.select({
      pokemonName: schema.matchPokemon.pokemonName,
      teamId: schema.matchPokemon.teamId,
      kills: sql<number>`COALESCE(SUM(${schema.matchPokemon.kills}), 0)`,
      deaths: sql<number>`COALESCE(SUM(${schema.matchPokemon.deaths}), 0)`,
      gp: sql<number>`COUNT(*)`,
      teraUsed: sql<number>`COALESCE(SUM(CASE WHEN ${schema.matchPokemon.teraUsed} = 1 THEN 1 ELSE 0 END), 0)`,
    })
      .from(schema.matchPokemon)
      .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPokemon.matchId))
      .where(eq(schema.matches.leagueId, league.id))
      .groupBy(schema.matchPokemon.pokemonName, schema.matchPokemon.teamId)
      .all();

    // Single-game peaks for high-score leaderboard.
    const peaks = db.select({
      pokemonName: schema.matchPokemon.pokemonName,
      teamId: schema.matchPokemon.teamId,
      matchId: schema.matchPokemon.matchId,
      week: schema.matches.week,
      phase: schema.matches.phase,
      kills: schema.matchPokemon.kills,
    })
      .from(schema.matchPokemon)
      .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPokemon.matchId))
      .where(eq(schema.matches.leagueId, league.id))
      .orderBy(desc(schema.matchPokemon.kills))
      .limit(15)
      .all();

    return {
      league: {
        id: league.id,
        name: league.name,
        color: league.color,
        seasonId: league.seasonId,
        seasonNumber: season?.seasonNumber ?? null,
        archived: !!season?.archived,
        phase: league.phase,
        rosterSize: league.rosterSize,
        playoffTeamCount: league.playoffTeamCount,
      },
      teams,
      schedule,
      draft,
      transactions,
      leaderboards: {
        aggregates: aggregates.map(a => ({
          ...a,
          kdRatio: a.deaths > 0 ? a.kills / a.deaths : a.kills,
        })),
        peaks,
      },
    };
  })

  // ─── Single team-season report ──────────────────────────────────────
  .get('/api/archive/leagues/:leagueId/teams/:teamId', ({ params, set }) => {
    const team = db.select().from(schema.teams)
      .where(and(
        eq(schema.teams.id, params.teamId),
        eq(schema.teams.leagueId, params.leagueId),
      )).get();
    if (!team) { set.status = 404; return { error: 'Team not found in league' }; }

    const league = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, params.leagueId)).get();
    const season = league
      ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get()
      : null;

    const roster = db.select({
      pokemonName: schema.rosters.pokemonName,
      nickname: schema.rosters.nickname,
      tier: schema.rosters.tier,
      costAtDraft: schema.rosters.costAtDraft,
      isTeraCaptain: schema.rosters.isTeraCaptain,
      teraType1: schema.rosters.teraType1,
      teraType2: schema.rosters.teraType2,
      teraType3: schema.rosters.teraType3,
      isShiny: schema.rosters.isShiny,
      acquiredVia: schema.rosters.acquiredVia,
      acquiredWeek: schema.rosters.acquiredWeek,
      type1: schema.pokemon.type1,
      type2: schema.pokemon.type2,
    })
      .from(schema.rosters)
      .leftJoin(schema.pokemon, eq(schema.pokemon.name, schema.rosters.pokemonName))
      .where(eq(schema.rosters.teamId, team.id))
      .all();

    // Week-by-week: matches involving this team, with opponent surfaced.
    const matches = db.select()
      .from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, params.leagueId),
        sql`(${schema.matches.homeTeamId} = ${team.id} OR ${schema.matches.awayTeamId} = ${team.id})`,
      ))
      .orderBy(asc(schema.matches.week), asc(schema.matches.id))
      .all();

    const weekByWeek = matches.map(m => {
      const isHome = m.homeTeamId === team.id;
      const opponentId = isHome ? m.awayTeamId : m.homeTeamId;
      const myScore = isHome ? m.homeScore : m.awayScore;
      const oppScore = isHome ? m.awayScore : m.homeScore;
      let result: 'W' | 'L' | 'T' | null = null;
      if (myScore != null && oppScore != null) {
        result = myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'T';
      }
      return {
        matchId: m.id,
        week: m.week,
        phase: m.phase,
        playoffRound: m.playoffRound,
        opponentId,
        myScore,
        oppScore,
        result,
        replayUrl: m.replayUrl,
        forfeitedBy: m.forfeitedBy,
      };
    });

    // Transactions involving this team.
    const txns = db.select().from(schema.transactions)
      .where(and(
        eq(schema.transactions.leagueId, params.leagueId),
        sql`(${schema.transactions.teamId} = ${team.id} OR ${schema.transactions.otherTeamId} = ${team.id})`,
      ))
      .orderBy(asc(schema.transactions.week), asc(schema.transactions.id))
      .all();

    // Per-Pokemon stats (this team only).
    const pokemonStats = db.select({
      pokemonName: schema.matchPokemon.pokemonName,
      kills: sql<number>`COALESCE(SUM(${schema.matchPokemon.kills}), 0)`,
      deaths: sql<number>`COALESCE(SUM(${schema.matchPokemon.deaths}), 0)`,
      gp: sql<number>`COUNT(*)`,
      teraUsed: sql<number>`COALESCE(SUM(CASE WHEN ${schema.matchPokemon.teraUsed} = 1 THEN 1 ELSE 0 END), 0)`,
    })
      .from(schema.matchPokemon)
      .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPokemon.matchId))
      .where(and(
        eq(schema.matches.leagueId, params.leagueId),
        eq(schema.matchPokemon.teamId, team.id),
      ))
      .groupBy(schema.matchPokemon.pokemonName)
      .orderBy(sql`SUM(${schema.matchPokemon.kills}) DESC`)
      .all();

    // Other teams in the league (so the UI can render opponent abbrevs/colors).
    const otherTeams = db.select({
      id: schema.teams.id,
      coachName: schema.teams.coachName,
      teamName: schema.teams.teamName,
      teamAbbrev: schema.teams.teamAbbrev,
      teamColor: schema.teams.teamColor,
    })
      .from(schema.teams)
      .where(eq(schema.teams.leagueId, params.leagueId))
      .all();

    return {
      team: {
        id: team.id,
        coachName: team.coachName,
        teamName: team.teamName,
        teamAbbrev: team.teamAbbrev,
        teamColor: team.teamColor,
        userId: team.userId,
      },
      league: league && {
        id: league.id,
        name: league.name,
        color: league.color,
        seasonId: league.seasonId,
        seasonNumber: season?.seasonNumber ?? null,
        archived: !!season?.archived,
      },
      roster: roster.map(r => ({
        name: r.pokemonName,
        nickname: r.nickname,
        tier: r.costAtDraft || r.tier,
        types: [r.type1, r.type2].filter(Boolean).map(t => (t as string).toLowerCase()),
        isTeraCaptain: r.isTeraCaptain,
        teraTypes: [r.teraType1, r.teraType2, r.teraType3].filter(Boolean) as string[],
        isShiny: r.isShiny,
        acquiredVia: r.acquiredVia,
        acquiredWeek: r.acquiredWeek,
      })),
      weekByWeek,
      transactions: txns,
      pokemonStats,
      otherTeams,
    };
  })

  // ─── Season awards (every pin awarded with this seasonId) ──────────
  .get('/api/archive/seasons/:seasonId/awards', ({ params, set }) => {
    const seasonId = parseInt(params.seasonId);
    if (!Number.isFinite(seasonId)) { set.status = 400; return { error: 'Invalid seasonId' }; }
    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).get();
    if (!season) { set.status = 404; return { error: 'Season not found' }; }

    const rows = db.select({
      pinId: schema.pins.id,
      pinDefId: schema.pins.pinDefId,
      userId: schema.pins.userId,
      username: schema.users.username,
      displayName: schema.users.displayName,
      defName: schema.pinDefinitions.name,
      defDescription: schema.pinDefinitions.description,
      defIconName: schema.pinDefinitions.iconName,
      defColor: schema.pinDefinitions.color,
      defCategory: schema.pinDefinitions.category,
      defIsAuto: schema.pinDefinitions.isAuto,
      metadata: schema.pins.metadata,
      awardedAt: schema.pins.awardedAt,
      awardedBy: schema.pins.awardedBy,
    })
      .from(schema.pins)
      .innerJoin(schema.pinDefinitions, eq(schema.pinDefinitions.id, schema.pins.pinDefId))
      .innerJoin(schema.users, eq(schema.users.id, schema.pins.userId))
      .where(eq(schema.pins.seasonId, seasonId))
      .all();

    return {
      seasonId,
      seasonNumber: season.seasonNumber,
      archived: !!season.archived,
      pins: rows.map(r => ({
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
      })),
    };
  })

  // ─── All-time aggregates ────────────────────────────────────────────
  .get('/api/archive/all-time', () => {
    // Champions per (season, league) — finals winner. Single query, then
    // fold in-memory.
    const finalsRows = db.select({
      matchId: schema.matches.id,
      leagueId: schema.matches.leagueId,
      leagueName: schema.leagues.name,
      leagueColor: schema.leagues.color,
      seasonId: schema.leagues.seasonId,
      seasonNumber: schema.seasons.seasonNumber,
      homeTeamId: schema.matches.homeTeamId,
      awayTeamId: schema.matches.awayTeamId,
      homeScore: schema.matches.homeScore,
      awayScore: schema.matches.awayScore,
    })
      .from(schema.matches)
      .innerJoin(schema.leagues, eq(schema.leagues.id, schema.matches.leagueId))
      .innerJoin(schema.seasons, eq(schema.seasons.id, schema.leagues.seasonId))
      .where(and(eq(schema.matches.phase, 'playoffs'), eq(schema.matches.playoffRound, 'f')))
      .all();

    const winnerTeamIds = new Set<string>();
    const championsRaw = finalsRows
      .filter(r => r.homeScore != null && r.awayScore != null && r.homeScore !== r.awayScore)
      .map(r => {
        const winnerId = (r.homeScore as number) > (r.awayScore as number) ? r.homeTeamId : r.awayTeamId;
        winnerTeamIds.add(winnerId);
        return { ...r, winnerTeamId: winnerId };
      });

    // Resolve winning team rows in one query.
    const winnerTeams = winnerTeamIds.size > 0
      ? db.select().from(schema.teams).where(inArray(schema.teams.id, [...winnerTeamIds])).all()
      : [];
    const winnerTeamMap = new Map(winnerTeams.map(t => [t.id, t]));

    const champions = championsRaw
      .map(r => {
        const team = winnerTeamMap.get(r.winnerTeamId);
        if (!team) return null;
        return {
          seasonNumber: r.seasonNumber,
          seasonId: r.seasonId,
          leagueId: r.leagueId,
          leagueName: r.leagueName,
          leagueColor: r.leagueColor,
          teamId: team.id,
          teamName: team.teamName,
          teamAbbrev: team.teamAbbrev,
          teamColor: team.teamColor,
          coachName: team.coachName,
          userId: team.userId,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => (b.seasonNumber - a.seasonNumber) || a.leagueId.localeCompare(b.leagueId));

    // All-time per-Pokemon kills/deaths/GP.
    const perPokemon = db.select({
      pokemonName: schema.matchPokemon.pokemonName,
      totalKills: sql<number>`COALESCE(SUM(${schema.matchPokemon.kills}), 0)`,
      totalDeaths: sql<number>`COALESCE(SUM(${schema.matchPokemon.deaths}), 0)`,
      gp: sql<number>`COUNT(*)`,
      seasonsDrafted: sql<number>`COUNT(DISTINCT ${schema.leagues.seasonId})`,
    })
      .from(schema.matchPokemon)
      .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPokemon.matchId))
      .innerJoin(schema.leagues, eq(schema.leagues.id, schema.matches.leagueId))
      .groupBy(schema.matchPokemon.pokemonName)
      .orderBy(sql`SUM(${schema.matchPokemon.kills}) DESC`)
      .limit(50)
      .all();

    // All-time leaders — per coach (userId), aggregated across all seasons.
    // Coaches without a userId (legacy/orphan teams) are excluded.
    const coachStats = db.select({
      userId: schema.teams.userId,
      coachName: schema.teams.coachName,
      totalKills: sql<number>`COALESCE(SUM(${schema.matchPokemon.kills}), 0)`,
      totalDeaths: sql<number>`COALESCE(SUM(${schema.matchPokemon.deaths}), 0)`,
      gp: sql<number>`COUNT(*)`,
    })
      .from(schema.matchPokemon)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.matchPokemon.teamId))
      .where(sql`${schema.teams.userId} IS NOT NULL`)
      .groupBy(schema.teams.userId, schema.teams.coachName)
      .all();

    // De-dup on userId (coach may show up under multiple coachName casings
    // across seasons; pick the most recent display).
    const byUser = new Map<number, typeof coachStats[number]>();
    for (const c of coachStats) {
      if (c.userId == null) continue;
      const ex = byUser.get(c.userId);
      if (!ex) { byUser.set(c.userId, c); continue; }
      ex.totalKills = (ex.totalKills ?? 0) + (c.totalKills ?? 0);
      ex.totalDeaths = (ex.totalDeaths ?? 0) + (c.totalDeaths ?? 0);
      ex.gp = (ex.gp ?? 0) + (c.gp ?? 0);
    }

    const championshipsByUser = new Map<number, number>();
    for (const c of champions) {
      if (c.userId == null) continue;
      championshipsByUser.set(c.userId, (championshipsByUser.get(c.userId) ?? 0) + 1);
    }

    // Seasons-played per coach (distinct seasons their teams appeared in).
    const tenureRows = db.select({
      userId: schema.teams.userId,
      seasonId: schema.leagues.seasonId,
    })
      .from(schema.teams)
      .innerJoin(schema.leagues, eq(schema.leagues.id, schema.teams.leagueId))
      .where(sql`${schema.teams.userId} IS NOT NULL`)
      .all();
    const tenureByUser = new Map<number, Set<number>>();
    for (const t of tenureRows) {
      if (t.userId == null) continue;
      if (!tenureByUser.has(t.userId)) tenureByUser.set(t.userId, new Set());
      tenureByUser.get(t.userId)!.add(t.seasonId);
    }

    const allCoachStats = [...byUser.values()].map(c => ({
      userId: c.userId!,
      coachName: c.coachName,
      totalKills: c.totalKills ?? 0,
      totalDeaths: c.totalDeaths ?? 0,
      gp: c.gp ?? 0,
      kdRatio: (c.totalDeaths ?? 0) > 0 ? (c.totalKills ?? 0) / (c.totalDeaths ?? 0) : (c.totalKills ?? 0),
      championships: championshipsByUser.get(c.userId!) ?? 0,
      seasonsPlayed: tenureByUser.get(c.userId!)?.size ?? 0,
    }));

    const allTimeLeaders = {
      mostKills: [...allCoachStats].sort((a, b) => b.totalKills - a.totalKills).slice(0, 10),
      mostChampionships: [...allCoachStats].filter(c => c.championships > 0).sort((a, b) => b.championships - a.championships).slice(0, 10),
      mostAppearances: [...allCoachStats].sort((a, b) => b.seasonsPlayed - a.seasonsPlayed).slice(0, 10),
      bestKD: [...allCoachStats].filter(c => c.gp >= 10).sort((a, b) => b.kdRatio - a.kdRatio).slice(0, 10),
    };

    // Season grid summary — every season with seasonNumber, league count, archived flag.
    const seasonsList = db.select().from(schema.seasons)
      .orderBy(desc(schema.seasons.seasonNumber))
      .all();
    const leaguesBySeason = db.select().from(schema.leagues).all();
    const leagueCountBySeason = new Map<number, number>();
    for (const l of leaguesBySeason) {
      leagueCountBySeason.set(l.seasonId, (leagueCountBySeason.get(l.seasonId) ?? 0) + 1);
    }

    const seasons = seasonsList.map(s => ({
      id: s.id,
      seasonNumber: s.seasonNumber,
      pointCap: s.pointCap,
      teraCaptainSlots: s.teraCaptainSlots,
      archived: !!s.archived,
      leagueCount: leagueCountBySeason.get(s.id) ?? 0,
    }));

    return {
      seasons,
      champions,
      allTimeLeaders,
      perPokemon,
    };
  });
