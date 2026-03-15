import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, sql, asc, desc } from 'drizzle-orm';
import { isStaff } from '../lib/auth';
import { tx } from '../lib/tx';
import { effectiveCost } from '../lib/tera-cost';

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
      draftDate: l.draftDate,
      draftOrder: l.draftOrder ? JSON.parse(l.draftOrder) : null,
      season: season ? {
        id: `s${season.seasonNumber}`,
        seasonNumber: season.seasonNumber,
        phase: season.phase,
        currentWeek: season.currentWeek,
        totalWeeks: season.totalWeeks,
        pointCap: season.pointCap,
        teraCaptainSlots: season.teraCaptainSlots,
        tradeDeadlineWeek: season.tradeDeadlineWeek,
        forfeitPolicy: season.forfeitPolicy,
        paused: season.paused,
        weekDates: season.weekDates ? JSON.parse(season.weekDates) : null,
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
        logoPath: team.logoPath,
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

  // ─── Player Availability ─────────────────────────────────────────────

  .get('/api/leagues/:leagueId/availability', ({ params }) => {
    return db.select().from(schema.playerAvailability)
      .where(eq(schema.playerAvailability.leagueId, params.leagueId))
      .all();
  })

  .put('/api/leagues/:leagueId/availability', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const { teamId, week, day, status, note } = body as {
      teamId: string; week: number; day: string;
      status: 'available' | 'unavailable' | 'maybe'; note?: string;
    };

    if (!teamId || !week || !day || !status) {
      set.status = 400;
      return { error: 'teamId, week, day, and status required' };
    }

    // Verify team ownership or staff
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    if (!isStaff(user) && team.userId !== parseInt(user.id)) {
      set.status = 403;
      return { error: 'Not your team' };
    }

    // Upsert: delete existing entry for this team/week/day, then insert
    db.delete(schema.playerAvailability)
      .where(and(
        eq(schema.playerAvailability.teamId, teamId),
        eq(schema.playerAvailability.leagueId, params.leagueId),
        eq(schema.playerAvailability.week, week),
        eq(schema.playerAvailability.day, day),
      )).run();

    db.insert(schema.playerAvailability).values({
      teamId,
      leagueId: params.leagueId,
      week,
      day,
      status,
      note: note ?? null,
    }).run();

    return { success: true };
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
    const search = (query.search as string || '').trim();
    let q = db.select().from(schema.pokemon);
    if (search) {
      const rows = q.all().filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
      return rows.slice(offset, offset + limit);
    }
    return q.limit(limit).offset(offset).all();
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
          id: e.id,
          name: e.name,
          moveId: e.moveId,
          isAbility: e.isAbility,
        })),
      };
    });
  })

  // ─── Tier List ─────────────────────────────────────────────────────

  // ─── Tera Captain Management ──────────────────────────────────────

  .put('/api/teams/:teamId/tera-captains', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

    // Check authorization: team owner or staff (admin/dev can override any team)
    if (!isStaff(user) && team.userId !== parseInt(user.id)) {
      set.status = 403;
      return { error: 'Not your team' };
    }

    const { captains } = body as {
      captains: { pokemonName: string; teraTypes: string[] }[];
    };

    if (!Array.isArray(captains)) {
      set.status = 400;
      return { error: 'captains array required' };
    }

    // Get season config for captain slot limit
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, team.leagueId)).get();
    const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;
    const maxCaptains = season?.teraCaptainSlots ?? 2;

    if (captains.length > maxCaptains) {
      set.status = 400;
      return { error: `Max ${maxCaptains} tera captains allowed` };
    }

    // Validate eligibility: not tera-banned, tier ≤ 9
    for (const c of captains) {
      const pkmn = db.select().from(schema.pokemon).where(eq(schema.pokemon.name, c.pokemonName)).get();
      if (pkmn?.teraBanned) {
        set.status = 400;
        return { error: `${c.pokemonName} is tera-banned` };
      }
      if (pkmn && pkmn.tier > 9) {
        set.status = 400;
        return { error: `${c.pokemonName} is tier ${pkmn.tier} — captains must be tier 9 or below` };
      }
      if (c.teraTypes.length > 3) {
        set.status = 400;
        return { error: `Max 3 tera types per captain` };
      }
    }

    // Tera-cost markup point cap check: simulate the new captain assignments
    // against the team's full roster and verify total ≤ pointCap.
    const roster = db.select().from(schema.rosters)
      .where(eq(schema.rosters.teamId, params.teamId))
      .all();
    const captainSet = new Set(captains.map(c => c.pokemonName));
    const totalCost = roster.reduce(
      (sum, r) => sum + effectiveCost(r.tier, captainSet.has(r.pokemonName)),
      0,
    );
    const cap = season?.pointCap ?? 110;
    if (totalCost > cap) {
      set.status = 400;
      return { error: `Tera captain markup would exceed point cap (${totalCost} > ${cap})`, code: 'POINT_CAP_EXCEEDED' };
    }

    return tx(() => {
      // Clear all existing tera captains for this team
      db.update(schema.rosters).set({
        isTeraCaptain: false,
        teraType1: null,
        teraType2: null,
        teraType3: null,
      }).where(eq(schema.rosters.teamId, params.teamId)).run();

      // Set new captains
      for (const c of captains) {
        db.update(schema.rosters).set({
          isTeraCaptain: true,
          teraType1: c.teraTypes[0] ?? null,
          teraType2: c.teraTypes[1] ?? null,
          teraType3: c.teraTypes[2] ?? null,
        }).where(and(
          eq(schema.rosters.teamId, params.teamId),
          eq(schema.rosters.pokemonName, c.pokemonName),
        )).run();
      }

      // Log tera change transaction
      if (league) {
        const week = season?.currentWeek ?? 0;
        for (const c of captains) {
          db.insert(schema.transactions).values({
            leagueId: team.leagueId,
            week,
            type: 'tera_change',
            teamId: params.teamId,
            teraPokemon: c.pokemonName,
          }).run();
        }

        db.insert(schema.activityLog).values({
          type: 'tera_captains_updated',
          category: 'team',
          actor: user.username,
          leagueId: team.leagueId,
          description: `Updated tera captains: ${captains.map(c => c.pokemonName).join(', ')}`,
          metadata: JSON.stringify({ teamId: params.teamId, captains }),
        }).run();
      }

      return { success: true };
    });
  })

  // ─── Shiny Toggle ─────────────────────────────────────────────────

  .put('/api/teams/:teamId/shiny', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

    if (!isStaff(user) && team.userId !== parseInt(user.id)) {
      set.status = 403;
      return { error: 'Not your team' };
    }

    const { pokemonName, isShiny } = body as { pokemonName: string; isShiny: boolean };
    if (!pokemonName || typeof isShiny !== 'boolean') {
      set.status = 400;
      return { error: 'pokemonName and isShiny required' };
    }

    const roster = db.select().from(schema.rosters)
      .where(and(eq(schema.rosters.teamId, params.teamId), eq(schema.rosters.pokemonName, pokemonName)))
      .get();
    if (!roster) { set.status = 404; return { error: 'Pokemon not on roster' }; }

    db.update(schema.rosters).set({ isShiny })
      .where(and(eq(schema.rosters.teamId, params.teamId), eq(schema.rosters.pokemonName, pokemonName)))
      .run();

    return { success: true };
  })

  // ─── Free Agent Pool ────────────────────────────────────────────────

  .get('/api/leagues/:leagueId/free-agents', ({ params }) => {
    // Get all rostered pokemon names in this league
    const teams = db.select().from(schema.teams)
      .where(eq(schema.teams.leagueId, params.leagueId))
      .all();
    const teamIds = teams.map(t => t.id);

    const rostered = new Set(
      teamIds.flatMap(tid =>
        db.select({ name: schema.rosters.pokemonName })
          .from(schema.rosters)
          .where(eq(schema.rosters.teamId, tid))
          .all()
          .map(r => r.name)
      )
    );

    // Get all draftable pokemon (tier > 0, not banned)
    const allPokemon = db.select({
      name: schema.pokemon.name,
      tier: schema.pokemon.tier,
      type1: schema.pokemon.type1,
      type2: schema.pokemon.type2,
      hp: schema.pokemon.hp,
      atk: schema.pokemon.atk,
      def: schema.pokemon.def,
      spa: schema.pokemon.spa,
      spd: schema.pokemon.spd,
      spe: schema.pokemon.spe,
    }).from(schema.pokemon)
      .where(and(sql`${schema.pokemon.tier} > 0`, eq(schema.pokemon.banned, false)))
      .all();

    return allPokemon
      .filter(p => !rostered.has(p.name))
      .map(p => ({
        name: p.name,
        tier: p.tier,
        type1: p.type1,
        type2: p.type2,
        stats: { hp: p.hp, atk: p.atk, def: p.def, spa: p.spa, spd: p.spd, spe: p.spe },
      }));
  })

  .post('/api/leagues/:leagueId/free-agents/pickup', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const { teamId, pokemonName, dropPokemonName } = body as {
      teamId: string;
      pokemonName: string;
      dropPokemonName?: string;
    };

    if (!teamId || !pokemonName) {
      set.status = 400;
      return { error: 'teamId and pokemonName required' };
    }

    // Verify team exists in league
    const team = db.select().from(schema.teams)
      .where(and(eq(schema.teams.id, teamId), eq(schema.teams.leagueId, params.leagueId)))
      .get();
    if (!team) { set.status = 404; return { error: 'Team not found in league' }; }

    // Verify pokemon exists and is available
    const pkmn = db.select().from(schema.pokemon).where(eq(schema.pokemon.name, pokemonName)).get();
    if (!pkmn) { set.status = 404; return { error: 'Pokemon not found' }; }

    const alreadyRostered = db.select().from(schema.rosters)
      .where(eq(schema.rosters.pokemonName, pokemonName))
      .all()
      .some(r => {
        const t = db.select().from(schema.teams).where(eq(schema.teams.id, r.teamId)).get();
        return t?.leagueId === params.leagueId;
      });
    if (alreadyRostered) { set.status = 400; return { error: `${pokemonName} is already rostered` }; }

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;
    const week = season?.currentWeek ?? 0;

    return tx(() => {
      // Drop pokemon if specified
      if (dropPokemonName) {
        db.delete(schema.rosters)
          .where(and(eq(schema.rosters.teamId, teamId), eq(schema.rosters.pokemonName, dropPokemonName)))
          .run();
      }

      // Add new pokemon to roster
      db.insert(schema.rosters).values({
        teamId,
        pokemonName,
        tier: pkmn.tier,
        acquiredVia: 'fa',
        acquiredWeek: week,
      }).run();

      // Transaction record
      db.insert(schema.transactions).values({
        leagueId: params.leagueId,
        week,
        type: 'fa',
        teamId,
        pokemonIn: pokemonName,
        pointsIn: pkmn.tier,
        pokemonOut: dropPokemonName || null,
      }).run();

      // Activity log
      db.insert(schema.activityLog).values({
        type: 'fa_pickup',
        category: 'trade',
        actor: user.username,
        leagueId: params.leagueId,
        description: `FA: ${team.teamName} picked up ${pokemonName}${dropPokemonName ? `, dropped ${dropPokemonName}` : ''}`,
        metadata: JSON.stringify({ teamId, pokemonName, dropPokemonName }),
      }).run();

      return { success: true };
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
