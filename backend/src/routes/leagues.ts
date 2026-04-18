import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, sql, asc, desc, inArray } from 'drizzle-orm';
import { isStaff } from '../lib/auth';
import { tx } from '../lib/tx';
import { effectiveCost } from '../lib/tera-cost';
import { computeStandings, type TeamStandingRow } from '../lib/standings';

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
      playoffTeamCount: l.playoffTeamCount,
      // Lifecycle fields are per-league (3 leagues run independently per
      // season). Surfaced under `season` for backwards-compat with all
      // existing frontend readers; the underlying source of truth is the
      // league row.
      playoffTeamCount: l.playoffTeamCount,
      season: season ? {
        id: `s${season.seasonNumber}`,
        seasonNumber: season.seasonNumber,
        phase: l.phase,
        currentWeek: l.currentWeek,
        totalWeeks: l.totalWeeks,
        pointCap: season.pointCap,
        teraCaptainSlots: season.teraCaptainSlots,
        tradeDeadlineWeek: l.tradeDeadlineWeek,
        rosterSize: l.rosterSize,
        forfeitPolicy: l.forfeitPolicy,
        paused: l.paused,
        weekDates: l.weekDates ? JSON.parse(l.weekDates) : null,
        archived: !!season.archived,
      } : null,
    }));
  })

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
        showdownUsername: team.showdownUsername,
        logoPath: team.logoPath,
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
      faDeadlineWeek: row.faDeadlineWeek ?? 7,
      defaultPlayoffTeamCount: row.defaultPlayoffTeamCount ?? 6,
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

    // Get league + season config (phase lives on league; captain slot limit lives on season).
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, team.leagueId)).get();
    const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;

    // Phase gate: captain assignments lock once the league enters regular play.
    // Allowed during predraft (pre-draft prep) and draft (live drafting); rejected
    // for regular/playoffs/offseason. Locking is per-league.
    if (league && (league.phase === 'regular' || league.phase === 'playoffs' || league.phase === 'offseason')) {
      set.status = 409;
      return {
        error: `Tera captains are locked once the draft ends (current phase: ${league.phase})`,
        code: 'captains_locked',
        phase: league.phase,
      };
    }

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
    // Use costAtDraft (snapshot) so admin tier-list edits between draft end and
    // captain reassignment don't unexpectedly bust the point cap.
    const totalCost = roster.reduce(
      (sum, r) => sum + effectiveCost(r.costAtDraft || r.tier, captainSet.has(r.pokemonName)),
      0,
    );
    const cap = season?.pointCap ?? 110;
    if (totalCost > cap) {
      set.status = 400;
      return { error: `Tera captain markup would exceed point cap (${totalCost} > ${cap})`, code: 'POINT_CAP_EXCEEDED' };
    }

    // Determine whether this save should also LOCK captains (and potentially
    // advance the league phase). Locking is triggered when:
    //   1. The league is in phase=draft AND the draft itself has completed
    //      (= the post-draft captain gate is open), AND
    //   2. The team has saved exactly `teraCaptainSlots` captains (full set).
    // Locking flips the `captainsLocked` flag on the team. Once every team in
    // the league is locked, we advance phase → regular and currentWeek → 1.
    const draftStateRow = db.select().from(schema.draftState)
      .where(eq(schema.draftState.leagueId, team.leagueId))
      .get();
    const inCaptainGate = league?.phase === 'draft' && draftStateRow?.status === 'completed';
    const willLock = inCaptainGate && captains.length === maxCaptains;

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

      let phaseAdvanced = false;
      if (willLock) {
        db.update(schema.teams)
          .set({ captainsLocked: true })
          .where(eq(schema.teams.id, params.teamId))
          .run();

        // If every team in this league is now locked, transition to regular.
        const remaining = db.select({ id: schema.teams.id })
          .from(schema.teams)
          .where(and(
            eq(schema.teams.leagueId, team.leagueId),
            eq(schema.teams.captainsLocked, false),
          ))
          .all();
        if (remaining.length === 0) {
          db.update(schema.leagues)
            .set({ phase: 'regular', currentWeek: 1 })
            .where(eq(schema.leagues.id, team.leagueId))
            .run();
          phaseAdvanced = true;
          db.insert(schema.activityLog).values({
            type: 'league_phase_advanced',
            category: 'config',
            actor: 'system',
            leagueId: team.leagueId,
            description: `${league!.name} advanced from draft → regular (all captains locked)`,
            metadata: JSON.stringify({ leagueId: team.leagueId, fromPhase: 'draft', toPhase: 'regular' }),
          }).run();
        }
      }

      // Log tera change transaction
      if (league) {
        const week = league.currentWeek ?? 0;
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
          type: willLock ? 'tera_captains_locked' : 'tera_captains_updated',
          category: 'team',
          actor: user.username,
          leagueId: team.leagueId,
          description: willLock
            ? `Locked tera captains: ${captains.map(c => c.pokemonName).join(', ')}`
            : `Updated tera captains: ${captains.map(c => c.pokemonName).join(', ')}`,
          metadata: JSON.stringify({ teamId: params.teamId, captains, locked: willLock }),
        }).run();
      }

      return {
        success: true,
        captainsLocked: willLock,
        phaseAdvanced,
      };
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
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const { teamId, pokemonName, dropPokemonName } = body as {
      teamId: string;
      pokemonName: string;
      dropPokemonName?: string;
    };

    if (!teamId || !pokemonName) {
      set.status = 400;
      return { error: 'teamId and pokemonName required' };
    }

    // Resolve target team (whichever teamId was supplied — including a staff
    // override). Always assert the resolved team belongs to the path league
    // before mutating rosters/transactions, even though staff may override
    // `teamId` in the body.
    const team = db.select().from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    if (team.leagueId !== params.leagueId) {
      set.status = 400;
      return { error: 'Team does not belong to this league', code: 'team_league_mismatch' };
    }

    // Authorization: staff can pick up onto any team; otherwise the caller must
    // own the target team (and can only act on their own team).
    if (!isStaff(user) && team.userId !== parseInt(user.id)) {
      set.status = 403;
      return { error: 'Not your team' };
    }

    // Verify pokemon exists, is draftable (tier > 0), and isn't banned
    const pkmn = db.select().from(schema.pokemon).where(eq(schema.pokemon.name, pokemonName)).get();
    if (!pkmn) { set.status = 404; return { error: 'Pokemon not found' }; }
    if (pkmn.tier <= 0) { set.status = 400; return { error: `${pokemonName} is not draftable` }; }
    if (pkmn.banned) { set.status = 400; return { error: `${pokemonName} is banned` }; }

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
    const week = league?.currentWeek ?? 0;

    // ── Phase / deadline gate ──
    // - predraft / draft / offseason: drafting is the pickup mechanism; if hit,
    //   allow (no-op gate, explicit per spec).
    // - regular: blocked once currentWeek > faDeadlineWeek (site setting).
    // - playoffs: always blocked, no FA in playoffs.
    if (league) {
      if (league.phase === 'playoffs') {
        set.status = 409;
        return { error: 'Free agent pickups are closed during playoffs', code: 'fa_playoffs_closed' };
      }
      if (league.phase === 'regular') {
        const settings = db.select().from(schema.siteSettings).get();
        const faDeadline = settings?.faDeadlineWeek ?? 7;
        if (week > faDeadline) {
          set.status = 409;
          return {
            error: `Free agent deadline has passed (week ${faDeadline}, current week ${week})`,
            code: 'fa_deadline_passed',
            faDeadlineWeek: faDeadline,
            currentWeek: week,
          };
        }
      }
    }

    try {
      return tx(() => {
        // Drop pokemon if specified — fail loudly if the named mon isn't on
        // the team. Previously this silently no-op'd, letting the pickup
        // succeed and bust the point cap.
        if (dropPokemonName) {
          const droppedRow = db.select().from(schema.rosters)
            .where(and(
              eq(schema.rosters.teamId, teamId),
              eq(schema.rosters.pokemonName, dropPokemonName),
            ))
            .get();
          if (!droppedRow) {
            throw Object.assign(new Error(`${dropPokemonName} is not on ${team.teamName}'s roster`), { _status: 400, _code: 'fa_drop_not_found' });
          }
          db.delete(schema.rosters)
            .where(eq(schema.rosters.id, droppedRow.id))
            .run();

          // Drop also clears any trade-block listing on that mon for this
          // team — they no longer own it.
          db.delete(schema.tradeBlockListings)
            .where(and(
              eq(schema.tradeBlockListings.leagueId, params.leagueId),
              eq(schema.tradeBlockListings.teamId, teamId),
              eq(schema.tradeBlockListings.pokemonName, dropPokemonName),
            ))
            .run();
        }

        // Add new pokemon to roster — snapshot costAtDraft so later admin
        // tier-list edits don't retroactively rewrite this team's point total.
        db.insert(schema.rosters).values({
          teamId,
          pokemonName,
          tier: pkmn.tier,
          costAtDraft: pkmn.tier,
          acquiredVia: 'fa',
          acquiredWeek: week,
        }).run();

        // ── Post-swap roster legality re-check ──
        // Re-run the same invariants that draft/trade enforce against the
        // resulting roster. Must abort the tx on any violation.
        const newRoster = db.select().from(schema.rosters)
          .where(eq(schema.rosters.teamId, teamId))
          .all();

        // Roster size cap. Must NOT exceed league.rosterSize. Teams may sit
        // below the cap (e.g. mid-recovery from a release), but a pickup
        // that would push them over requires a paired drop.
        if (league && newRoster.length > league.rosterSize) {
          throw Object.assign(
            new Error(`Pickup would put roster at ${newRoster.length} (max ${league.rosterSize}) — a drop is required`),
            { _status: 400, _code: 'fa_roster_size_exceeded' },
          );
        }

        // Pull pokemon metadata for mega + dex checks
        const newPokemonRows = db.select().from(schema.pokemon)
          .where(inArray(schema.pokemon.name, newRoster.map(r => r.pokemonName)))
          .all();
        const pokeByName = new Map(newPokemonRows.map(p => [p.name, p]));

        // Mega cap (max 1 per team)
        let megaCount = 0;
        for (const r of newRoster) {
          if (pokeByName.get(r.pokemonName)?.formCategory === 'mega') megaCount++;
        }
        if (megaCount > 1) {
          throw Object.assign(
            new Error(`Adding ${pokemonName} would put 2 Megas on the team (max 1)`),
            { _status: 400, _code: 'fa_mega_cap' },
          );
        }

        // Duplicate national dex
        const dexSeen = new Map<number, string>();
        for (const r of newRoster) {
          const dex = pokeByName.get(r.pokemonName)?.nationalDexNumber;
          if (dex == null) continue;
          const prev = dexSeen.get(dex);
          if (prev) {
            throw Object.assign(
              new Error(`${prev} and ${r.pokemonName} share National Dex #${dex}`),
              { _status: 400, _code: 'fa_dup_natdex' },
            );
          }
          dexSeen.set(dex, r.pokemonName);
        }

        // Point cap including captain markup. Use costAtDraft (snapshot).
        const pointCap = season?.pointCap ?? 110;
        const totalCost = newRoster.reduce(
          (sum, r) => sum + effectiveCost(r.costAtDraft || r.tier, !!r.isTeraCaptain),
          0,
        );
        if (totalCost > pointCap) {
          throw Object.assign(
            new Error(`Pickup would exceed point cap (${totalCost} > ${pointCap}) including captain markup`),
            { _status: 400, _code: 'fa_over_cap' },
          );
        }

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

        // Activity log — category 'fa' so the activity feed/filters can
        // distinguish FA movement from trades. (Type 'fa_pickup' was
        // mismatched against category 'trade' historically.)
        db.insert(schema.activityLog).values({
          type: 'fa_pickup',
          category: 'fa',
          actor: user.username,
          leagueId: params.leagueId,
          description: `FA: ${team.teamName} picked up ${pokemonName}${dropPokemonName ? `, dropped ${dropPokemonName}` : ''}`,
          metadata: JSON.stringify({ teamId, pokemonName, dropPokemonName }),
        }).run();

        return { success: true };
      });
    } catch (e: any) {
      if (e?._status) {
        set.status = e._status;
        return { error: e.message, code: e._code };
      }
      throw e;
    }
  })

  // Standalone release (drop only) — no pickup paired. Same phase + deadline
  // gating as pickup. Used by the team-profile "Release" button.
  .post('/api/leagues/:leagueId/free-agents/release', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const { teamId, pokemonName } = body as { teamId: string; pokemonName: string };
    if (!teamId || !pokemonName) {
      set.status = 400;
      return { error: 'teamId and pokemonName required' };
    }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    if (team.leagueId !== params.leagueId) {
      set.status = 400;
      return { error: 'Team does not belong to this league', code: 'team_league_mismatch' };
    }
    if (!isStaff(user) && team.userId !== parseInt(user.id)) {
      set.status = 403; return { error: 'Not your team' };
    }

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    const week = league?.currentWeek ?? 0;

    // Mirror pickup gating: no FA in playoffs, deadline-gated in regular.
    if (league) {
      if (league.phase === 'playoffs') {
        set.status = 409;
        return { error: 'Free agent moves are closed during playoffs', code: 'fa_playoffs_closed' };
      }
      if (league.phase === 'regular') {
        const settings = db.select().from(schema.siteSettings).get();
        const faDeadline = settings?.faDeadlineWeek ?? 7;
        if (week > faDeadline) {
          set.status = 409;
          return {
            error: `Free agent deadline has passed (week ${faDeadline}, current week ${week})`,
            code: 'fa_deadline_passed',
          };
        }
      }
    }

    const rosterRow = db.select().from(schema.rosters)
      .where(and(eq(schema.rosters.teamId, teamId), eq(schema.rosters.pokemonName, pokemonName)))
      .get();
    if (!rosterRow) {
      set.status = 400;
      return { error: `${pokemonName} is not on ${team.teamName}'s roster`, code: 'fa_drop_not_found' };
    }

    return tx(() => {
      db.delete(schema.rosters).where(eq(schema.rosters.id, rosterRow.id)).run();

      // Clear any trade-block listing on the released mon for this team
      db.delete(schema.tradeBlockListings)
        .where(and(
          eq(schema.tradeBlockListings.leagueId, params.leagueId),
          eq(schema.tradeBlockListings.teamId, teamId),
          eq(schema.tradeBlockListings.pokemonName, pokemonName),
        ))
        .run();

      db.insert(schema.transactions).values({
        leagueId: params.leagueId,
        week,
        type: 'fa',
        teamId,
        pokemonOut: pokemonName,
        pointsOut: rosterRow.costAtDraft || rosterRow.tier,
      }).run();

      db.insert(schema.activityLog).values({
        type: 'fa_release',
        category: 'fa',
        actor: user.username,
        leagueId: params.leagueId,
        description: `FA: ${team.teamName} released ${pokemonName}`,
        metadata: JSON.stringify({ teamId, pokemonName }),
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
