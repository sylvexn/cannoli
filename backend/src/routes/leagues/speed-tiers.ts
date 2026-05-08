import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, inArray, desc } from 'drizzle-orm';

/**
 * Build the per-row payload from a (rosters, teams, leagues, pokemon) join.
 * Returns one row per rostered Pokemon with the data the frontend needs to
 * compute adjusted speed under user-controlled assumptions (item, ability,
 * nature, weather, stage, Trick Room).
 *
 * Computation is deliberately client-side so toggles update with zero RTT —
 * the endpoint just returns the static reference data plus owner identity.
 */
function buildSpeedRows(leagueIds: string[]) {
  if (leagueIds.length === 0) return [];

  const teams = db.select().from(schema.teams)
    .where(inArray(schema.teams.leagueId, leagueIds))
    .all();
  if (teams.length === 0) return [];

  const leagues = db.select().from(schema.leagues)
    .where(inArray(schema.leagues.id, leagueIds))
    .all();
  const leagueById = new Map(leagues.map(l => [l.id, l]));

  const teamById = new Map(teams.map(t => [t.id, t]));
  const teamIds = teams.map(t => t.id);

  const rosters = db.select().from(schema.rosters)
    .where(inArray(schema.rosters.teamId, teamIds))
    .all();
  if (rosters.length === 0) return [];

  const names = Array.from(new Set(rosters.map(r => r.pokemonName)));
  const pokemonRows = db.select().from(schema.pokemon)
    .where(inArray(schema.pokemon.name, names))
    .all();
  const pokeByName = new Map(pokemonRows.map(p => [p.name, p]));

  return rosters.map(r => {
    const p = pokeByName.get(r.pokemonName);
    const team = teamById.get(r.teamId);
    const league = team ? leagueById.get(team.leagueId) : undefined;
    const abilities = p
      ? [p.ability1, p.ability2, p.hiddenAbility].filter((a): a is string => !!a)
      : [];
    return {
      // Composite id includes leagueId so cross-league rows don't collide.
      id: `${team?.leagueId ?? ''}:${r.teamId}:${r.pokemonName}`,
      name: r.pokemonName,
      nickname: r.nickname ?? null,
      dex: p?.nationalDexNumber ?? null,
      baseSpeed: p?.spe ?? 0,
      type1: p?.type1 ?? null,
      type2: p?.type2 ?? null,
      tier: r.costAtDraft || r.tier,
      isTeraCaptain: !!r.isTeraCaptain,
      abilities,
      league: league
        ? { id: league.id, name: league.name, color: league.color }
        : null,
      owner: team
        ? {
            teamId: team.id,
            teamAbbrev: team.teamAbbrev,
            teamName: team.teamName,
            teamColor: team.teamColor,
            logoPath: team.logoPath,
          }
        : null,
    };
  });
}

/** Resolve the active season's league IDs for the global endpoint default. */
function getActiveLeagueIds(): string[] {
  const season = db.select().from(schema.seasons)
    .orderBy(desc(schema.seasons.seasonNumber))
    .get();
  if (!season) return [];
  const leagues = db.select().from(schema.leagues)
    .where(eq(schema.leagues.seasonId, season.id))
    .all();
  return leagues.map(l => l.id);
}

export const speedTierRoutes = new Elysia()
  /**
   * GET /api/leagues/:leagueId/speed-tiers
   * Per-league speed tiers (legacy callsite — kept for backwards compat).
   */
  .get('/api/leagues/:leagueId/speed-tiers', ({ params }) => {
    return buildSpeedRows([params.leagueId]);
  })

  /**
   * GET /api/speed-tiers
   * Global speed tiers across every active-season league. Frontend filters
   * by league client-side via chip selectors.
   */
  .get('/api/speed-tiers', () => {
    const ids = getActiveLeagueIds();
    return buildSpeedRows(ids);
  })

  /**
   * GET /api/pokemon/:name/global-ownership
   * Per-active-league ownership for a single Pokemon. Returns one entry per
   * league that has the Pokemon rostered; empty array means free agent.
   */
  .get('/api/pokemon/:name/global-ownership', ({ params }) => {
    const ids = getActiveLeagueIds();
    if (ids.length === 0) return [];

    const teams = db.select().from(schema.teams)
      .where(inArray(schema.teams.leagueId, ids))
      .all();
    if (teams.length === 0) return [];

    const teamById = new Map(teams.map(t => [t.id, t]));
    const teamIds = teams.map(t => t.id);

    const rosters = db.select().from(schema.rosters)
      .where(inArray(schema.rosters.teamId, teamIds))
      .all();
    const matches = rosters.filter(r => r.pokemonName === params.name);
    if (matches.length === 0) return [];

    const leagues = db.select().from(schema.leagues)
      .where(inArray(schema.leagues.id, ids))
      .all();
    const leagueById = new Map(leagues.map(l => [l.id, l]));

    return matches.map(r => {
      const team = teamById.get(r.teamId);
      if (!team) return null;
      const league = leagueById.get(team.leagueId);
      if (!league) return null;
      return {
        leagueId: league.id,
        leagueName: league.name,
        leagueColor: league.color,
        owner: {
          teamId: team.id,
          teamAbbrev: team.teamAbbrev,
          teamName: team.teamName,
          teamColor: team.teamColor,
          logoPath: team.logoPath,
        },
        isTeraCaptain: !!r.isTeraCaptain,
        nickname: r.nickname ?? null,
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  });
