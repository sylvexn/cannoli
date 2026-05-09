import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, and, sql, asc, desc, inArray } from 'drizzle-orm';
import { computeStandings, type TeamStandingRow } from '../../lib/standings';

export const archiveRoutes = new Elysia()

  // ─── Archive (multi-season) ──────────────────────────────────────────

  .get('/api/seasons', () => {
    // Lifecycle fields now live per-league. Surface a per-season summary by
    // aggregating from the leagues table: phase = the "least advanced" phase
    // across the season's leagues (so the UI's archive picker can tell at a
    // glance whether all leagues have wrapped); currentWeek/totalWeeks fall
    // back to the max of any league's value (best-effort summary only —
    // schedule pages should read per-league via /api/leagues).
    const phaseOrder: Record<string, number> = {
      predraft: 0, draft: 1, regular: 2, playoffs: 3, offseason: 4,
    };
    const seasons = db.select().from(schema.seasons)
      .orderBy(desc(schema.seasons.seasonNumber))
      .all();
    return seasons.map(s => {
      const lgs = db.select().from(schema.leagues)
        .where(eq(schema.leagues.seasonId, s.id))
        .all();
      let summaryPhase: 'predraft' | 'draft' | 'regular' | 'playoffs' | 'offseason' = 'offseason';
      let currentWeek = 0;
      let totalWeeks = 0;
      if (lgs.length > 0) {
        summaryPhase = lgs.reduce((acc, lg) => (
          phaseOrder[lg.phase] < phaseOrder[acc] ? lg.phase as typeof acc : acc
        ), lgs[0].phase as typeof summaryPhase);
        currentWeek = Math.max(...lgs.map(lg => lg.currentWeek));
        totalWeeks = Math.max(...lgs.map(lg => lg.totalWeeks));
      }
      return {
        id: s.id,
        seasonNumber: s.seasonNumber,
        phase: summaryPhase,
        currentWeek,
        totalWeeks,
        archived: !!s.archived,
      };
    });
  })

  .get('/api/seasons/:seasonId/leagues', ({ params }) => {
    const seasonId = parseInt(params.seasonId);
    const leagues = db.select().from(schema.leagues)
      .where(eq(schema.leagues.seasonId, seasonId))
      .all();
    if (leagues.length === 0) return [];

    const leagueIds = leagues.map(l => l.id);

    // Bulk-fetch every team in the season once. Previous version did one
    // SELECT per league; per-team roster + per-roster pokemon lookups
    // ballooned to ~470 round-trips for a 3-league/12-team/12-mon season.
    const allTeams = db.select().from(schema.teams)
      .where(inArray(schema.teams.leagueId, leagueIds))
      .all();
    const teamById = new Map(allTeams.map(t => [t.id, t]));
    const teamIds = allTeams.map(t => t.id);

    const allRosters = teamIds.length === 0 ? [] : db.select({
      teamId: schema.rosters.teamId,
      pokemonName: schema.rosters.pokemonName,
      nickname: schema.rosters.nickname,
      tier: schema.rosters.tier,
      costAtDraft: schema.rosters.costAtDraft,
      isTeraCaptain: schema.rosters.isTeraCaptain,
      type1: schema.pokemon.type1,
      type2: schema.pokemon.type2,
    })
      .from(schema.rosters)
      .leftJoin(schema.pokemon, eq(schema.pokemon.name, schema.rosters.pokemonName))
      .where(inArray(schema.rosters.teamId, teamIds))
      .all();
    const rostersByTeam = new Map<string, typeof allRosters>();
    for (const r of allRosters) {
      if (!rostersByTeam.has(r.teamId)) rostersByTeam.set(r.teamId, []);
      rostersByTeam.get(r.teamId)!.push(r);
    }

    const allPlayoffs = db.select().from(schema.matches)
      .where(and(
        inArray(schema.matches.leagueId, leagueIds),
        eq(schema.matches.phase, 'playoffs'),
      ))
      .orderBy(asc(schema.matches.leagueId), asc(schema.matches.week))
      .all();
    const playoffsByLeague = new Map<string, typeof allPlayoffs>();
    for (const m of allPlayoffs) {
      if (!playoffsByLeague.has(m.leagueId)) playoffsByLeague.set(m.leagueId, []);
      playoffsByLeague.get(m.leagueId)!.push(m);
    }

    // MVPs: single GROUP-BY across all 3 leagues, then partition + top-3 in
    // memory. Avoids running N independent ORDER-BY-LIMIT queries.
    const mvpRows = db.select({
      leagueId: schema.matches.leagueId,
      pokemonName: schema.matchPokemon.pokemonName,
      teamId: schema.matchPokemon.teamId,
      kills: sql<number>`SUM(${schema.matchPokemon.kills})`,
      deaths: sql<number>`SUM(${schema.matchPokemon.deaths})`,
      gp: sql<number>`COUNT(*)`,
    }).from(schema.matchPokemon)
      .innerJoin(schema.matches, eq(schema.matchPokemon.matchId, schema.matches.id))
      .where(and(
        inArray(schema.matches.leagueId, leagueIds),
        eq(schema.matches.phase, 'regular'),
      ))
      .groupBy(schema.matches.leagueId, schema.matchPokemon.pokemonName, schema.matchPokemon.teamId)
      .all();
    const mvpByLeague = new Map<string, typeof mvpRows>();
    for (const m of mvpRows) {
      if (!mvpByLeague.has(m.leagueId)) mvpByLeague.set(m.leagueId, []);
      mvpByLeague.get(m.leagueId)!.push(m);
    }

    return leagues.map(l => {
      const standings = computeStandings(l.id, { phase: 'all' });
      const standingsById = new Map<string, TeamStandingRow>(standings.map(s => [s.id, s]));

      const teams = standings
        .map(s => teamById.get(s.id))
        .filter((t): t is NonNullable<typeof t> => !!t && t.leagueId === l.id)
        .map(team => {
          const standing = standingsById.get(team.id)!;
          const roster = (rostersByTeam.get(team.id) ?? []).map(r => ({
            name: r.pokemonName,
            nickname: r.nickname ?? null,
            // costAtDraft snapshot — see /api/leagues/:leagueId/teams.
            tier: r.costAtDraft || r.tier,
            types: [r.type1, r.type2].filter(Boolean).map(t => (t as string).toLowerCase()),
            isTeraCaptain: r.isTeraCaptain,
          }));

          return {
            id: team.id,
            coachName: team.coachName,
            teamName: team.teamName,
            teamAbbrev: team.teamAbbrev,
            teamColor: team.teamColor,
            logoPath: team.logoPath,
            rank: team.rank,
            finishPosition: team.finishPosition,
            finishLabel: team.finishLabel,
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

      const playoffs = (playoffsByLeague.get(l.id) ?? []).map(m => ({
        id: m.id,
        playoffRound: m.playoffRound,
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        homeSeed: m.homeSeed,
        awaySeed: m.awaySeed,
      }));

      let champion: string | null = null;
      const finals = playoffs.filter(m => m.playoffRound === 'f');
      if (finals.length > 0 && finals[0].homeScore != null) {
        champion = finals[0].homeScore! > finals[0].awayScore!
          ? finals[0].homeTeamId : finals[0].awayTeamId;
      }

      const mvps = (mvpByLeague.get(l.id) ?? [])
        .sort((a, b) => (b.kills ?? 0) - (a.kills ?? 0))
        .slice(0, 3)
        .map(m => ({
          pokemonName: m.pokemonName,
          teamId: m.teamId,
          kills: m.kills,
          deaths: m.deaths,
          gp: m.gp,
        }));

      return {
        id: l.id,
        name: l.name,
        color: l.color,
        teams,
        playoffs,
        champion,
        mvps,
      };
    });
  });
