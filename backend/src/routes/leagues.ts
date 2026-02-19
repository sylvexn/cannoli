import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, sql, asc, desc } from 'drizzle-orm';

export const leagueRoutes = new Elysia()

  // ─── Leagues ─────────────────────────────────────────────────────────

  .get('/api/leagues', () => {
    const season = db.select().from(schema.seasons)
      .orderBy(desc(schema.seasons.seasonNumber))
      .get();
    if (!season) return [];
    const leagues = db.select().from(schema.leagues)
      .where(eq(schema.leagues.seasonId, season.id))
      .all();
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
        tradeDeadlineWeek: season.tradeDeadlineWeek,
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
      const roster = db.select().from(schema.rosters)
        .where(eq(schema.rosters.teamId, team.id))
        .all();

      const homeWins = db.select({ count: sql<number>`count(*)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.homeTeamId, team.id), sql`home_score > away_score`))
        .get()?.count || 0;

      const awayWins = db.select({ count: sql<number>`count(*)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.awayTeamId, team.id), sql`away_score > home_score`))
        .get()?.count || 0;

      const homeLosses = db.select({ count: sql<number>`count(*)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.homeTeamId, team.id), sql`home_score < away_score`))
        .get()?.count || 0;

      const awayLosses = db.select({ count: sql<number>`count(*)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.awayTeamId, team.id), sql`away_score < home_score`))
        .get()?.count || 0;

      const homeDiff = db.select({ diff: sql<number>`COALESCE(SUM(home_score - away_score), 0)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.homeTeamId, team.id), sql`home_score IS NOT NULL`))
        .get()?.diff || 0;

      const awayDiff = db.select({ diff: sql<number>`COALESCE(SUM(away_score - home_score), 0)` })
        .from(schema.matches)
        .where(and(eq(schema.matches.awayTeamId, team.id), sql`away_score IS NOT NULL`))
        .get()?.diff || 0;

      const wins = homeWins + awayWins;
      const losses = homeLosses + awayLosses;
      const differential = homeDiff + awayDiff;

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
        status: m.status,
        phase: m.phase,
        playoffRound: m.playoffRound,
        homeSeed: m.homeSeed,
        awaySeed: m.awaySeed,
      }));
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

  .get('/api/leagues/:leagueId/stats', ({ params, query }) => {
    const matchIds = db.select({ id: schema.matches.id })
      .from(schema.matches)
      .where(eq(schema.matches.leagueId, params.leagueId))
      .all()
      .map(m => m.id);

    if (matchIds.length === 0) return [];

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

  // ─── Archive (multi-season) ──────────────────────────────────────────

  .get('/api/seasons', () => {
    return db.select().from(schema.seasons)
      .orderBy(desc(schema.seasons.seasonNumber))
      .all()
      .map(s => ({
        id: s.id,
        seasonNumber: s.seasonNumber,
        phase: s.phase,
        currentWeek: s.currentWeek,
        totalWeeks: s.totalWeeks,
      }));
  })

  .get('/api/seasons/:seasonId/leagues', ({ params }) => {
    const seasonId = parseInt(params.seasonId);
    const leagues = db.select().from(schema.leagues)
      .where(eq(schema.leagues.seasonId, seasonId))
      .all();

    return leagues.map(l => {
      const teams = db.select().from(schema.teams)
        .where(eq(schema.teams.leagueId, l.id))
        .orderBy(asc(schema.teams.rank))
        .all()
        .map(team => {
          const homeWins = db.select({ count: sql<number>`count(*)` })
            .from(schema.matches)
            .where(and(eq(schema.matches.homeTeamId, team.id), sql`home_score > away_score`))
            .get()?.count || 0;
          const awayWins = db.select({ count: sql<number>`count(*)` })
            .from(schema.matches)
            .where(and(eq(schema.matches.awayTeamId, team.id), sql`away_score > home_score`))
            .get()?.count || 0;
          const homeLosses = db.select({ count: sql<number>`count(*)` })
            .from(schema.matches)
            .where(and(eq(schema.matches.homeTeamId, team.id), sql`home_score < away_score`))
            .get()?.count || 0;
          const awayLosses = db.select({ count: sql<number>`count(*)` })
            .from(schema.matches)
            .where(and(eq(schema.matches.awayTeamId, team.id), sql`away_score < home_score`))
            .get()?.count || 0;
          const homeDiff = db.select({ diff: sql<number>`COALESCE(SUM(home_score - away_score), 0)` })
            .from(schema.matches)
            .where(and(eq(schema.matches.homeTeamId, team.id), sql`home_score IS NOT NULL`))
            .get()?.diff || 0;
          const awayDiff = db.select({ diff: sql<number>`COALESCE(SUM(away_score - home_score), 0)` })
            .from(schema.matches)
            .where(and(eq(schema.matches.awayTeamId, team.id), sql`away_score IS NOT NULL`))
            .get()?.diff || 0;

          const roster = db.select().from(schema.rosters)
            .where(eq(schema.rosters.teamId, team.id))
            .all()
            .map(r => {
              const poke = db.select().from(schema.pokemon)
                .where(eq(schema.pokemon.name, r.pokemonName))
                .get();
              return {
                name: r.pokemonName,
                tier: r.tier,
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
              wins: homeWins + awayWins,
              losses: homeLosses + awayLosses,
              differential: homeDiff + awayDiff,
            },
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
        teams: teams.sort((a, b) => b.record.wins - a.record.wins || b.record.differential - a.record.differential),
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
  })

  // ─── Site Settings ──────────────────────────────────────────────────

  .get('/api/site-settings', () => {
    const row = db.select().from(schema.siteSettings).get();
    if (!row) return { siteName: 'Cannoli', announcement: null, announcementType: 'info' };
    return {
      siteName: row.siteName,
      announcement: row.announcement,
      announcementType: row.announcementType,
      defaultPointCap: row.defaultPointCap,
      defaultTeraCaptainSlots: row.defaultTeraCaptainSlots,
      defaultTradeDeadlineWeek: row.defaultTradeDeadlineWeek,
      defaultRosterSize: row.defaultRosterSize,
      defaultMaxTeams: row.defaultMaxTeams,
      defaultUserPassword: row.defaultUserPassword,
      draftTimerEnabled: row.draftTimerEnabled ?? true,
      draftDemoVisible: row.draftDemoVisible ?? true,
    };
  })

  // ─── Move Categories ────────────────────────────────────────────────

  .get('/api/move-categories', () => {
    const cats = db.select().from(schema.moveCategories)
      .orderBy(asc(schema.moveCategories.sortOrder))
      .all();

    return cats.map(cat => {
      const entries = db.select().from(schema.moveCategoryEntries)
        .where(eq(schema.moveCategoryEntries.categoryId, cat.id))
        .all();
      return {
        id: cat.id,
        name: cat.name,
        entries: entries.map(e => ({
          name: e.name,
          moveId: e.moveId,
          isAbility: e.isAbility,
        })),
      };
    });
  })

  // ─── Tier List ─────────────────────────────────────────────────────

  .get('/api/tier-list', () => {
    return db.select({
      name: schema.pokemon.name,
      tier: schema.pokemon.tier,
      teraBanned: schema.pokemon.teraBanned,
      banned: schema.pokemon.banned,
    }).from(schema.pokemon)
      .where(sql`(${schema.pokemon.tier} > 0 OR ${schema.pokemon.banned} = 1 OR ${schema.pokemon.teraBanned} = 1) AND ${schema.pokemon.name} NOT LIKE '%(T)'`)
      .orderBy(desc(schema.pokemon.tier), asc(schema.pokemon.name))
      .all()
      .map(p => ({
        name: p.name,
        tier: p.tier,
        status: p.banned ? 'banned' as const : p.teraBanned ? 'tera-banned' as const : 'available' as const,
      }));
  });
