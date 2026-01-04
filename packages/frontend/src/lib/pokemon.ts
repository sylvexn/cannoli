/** Pokemon type definitions and helpers */

export const POKEMON_TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice',
  'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
  'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const;

export type PokemonType = typeof POKEMON_TYPES[number];

/** Convert a Pokemon name to its Showdown sprite URL */
export function spriteUrl(name: string, type: 'gen5' | 'gen5-shiny' | 'ani' | 'ani-shiny' = 'gen5'): string {
  const spriteId = toSpriteId(name);
  return `https://play.pokemonshowdown.com/sprites/${type}/${spriteId}.png`;
}

/**
 * Convert a display name to Showdown's sprite filename format.
 * Showdown sprites use lowercase with hyphens for forms:
 *   "Mega Blastoise" → "blastoise-mega"
 *   "Slowking-Galar" → "slowking-galar"
 *   "Marowak-Alola"  → "marowak-alola"
 *   "Rotom-Wash"     → "rotom-wash"
 *   "Mr. Mime"       → "mrmime"
 *   "Mega Charizard X" → "charizard-megax"
 */
export function toSpriteId(name: string): string {
  let n = name.trim();

  // Handle "Mega X" / "Mega Y" variants: "Mega Charizard X" → "Charizard-MegaX"
  const megaXY = n.match(/^Mega\s+(.+)\s+([XY])$/i);
  if (megaXY) {
    return `${cleanBase(megaXY[1])}-mega${megaXY[2].toLowerCase()}`;
  }

  // Handle "Mega Name": "Mega Blastoise" → "blastoise-mega"
  const mega = n.match(/^Mega\s+(.+)$/i);
  if (mega) {
    return `${cleanBase(mega[1])}-mega`;
  }

  // Handle "Primal Name": "Primal Groudon" → "groudon-primal"
  const primal = n.match(/^Primal\s+(.+)$/i);
  if (primal) {
    return `${cleanBase(primal[1])}-primal`;
  }

  // Handle hyphenated forms: "Slowking-Galar", "Rotom-Wash", "Basculegion-F"
  // Keep hyphens, just lowercase and strip special chars from each part
  if (n.includes('-')) {
    return n
      .split('-')
      .map(part => cleanBase(part))
      .join('-');
  }

  return cleanBase(n);
}

/** Strip non-alphanumeric (except hyphen) and lowercase */
function cleanBase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Convert a Pokemon name to Showdown's ID format (no hyphens, for lookups) */
export function toShowdownId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Get the tier point color class name */
export function tierColor(points: number): string {
  if (points >= 20) return 'var(--color-tier-20)';
  if (points >= 1) return `var(--color-tier-${points})`;
  return 'var(--color-tier-1)';
}
