import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { db, schema } from './db';
import { eq, and, or, sql, asc, desc } from 'drizzle-orm';

const app = new Elysia()
  .use(cors())

  .get('/', () => ({ message: 'cannoli api' }))
  .get('/health', () => ({ status: 'ok' }))

  // ─── Leagues ─────────────────────────────────────────────────────────

  .get('/api/leagues', () => {
    const leagues = db.select().from(schema.leagues).all();
    const season = db.select().from(schema.seasons).get();
    return leagues.map(l => ({
      id: l.id,
      name: l.name,
      color: l.color,
      season: season ? {
        id: `s${season.seasonNumber}`,
        seasonNumber: season.seasonNumber,
        phase: season.phase,
        currentWeek: season.currentWeek,
        totalWeeks: season.totalWeeks,
      } : null,
    }));
  })

  // ─── Teams (with rosters + computed records) ─────────────────────────

  .get('/api/leagues/:leagueId/teams', ({ params }) => {
    const teams = db.select().from(schema.teams)
      .where(eq(schema.teams.leagueId, params.leagueId))
      .orderBy(asc(schema.teams.rank))
      .all();

    return teams.map(team => {
      // Get roster
      const roster = db.select().from(schema.rosters)
        .where(eq(schema.rosters.teamId, team.id))
        .all();

      // Compute record from matches
      const homeWins = db.select({ count: sql<number>`count(*)` })
        .from(schema.matches)
        .where(and(
          eq(schema.matches.homeTeamId, team.id),
          sql`home_score > away_score`
        )).get()?.count || 0;

      const awayWins = db.select({ count: sql<number>`count(*)` })
        .from(schema.matches)
        .where(and(
          eq(schema.matches.awayTeamId, team.id),
          sql`away_score > home_score`
        )).get()?.count || 0;

      const homeLosses = db.select({ count: sql<number>`count(*)` })
        .from(schema.matches)
        .where(and(
          eq(schema.matches.homeTeamId, team.id),
          sql`home_score < away_score`
        )).get()?.count || 0;

      const awayLosses = db.select({ count: sql<number>`count(*)` })
        .from(schema.matches)
        .where(and(
          eq(schema.matches.awayTeamId, team.id),
          sql`away_score < home_score`
        )).get()?.count || 0;

      // Compute differential
      const homeDiff = db.select({ diff: sql<number>`COALESCE(SUM(home_score - away_score), 0)` })
        .from(schema.matches)
        .where(and(
          eq(schema.matches.homeTeamId, team.id),
          sql`home_score IS NOT NULL`
        )).get()?.diff || 0;

      const awayDiff = db.select({ diff: sql<number>`COALESCE(SUM(away_score - home_score), 0)` })
        .from(schema.matches)
        .where(and(
          eq(schema.matches.awayTeamId, team.id),
          sql`away_score IS NOT NULL`
        )).get()?.diff || 0;

      const wins = homeWins + awayWins;
      const losses = homeLosses + awayLosses;
      const differential = homeDiff + awayDiff;

      // Get season stats per pokemon from match_pokemon
      const pokemonStats = db.select({
        pokemonName: schema.matchPokemon.pokemonName,
        kills: sql<number>`SUM(kills)`,
        deaths: sql<number>`SUM(deaths)`,
        gp: sql<number>`COUNT(*)`,
      }).from(schema.matchPokemon)
        .where(eq(schema.matchPokemon.teamId, team.id))
        .groupBy(schema.matchPokemon.pokemonName)
        .all();

      const statsMap = new Map(pokemonStats.map(s => [s.pokemonName, s]));

      // Enrich roster with pokemon reference data + season stats
      const enrichedRoster = roster.map(r => {
        const pokemon = db.select().from(schema.pokemon)
          .where(eq(schema.pokemon.name, r.pokemonName))
          .get();

        const stats = statsMap.get(r.pokemonName);

        return {
          name: r.pokemonName,
          types: pokemon ? [pokemon.type1, pokemon.type2].filter(Boolean).map(t => t!.toLowerCase()) : [],
          tier: r.tier,
          isTeraCaptain: r.isTeraCaptain,
          teraTypes: r.isTeraCaptain
            ? [r.teraType1, r.teraType2, r.teraType3].filter(Boolean).map(t => t!.toLowerCase())
            : undefined,
          isShiny: r.isShiny,
          acquiredVia: r.acquiredVia,
          acquiredWeek: r.acquiredWeek,
          stats: pokemon ? {
            hp: pokemon.hp, atk: pokemon.atk, def: pokemon.def,
            spa: pokemon.spa, spd: pokemon.spd, spe: pokemon.spe,
          } : null,
          abilities: pokemon
            ? [pokemon.ability1, pokemon.ability2, pokemon.hiddenAbility].filter(Boolean)
            : [],
          seasonStats: {
            kills: stats?.kills || 0,
            deaths: stats?.deaths || 0,
            gp: stats?.gp || 0,
          },
        };
      });

      return {
        id: team.id,
        name: team.coachName,
        teamName: team.teamName,
        teamAbbrev: team.teamAbbrev,
        teamColor: team.teamColor,
        rank: team.rank,
        showdownUsername: team.showdownUsername,
        record: { wins, losses, differential },
        roster: enrichedRoster,
      };
    });
  })

  // ─── Schedule ────────────────────────────────────────────────────────

  .get('/api/leagues/:leagueId/schedule', ({ params }) => {
    return db.select().from(schema.matches)
      .where(eq(schema.matches.leagueId, params.leagueId))
      .orderBy(asc(schema.matches.week))
      .all()
      .map(m => ({
        id: m.id,
        week: m.week,
        homePlayer: m.homeTeamId,
        awayPlayer: m.awayTeamId,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        replayUrl: m.replayUrl,
        phase: m.phase,
        playoffRound: m.playoffRound,
        homeSeed: m.homeSeed,
        awaySeed: m.awaySeed,
      }));
  })

  // ─── Match Details (pokemon K/D for a specific match) ────────────────

  .get('/api/matches/:matchId/pokemon', ({ params }) => {
    const entries = db.select().from(schema.matchPokemon)
      .where(eq(schema.matchPokemon.matchId, params.matchId))
      .all();

    // Group by team
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

  // ─── Transactions ────────────────────────────────────────────────────

  .get('/api/leagues/:leagueId/transactions', ({ params }) => {
    return db.select().from(schema.transactions)
      .where(eq(schema.transactions.leagueId, params.leagueId))
      .orderBy(asc(schema.transactions.week))
      .all()
      .map(t => ({
        id: t.id,
        week: t.week,
        type: t.type,
        teamId: t.teamId,
        otherTeamId: t.otherTeamId,
        pokemonOut: t.pokemonOut,
        pointsOut: t.pointsOut,
        pokemonIn: t.pokemonIn,
        pointsIn: t.pointsIn,
        teraPokemon: t.teraPokemon,
      }));
  })

  // ─── Draft Picks ─────────────────────────────────────────────────────

  .get('/api/leagues/:leagueId/draft', ({ params }) => {
    return db.select().from(schema.draftPicks)
      .where(eq(schema.draftPicks.leagueId, params.leagueId))
      .orderBy(asc(schema.draftPicks.teamId), asc(schema.draftPicks.pickNumber))
      .all()
      .map(p => ({
        id: p.id,
        teamId: p.teamId,
        pickNumber: p.pickNumber,
        pokemonName: p.pokemonName,
        tier: p.tier,
      }));
  })

  // ─── Pokemon Stats (league-wide aggregated) ──────────────────────────

  .get('/api/leagues/:leagueId/stats', ({ params }) => {
    // Get all match IDs for this league
    const matchIds = db.select({ id: schema.matches.id })
      .from(schema.matches)
      .where(eq(schema.matches.leagueId, params.leagueId))
      .all()
      .map(m => m.id);

    if (matchIds.length === 0) return [];

    // Aggregate stats across all matches in the league
    const stats = db.select({
      pokemonName: schema.matchPokemon.pokemonName,
      teamId: schema.matchPokemon.teamId,
      kills: sql<number>`SUM(${schema.matchPokemon.kills})`,
      deaths: sql<number>`SUM(${schema.matchPokemon.deaths})`,
      gp: sql<number>`COUNT(*)`,
    }).from(schema.matchPokemon)
      .innerJoin(schema.matches, eq(schema.matchPokemon.matchId, schema.matches.id))
      .where(eq(schema.matches.leagueId, params.leagueId))
      .groupBy(schema.matchPokemon.pokemonName, schema.matchPokemon.teamId)
      .all();

    // Enrich with pokemon data
    return stats.map(s => {
      const pokemon = db.select().from(schema.pokemon)
        .where(eq(schema.pokemon.name, s.pokemonName))
        .get();

      return {
        pokemonName: s.pokemonName,
        teamId: s.teamId,
        kills: s.kills,
        deaths: s.deaths,
        gp: s.gp,
        differential: s.kills - s.deaths,
        kpg: s.gp > 0 ? +(s.kills / s.gp).toFixed(2) : 0,
        types: pokemon ? [pokemon.type1, pokemon.type2].filter(Boolean).map(t => t!.toLowerCase()) : [],
        tier: pokemon?.tier || 0,
      };
    });
  })

  // ─── Pokemon reference data ──────────────────────────────────────────

  .get('/api/pokemon', ({ query }) => {
    const limit = parseInt(query.limit as string) || 100;
    const offset = parseInt(query.offset as string) || 0;
    return db.select().from(schema.pokemon)
      .limit(limit)
      .offset(offset)
      .all();
  })

  .get('/api/pokemon/:name', ({ params }) => {
    return db.select().from(schema.pokemon)
      .where(eq(schema.pokemon.name, params.name))
      .get() || null;
  })

  // ─── Season ──────────────────────────────────────────────────────────

  .get('/api/season', () => {
    const season = db.select().from(schema.seasons).get();
    return season || null;
  })

  .listen(3001);

console.log(`Backend running at http://localhost:${app.server?.port}`);

export type App = typeof app;
