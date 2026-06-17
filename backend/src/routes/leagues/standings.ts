import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, and, sql, asc } from 'drizzle-orm';
import { isStaff } from '../../lib/auth';
import { computeStandings, type TeamStandingRow } from '../../lib/standings';

export const standingsRoutes = new Elysia()

  // ─── Teams (with rosters + computed records) ─────────────────────────

  .get('/api/leagues/:leagueId/teams', ({ params }) => {
    // Compute standings using the documented tiebreaker hierarchy.
    // Use 'all' phase here so playoff-era views still render correct W-L; the
    // playoff-seeding endpoint scopes to 'regular' separately.
    const standings = computeStandings(params.leagueId, { phase: 'all' });
    const standingsById = new Map<string, TeamStandingRow>(standings.map(s => [s.id, s]));

    // Fetch teams keyed by id, then return them in the order standings dictates.
    const teamRows = db.select().from(schema.teams)
      .where(eq(schema.teams.leagueId, params.leagueId))
      .all();
    const teamById = new Map(teamRows.map(t => [t.id, t]));
    const orderedTeams = standings.map(s => teamById.get(s.id)).filter((t): t is NonNullable<typeof t> => !!t);

    // Pre-fetch username + accent colors + avatar for all teams' coaches in one
    // query — avoids an N+1 lookup when CoachLink needs them.
    const userIds = orderedTeams.map(t => t.userId).filter((u): u is number => u != null);
    const userRows = userIds.length > 0
      ? db.select({
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatarPath: schema.users.avatarPath,
          primaryColor: schema.users.primaryColor,
          secondaryColor: schema.users.secondaryColor,
          tertiaryColor: schema.users.tertiaryColor,
          role: schema.users.role,
        }).from(schema.users)
          .where(sql`${schema.users.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`)
          .all()
      : [];
    const userById = new Map(userRows.map(u => [u.id, u]));

    return orderedTeams.map(team => {
      const standing = standingsById.get(team.id)!;
      const roster = db.select().from(schema.rosters)
        .where(eq(schema.rosters.teamId, team.id))
        .all();
      const owner = team.userId != null ? userById.get(team.userId) : undefined;

      const wins = standing.wins;
      const losses = standing.losses;
      const differential = standing.differential;

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
          nickname: r.nickname ?? null,
          rosterId: r.id,
          types: pokemon ? [pokemon.type1, pokemon.type2].filter(Boolean).map(t => t!.toLowerCase()) : [],
          // Surface the snapshotted cost (what the team actually paid) so totals
          // don't shift when admins re-tier a Pokemon mid-season.
          tier: r.costAtDraft || r.tier,
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
        logoPath: team.logoPath,
        bannerPath: team.bannerPath,
        bio: team.bio,
        captainNote: team.captainNote,
        userId: team.userId,
        // Coach identity (joined from users table) — used by <CoachLink>
        // to render accent gradients, avatars, and link to /coach/:username.
        owner: owner ? {
          username: owner.username,
          displayName: owner.displayName,
          avatarPath: owner.avatarPath,
          primaryColor: owner.primaryColor,
          secondaryColor: owner.secondaryColor,
          tertiaryColor: owner.tertiaryColor,
          role: owner.role,
        } : null,
        captainsLocked: !!team.captainsLocked,
        record: {
          wins,
          losses,
          differential,
          kills: standing.kills,
          deaths: standing.deaths,
        },
        tiebreaker: standing.tiebreaker,
        roster: enrichedRoster,
      };
    });
  })

  // ─── Schedule ────────────────────────────────────────────────────────

  .get('/api/leagues/:leagueId/schedule', ({ params }) => {
    const matches = db.select().from(schema.matches)
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
        // True when a battle log is stored, even if there's no live PS room
        // URL (imported replays). The in-site viewer plays by match id.
        hasReplay: m.replayLog != null,
        status: m.status,
        phase: m.phase,
        playoffRound: m.playoffRound,
        homeSeed: m.homeSeed,
        awaySeed: m.awaySeed,
      }));
    const byes = db.select().from(schema.byeWeeks)
      .where(eq(schema.byeWeeks.leagueId, params.leagueId))
      .orderBy(asc(schema.byeWeeks.week))
      .all()
      .map(b => ({ week: b.week, teamId: b.teamId }));
    return { matches, byes };
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

  .get('/api/leagues/:leagueId/stats', ({ params }) => {
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
  });
