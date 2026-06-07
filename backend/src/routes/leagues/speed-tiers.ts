import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, inArray } from 'drizzle-orm';

/**
 * GET /api/leagues/:leagueId/speed-tiers
 *
 * Flat array of every rostered Pokemon in the league with the data the
 * frontend needs to compute adjusted speed under user-controlled assumptions
 * (item, ability, nature, weather, stage, Trick Room).
 *
 * Computation is deliberately client-side so toggles (weather / scarf-all /
 * +Speed-all / stage / Trick Room) update with zero RTT — the endpoint just
 * returns the static reference data plus owner identity per row.
 */
export const speedTierRoutes = new Elysia()
  .get('/api/leagues/:leagueId/speed-tiers', ({ params }) => {
    const teams = db.select().from(schema.teams)
      .where(eq(schema.teams.leagueId, params.leagueId))
      .all();
    if (teams.length === 0) return [];

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
      const abilities = p
        ? [p.ability1, p.ability2, p.hiddenAbility].filter((a): a is string => !!a)
        : [];
      return {
        // Use teamId+name as a stable composite id (rosters.id can churn).
        id: `${r.teamId}:${r.pokemonName}`,
        name: r.pokemonName,
        nickname: r.nickname ?? null,
        dex: p?.nationalDexNumber ?? null,
        baseSpeed: p?.spe ?? 0,
        type1: p?.type1 ?? null,
        type2: p?.type2 ?? null,
        tier: r.costAtDraft || r.tier,
        isTeraCaptain: !!r.isTeraCaptain,
        abilities,
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
  });
