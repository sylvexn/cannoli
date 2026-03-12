import type { PokemonType } from './pokemon';
import { POKEMON_TYPES } from './pokemon';

/** Defensive type chart: what each type is weak to, resists, and immune to */
export const TYPE_CHART: Record<PokemonType, { weak: PokemonType[]; resist: PokemonType[]; immune: PokemonType[] }> = {
  normal: { weak: ['fighting'], resist: [], immune: ['ghost'] },
  fire: { weak: ['water', 'ground', 'rock'], resist: ['fire', 'grass', 'ice', 'bug', 'steel', 'fairy'], immune: [] },
  water: { weak: ['electric', 'grass'], resist: ['fire', 'water', 'ice', 'steel'], immune: [] },
  electric: { weak: ['ground'], resist: ['electric', 'flying', 'steel'], immune: [] },
  grass: { weak: ['fire', 'ice', 'poison', 'flying', 'bug'], resist: ['water', 'electric', 'grass', 'ground'], immune: [] },
  ice: { weak: ['fire', 'fighting', 'rock', 'steel'], resist: ['ice'], immune: [] },
  fighting: { weak: ['flying', 'psychic', 'fairy'], resist: ['bug', 'rock', 'dark'], immune: [] },
  poison: { weak: ['ground', 'psychic'], resist: ['fighting', 'poison', 'bug', 'grass', 'fairy'], immune: [] },
  ground: { weak: ['water', 'grass', 'ice'], resist: ['poison', 'rock'], immune: ['electric'] },
  flying: { weak: ['electric', 'ice', 'rock'], resist: ['fighting', 'bug', 'grass'], immune: ['ground'] },
  psychic: { weak: ['bug', 'ghost', 'dark'], resist: ['fighting', 'psychic'], immune: [] },
  bug: { weak: ['fire', 'flying', 'rock'], resist: ['fighting', 'ground', 'grass'], immune: [] },
  rock: { weak: ['water', 'grass', 'fighting', 'ground', 'steel'], resist: ['normal', 'fire', 'poison', 'flying'], immune: [] },
  ghost: { weak: ['ghost', 'dark'], resist: ['poison', 'bug'], immune: ['normal', 'fighting'] },
  dragon: { weak: ['ice', 'dragon', 'fairy'], resist: ['fire', 'water', 'electric', 'grass'], immune: [] },
  dark: { weak: ['fighting', 'bug', 'fairy'], resist: ['ghost', 'dark'], immune: ['psychic'] },
  steel: { weak: ['fire', 'fighting', 'ground'], resist: ['normal', 'grass', 'ice', 'flying', 'psychic', 'bug', 'rock', 'dragon', 'steel', 'fairy'], immune: ['poison'] },
  fairy: { weak: ['poison', 'steel'], resist: ['fighting', 'bug', 'dark'], immune: ['dragon'] },
};

export interface TypeMatchup {
  type: PokemonType;
  multiplier: number;
}

/** Normalize ability name for comparison (strips non-alphanumeric, lowercases) */
export function normalizeAbility(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Ability-based type immunity/resistance overrides */
const ABILITY_TYPE_OVERRIDES: Record<string, (matchups: Map<PokemonType, number>) => void> = {
  levitate: (m) => { m.set('ground', 0); },
  flashfire: (m) => { m.set('fire', 0); },
  waterabsorb: (m) => { m.set('water', 0); },
  stormdrain: (m) => { m.set('water', 0); },
  dryskin: (m) => {
    m.set('water', 0);
    m.set('fire', (m.get('fire') ?? 1) * 1.25);
  },
  voltabsorb: (m) => { m.set('electric', 0); },
  lightningrod: (m) => { m.set('electric', 0); },
  motordrive: (m) => { m.set('electric', 0); },
  sapsipper: (m) => { m.set('grass', 0); },
  thickfat: (m) => {
    m.set('fire', (m.get('fire') ?? 1) * 0.5);
    m.set('ice', (m.get('ice') ?? 1) * 0.5);
  },
  heatproof: (m) => {
    m.set('fire', (m.get('fire') ?? 1) * 0.5);
  },
  eartheater: (m) => { m.set('ground', 0); },
  wellbakedbody: (m) => { m.set('fire', 0); },
  purifyingsalt: (m) => { m.set('ghost', (m.get('ghost') ?? 1) * 0.5); },
  // Filter/Solid Rock/Prism Armor: reduce super-effective to 0.75x
  filter: (m) => {
    for (const [type, mult] of m) {
      if (mult > 1) m.set(type, mult * 0.75);
    }
  },
  solidrock: (m) => {
    for (const [type, mult] of m) {
      if (mult > 1) m.set(type, mult * 0.75);
    }
  },
  prismarmor: (m) => {
    for (const [type, mult] of m) {
      if (mult > 1) m.set(type, mult * 0.75);
    }
  },
  wonderguard: (m) => {
    for (const [type, mult] of m) {
      if (mult <= 1) m.set(type, 0);
    }
  },
};

/**
 * Compute the full defensive matchup for a set of types (mono or dual).
 * Optionally accounts for the Pokemon's ability.
 * Returns all 18 types with their multiplier against this type combo.
 */
export function getDefensiveMatchups(types: PokemonType[], ability?: string): TypeMatchup[] {
  // Base type calculation
  const matchupMap = new Map<PokemonType, number>();
  for (const attackingType of POKEMON_TYPES) {
    let mult = 1;
    for (const defType of types) {
      const chart = TYPE_CHART[defType];
      if (chart.immune.includes(attackingType)) mult *= 0;
      else if (chart.weak.includes(attackingType)) mult *= 2;
      else if (chart.resist.includes(attackingType)) mult *= 0.5;
    }
    matchupMap.set(attackingType, mult);
  }

  // Apply ability overrides
  if (ability) {
    const key = normalizeAbility(ability);
    const override = ABILITY_TYPE_OVERRIDES[key];
    if (override) override(matchupMap);
  }

  return POKEMON_TYPES.map(type => ({
    type,
    multiplier: matchupMap.get(type) ?? 1,
  }));
}

/** Group matchups by multiplier tier */
export function groupMatchups(matchups: TypeMatchup[]) {
  return {
    x4: matchups.filter(m => m.multiplier >= 4),
    x2: matchups.filter(m => m.multiplier >= 1.5 && m.multiplier < 4),
    x1: matchups.filter(m => m.multiplier === 1),
    x05: matchups.filter(m => m.multiplier === 0.5),
    x025: matchups.filter(m => m.multiplier > 0 && m.multiplier < 0.5),
    x0: matchups.filter(m => m.multiplier === 0),
  };
}
