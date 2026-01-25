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

/**
 * Compute the full defensive matchup for a set of types (mono or dual).
 * Returns all 18 types with their multiplier against this type combo.
 */
export function getDefensiveMatchups(types: PokemonType[]): TypeMatchup[] {
  return POKEMON_TYPES.map(attackingType => {
    let mult = 1;
    for (const defType of types) {
      const chart = TYPE_CHART[defType];
      if (chart.immune.includes(attackingType)) mult *= 0;
      else if (chart.weak.includes(attackingType)) mult *= 2;
      else if (chart.resist.includes(attackingType)) mult *= 0.5;
    }
    return { type: attackingType, multiplier: mult };
  });
}

/** Group matchups by multiplier tier */
export function groupMatchups(matchups: TypeMatchup[]) {
  return {
    x4: matchups.filter(m => m.multiplier >= 4),
    x2: matchups.filter(m => m.multiplier === 2),
    x1: matchups.filter(m => m.multiplier === 1),
    x05: matchups.filter(m => m.multiplier === 0.5),
    x025: matchups.filter(m => m.multiplier === 0.25),
    x0: matchups.filter(m => m.multiplier === 0),
  };
}
