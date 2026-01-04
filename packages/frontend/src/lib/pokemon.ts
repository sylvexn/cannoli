/** Pokemon type definitions and helpers */

export const POKEMON_TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice',
  'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
  'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const;

export type PokemonType = typeof POKEMON_TYPES[number];

/** Convert a Pokemon name to its Showdown sprite URL */
export function spriteUrl(name: string, type: 'gen5' | 'gen5-shiny' | 'ani' | 'ani-shiny' = 'gen5'): string {
  const spriteId = toShowdownId(name);
  return `https://play.pokemonshowdown.com/sprites/${type}/${spriteId}.png`;
}

/** Convert a Pokemon name to Showdown's ID format */
export function toShowdownId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Get the tier point color class name */
export function tierColor(points: number): string {
  if (points >= 20) return 'var(--color-tier-20)';
  if (points >= 1) return `var(--color-tier-${points})`;
  return 'var(--color-tier-1)';
}
