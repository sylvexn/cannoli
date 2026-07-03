import type { RosterPokemon } from './types';
import type { PokemonType } from './pokemon';

/**
 * Structural shape of an API roster entry as returned by
 * `GET /api/leagues/:id/teams` (`ApiRosterPokemon` in lib/api.ts). Kept
 * structural/loose here so both the site's matchup center and the Showdown
 * matchup plugin can feed it without importing the full api module for types.
 */
export interface ApiRosterEntry {
  name: string;
  nickname?: string | null;
  types: string[];
  tier: number;
  isTeraCaptain: boolean;
  teraTypes?: string[];
  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } | null;
  abilities: string[];
  seasonStats: { kills: number; deaths: number; gp: number };
  isShiny?: boolean;
}

/**
 * Structural shape of a `GET /api/pokemon/:name` row (`getPokemonByName` in
 * lib/api.ts) — the reference table, not a league roster entry.
 */
export interface ApiPokemonRow {
  name: string;
  type1: string;
  type2: string | null;
  hp: number; atk: number; def: number; spa: number; spd: number; spe: number;
  ability1: string | null;
  ability2: string | null;
  hiddenAbility: string | null;
  tier: number;
}

/**
 * Map a Pokemon reference row to the UI's `RosterPokemon` shape (no league
 * context: never a tera captain, zeroed season stats). Single shared copy —
 * used by the site's custom team builder and the Showdown matchup plugin's
 * teambuilder bridge, so the mapping never drifts.
 */
export function rosterMonFromPokemonRow(data: ApiPokemonRow): RosterPokemon {
  return {
    name: data.name,
    types: [
      data.type1.toLowerCase(),
      ...(data.type2 ? [data.type2.toLowerCase()] : []),
    ] as PokemonType[],
    tier: data.tier,
    isTeraCaptain: false,
    stats: { hp: data.hp, atk: data.atk, def: data.def, spa: data.spa, spd: data.spd, spe: data.spe },
    abilities: [data.ability1, data.ability2, data.hiddenAbility].filter(Boolean) as string[],
    seasonStats: { kills: 0, deaths: 0, gp: 0 },
  };
}

/**
 * Map an API roster payload to the UI's `RosterPokemon` shape.
 * Single shared copy — used by the site's Matchup Center (index + team picker)
 * and the Showdown-native matchup plugin, so the mapping never drifts.
 */
export function rosterFromApi(roster: ApiRosterEntry[]): RosterPokemon[] {
  return roster.map(r => ({
    name: r.name,
    nickname: r.nickname,
    types: r.types as PokemonType[],
    tier: r.tier,
    isTeraCaptain: r.isTeraCaptain,
    teraTypes: r.teraTypes as PokemonType[] | undefined,
    stats: r.stats || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    abilities: r.abilities,
    seasonStats: r.seasonStats,
    isShiny: r.isShiny,
  }));
}
