import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, and, sql, asc, desc } from 'drizzle-orm';
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

    return leagues.map(l => {
      const standings = computeStandings(l.id, { phase: 'all' });
      const standingsById = new Map<string, TeamStandingRow>(standings.map(s => [s.id, s]));
      const teamRows = db.select().from(schema.teams)
        .where(eq(schema.teams.leagueId, l.id))
        .all();
      const teamRowById = new Map(teamRows.map(t => [t.id, t]));

      const teams = standings
        .map(s => teamRowById.get(s.id))
        .filter((t): t is NonNullable<typeof t> => !!t)
        .map(team => {
          const standing = standingsById.get(team.id)!;
          const roster = db.select().from(schema.rosters)
            .where(eq(schema.rosters.teamId, team.id))
            .all()
            .map(r => {
              const poke = db.select().from(schema.pokemon)
                .where(eq(schema.pokemon.name, r.pokemonName))
                .get();
              return {
                name: r.pokemonName,
                nickname: r.nickname ?? null,
                // costAtDraft snapshot — see /api/leagues/:leagueId/teams.
                tier: r.costAtDraft || r.tier,
                types: poke ? [poke.type1, poke.type2].filter(Boolean).map(t => t!.toLowerCase()) : [],
                isTeraCaptain: r.isTeraCaptain,
              };
            });

          return {
            id: team.id,
            coachName: team.coachName,
            teamName: team.teamName,
            teamAbbrev: team.teamAbbrev,
            teamColor: team.teamColor,
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

      const playoffs = db.select().from(schema.matches)
        .where(and(eq(schema.matches.leagueId, l.id), eq(schema.matches.phase, 'playoffs')))
        .orderBy(asc(schema.matches.week))
        .all()
        .map(m => ({
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
        champion = finals[0].homeScore! > finals[0].awayScore! ? finals[0].homeTeamId : finals[0].awayTeamId;
      }

      const mvps = db.select({
        pokemonName: schema.matchPokemon.pokemonName,
        teamId: schema.matchPokemon.teamId,
        kills: sql<number>`SUM(${schema.matchPokemon.kills})`,
        deaths: sql<number>`SUM(${schema.matchPokemon.deaths})`,
        gp: sql<number>`COUNT(*)`,
      }).from(schema.matchPokemon)
        .innerJoin(schema.matches, eq(schema.matchPokemon.matchId, schema.matches.id))
        .where(and(eq(schema.matches.leagueId, l.id), eq(schema.matches.phase, 'regular')))
        .groupBy(schema.matchPokemon.pokemonName, schema.matchPokemon.teamId)
        .orderBy(sql`SUM(${schema.matchPokemon.kills}) DESC`)
        .limit(3)
        .all();

      return {
        id: l.id,
        name: l.name,
        color: l.color,
        teams,
        playoffs,
        champion,
        mvps: mvps.map(m => ({
          pokemonName: m.pokemonName,
          teamId: m.teamId,
          kills: m.kills,
          deaths: m.deaths,
          gp: m.gp,
        })),
      };
    });
  });
