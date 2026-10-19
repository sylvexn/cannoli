/**
 * Draft Center picks ⇄ the app-wide RosterPokemon shape, so the existing
 * Matchup Center analysis panels can render Draft Center teams unchanged.
 */
import { getPokemonData } from '@/data/pokemon-data';
import { getTierEntry, getTierList, getBanned, type CostFormat } from '@/data/tier-list';
import type { RosterPokemon } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';
import type { DcMon } from './types';
import { DEFAULT_RULESET, type Ruleset } from './ruleset';

const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

export function monToRoster(m: DcMon, format: CostFormat = DEFAULT_RULESET.costFormat): RosterPokemon {
  const d = getPokemonData(m.name);
  const all = d?.abilities ?? [];
  // The chosen ability goes first — type-chart ability immunities read abilities[0].
  const chosen = m.set?.ability;
  const abilities = chosen ? [chosen, ...all.filter(a => a !== chosen)] : all;
  return {
    name: m.name,
    types: d?.types ?? [],
    tier: getTierEntry(m.name, format)?.tier ?? 0,
    isTeraCaptain: m.captain,
    teraTypes: m.captain ? m.teraTypes : undefined,
    stats: d?.stats ?? ZERO,
    abilities,
    seasonStats: { kills: 0, deaths: 0, gp: 0 },
  };
}

export const teamToRoster = (roster: DcMon[], rs: Ruleset): RosterPokemon[] =>
  roster.map(m => monToRoster(m, rs.costFormat));

/** Roster entries (RosterPokemon-ish, as returned by league/team APIs) → picks. */
export function picksFromRoster(
  roster: { name: string; isTeraCaptain: boolean; teraTypes?: string[] }[],
): DcMon[] {
  return roster.map(r => ({
    name: r.name,
    captain: r.isTeraCaptain,
    teraTypes: r.isTeraCaptain ? ((r.teraTypes ?? []) as PokemonType[]).slice(0, 3) : [],
  }));
}

export interface PoolEntry { name: string; tier: number; banned: boolean }

const poolCache = new Map<CostFormat, PoolEntry[]>();

/** Every pickable species for a format (tier list + banned), for the picker. */
export function poolFor(format: CostFormat): PoolEntry[] {
  let p = poolCache.get(format);
  if (!p) {
    p = [
      ...getTierList(format).map(e => ({ name: e.name, tier: e.tier, banned: false })),
      ...getBanned(format).map(name => ({ name, tier: getTierEntry(name, format)?.tier ?? 0, banned: true })),
    ];
    poolCache.set(format, p);
  }
  return p;
}
