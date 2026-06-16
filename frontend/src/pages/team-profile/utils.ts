import type { PokemonType } from '@/lib/pokemon';
import { POKEMON_TYPES } from '@/lib/pokemon';
import type { Player, RosterPokemon } from '@/lib/types';
import { getTierList, type CostFormat } from '@/data/tier-list';
import { TYPE_CHART } from '@/lib/type-effectiveness';

// ─── Interfaces ──────────────────────────────────────────────────
export interface TypeHit { name: string; mult: number }
export interface TypeProfileEntry {
  x4: TypeHit[];   // 4x super effective
  x2: TypeHit[];   // 2x super effective
  x05: TypeHit[];  // 0.5x resist
  x025: TypeHit[]; // 0.25x resist
  x0: TypeHit[];   // 0x immune
}

export interface PoolEntry { name: string; tier: number; teraCost: number; drafted: boolean; draftedBy?: string }

export interface SwapEntry {
  index: number;
  original: RosterPokemon;
  replacement: RosterPokemon;
}

export interface TeraEdit {
  name: string;
  isTeraCaptain: boolean;
  teraTypes: PokemonType[];
}

// ─── Helpers ─────────────────────────────────────────────────────
export function getTeamDefensiveProfile(roster: RosterPokemon[]) {
  const profile: Record<PokemonType, TypeProfileEntry> = {} as any;
  for (const t of POKEMON_TYPES) profile[t] = { x4: [], x2: [], x05: [], x025: [], x0: [] };

  for (const mon of roster) {
    const effective: Record<PokemonType, number> = {} as any;
    for (const t of POKEMON_TYPES) effective[t] = 1;

    for (const monType of mon.types) {
      const chart = TYPE_CHART[monType];
      for (const w of chart.weak) effective[w] *= 2;
      for (const r of chart.resist) effective[r] *= 0.5;
      for (const i of chart.immune) effective[i] *= 0;
    }

    for (const t of POKEMON_TYPES) {
      const m = effective[t];
      const hit = { name: mon.name, mult: m };
      if (m === 0) profile[t].x0.push(hit);
      else if (m >= 4) profile[t].x4.push(hit);
      else if (m >= 2) profile[t].x2.push(hit);
      else if (m <= 0.25) profile[t].x025.push(hit);
      else if (m <= 0.5) profile[t].x05.push(hit);
    }
  }
  return profile;
}

export function computePool(allPlayers: Player[], format?: CostFormat): PoolEntry[] {
  const draftedMap = new Map<string, string>();
  for (const p of allPlayers) {
    for (const mon of p.roster) draftedMap.set(mon.name, p.teamAbbrev);
  }
  return getTierList(format)
    .map(entry => ({
      name: entry.name,
      tier: entry.tier,
      teraCost: entry.teraCost,
      drafted: draftedMap.has(entry.name),
      draftedBy: draftedMap.get(entry.name),
    }))
    .sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
}

export function freeAgentToRoster(fa: { name: string; tier: number }): RosterPokemon {
  return {
    name: fa.name,
    tier: fa.tier,
    types: [], // Would come from a Pokemon data API
    isTeraCaptain: false,
    stats: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    abilities: [],
    seasonStats: { kills: 0, deaths: 0, gp: 0 },
  };
}
