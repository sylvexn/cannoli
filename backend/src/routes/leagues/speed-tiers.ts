import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, inArray, desc, sql } from 'drizzle-orm';

/**
 * Ownership entry for a single Pokemon — one per (league, team) it's rostered
 * on. The frontend renders these as gem chips so a single mon row can show
 * cross-league coverage at a glance.
 */
interface Ownership {
  leagueId: string;
  leagueName: string;
  leagueColor: string;
  teamId: string;
  teamAbbrev: string;
  teamName: string;
  teamColor: string;
  coachName: string;
  logoPath: string | null;
  isTeraCaptain: boolean;
  nickname: string | null;
}

/**
 * Build deduped speed-tier rows for the given leagues.
 *
 * One row per unique Pokemon (by `pokemon.name`, which is unique and already
 * encodes form — "Charizard", "Charizard-Mega-Y", "Tauros-Paldea-Combat",
 * etc.). Each row carries an `ownerships` array listing every (league, team)
 * the mon is rostered on within the supplied league set.
 *
 * Pokemon NOT drafted in any of the supplied leagues still appear with
 * `ownerships: []` so the speed-tier table doubles as a free-agent browser.
 *
 * Computation is deliberately client-side so toggles (item, ability, nature,
 * weather, stage, Trick Room) update with zero RTT.
 */
function buildSpeedRows(leagueIds: string[]) {
  // Always source the canonical Pokemon list — even with no leagues we want
  // a full undrafted dex. The "(T)" suffix rows are tera-captain duplicates
  // imported from the source XLSX (same species, just marked as captain via
  // the suffix); the speed table treats captains via per-row metadata, so
  // strip them here to avoid every species rendering twice.
  const pokemonRows = db.select().from(schema.pokemon)
    .where(sql`${schema.pokemon.name} NOT LIKE '%(T)'`)
    .all();

  // Build the ownerships map keyed by pokemonName.
  const ownershipsByName = new Map<string, Ownership[]>();

  if (leagueIds.length > 0) {
    const teams = db.select().from(schema.teams)
      .where(inArray(schema.teams.leagueId, leagueIds))
      .all();
    if (teams.length > 0) {
      const leagues = db.select().from(schema.leagues)
        .where(inArray(schema.leagues.id, leagueIds))
        .all();
      const leagueById = new Map(leagues.map(l => [l.id, l]));
      const teamById = new Map(teams.map(t => [t.id, t]));
      const teamIds = teams.map(t => t.id);

      const rosters = db.select().from(schema.rosters)
        .where(inArray(schema.rosters.teamId, teamIds))
        .all();

      for (const r of rosters) {
        const team = teamById.get(r.teamId);
        if (!team) continue;
        const league = leagueById.get(team.leagueId);
        if (!league) continue;

        const entry: Ownership = {
          leagueId: league.id,
          leagueName: league.name,
          leagueColor: league.color,
          teamId: team.id,
          teamAbbrev: team.teamAbbrev,
          teamName: team.teamName,
          teamColor: team.teamColor,
          coachName: team.coachName,
          logoPath: team.logoPath,
          isTeraCaptain: !!r.isTeraCaptain,
          nickname: r.nickname ?? null,
        };

        const list = ownershipsByName.get(r.pokemonName);
        if (list) list.push(entry);
        else ownershipsByName.set(r.pokemonName, [entry]);
      }
    }
  }

  return pokemonRows.map(p => {
    const ownerships = ownershipsByName.get(p.name) ?? [];
    const abilities = [p.ability1, p.ability2, p.hiddenAbility]
      .filter((a): a is string => !!a);
    // True if the mon is a captain on ANY league — used for the Sparkles glyph
    // next to its name. Per-league captain status still lives on each
    // ownership entry for finer rendering if needed.
    const isTeraCaptain = ownerships.some(o => o.isTeraCaptain);
    return {
      // Stable id = pokemon name (unique). Drops the leagueId/teamId composite
      // since rows are now per-mon, not per-roster-entry.
      id: p.name,
      name: p.name,
      dex: p.nationalDexNumber ?? null,
      baseSpeed: p.spe ?? 0,
      type1: p.type1 ?? null,
      type2: p.type2 ?? null,
      tier: p.tier,
      formCategory: p.formCategory,
      isTeraCaptain,
      abilities,
      ownerships,
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
   * Still returns the deduped shape, but ownerships will only ever reference
   * the one league.
   */
  .get('/api/leagues/:leagueId/speed-tiers', ({ params }) => {
    return buildSpeedRows([params.leagueId]);
  })

  /**
   * GET /api/speed-tiers
   * Global speed tiers across every active-season league. One row per unique
   * Pokemon; each row's `ownerships` lists every (league, team) the mon is
   * rostered on. Mons not drafted anywhere still appear with empty ownerships.
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
