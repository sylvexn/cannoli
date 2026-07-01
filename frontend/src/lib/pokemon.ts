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
 * Showdown sprite ID overrides for names our general rules can't handle.
 * Maps display name (lowercase) → sprite filename (without extension).
 */
const SPRITE_OVERRIDES: Record<string, string> = {
  // Hyphenated names that should be collapsed (no hyphen in sprite ID)
  'kommo-o': 'kommoo',
  'hakamo-o': 'hakamoo',
  'jangmo-o': 'jangmoo',
  'ho-oh': 'hooh',
  'porygon-z': 'porygonz',

  // Gender forms — male is default (no suffix)
  'basculegion-m': 'basculegion',
  'indeedee-m': 'indeedee',
  'meowstic-m': 'meowstic',
  'oinkologne-m': 'oinkologne',

  // Basculin forms
  'basculin-blue': 'basculin-bluestriped',
  'basculin-red': 'basculin',
  'basculin-white': 'basculin-whitestriped',

  // Oricorio
  'oricorio-pom-pom': 'oricorio-pompom',

  // Lycanroc — midday is default
  'lycanroc-midday': 'lycanroc',

  // Nidoran gender symbols
  'nidoran-f': 'nidoranf',
  'nidoran-m': 'nidoranm',

  // (Squawkabilly plumage variants resolve correctly via the default hyphen rule)

  // Sirfetch'd apostrophe
  "sirfetch'd": 'sirfetchd',

  // Farfetch'd
  "farfetch'd": 'farfetchd',
  "farfetch'd-galar": 'farfetchd-galar',

  // Flabébé accent
  'flabébé': 'flabebe',

  // Paldean Tauros — Showdown IDs drop the inner hyphen (Combat is the base breed)
  'tauros-paldea': 'tauros-paldeacombat',
  'tauros-paldea-aqua': 'tauros-paldeaaqua',
  'tauros-paldea-blaze': 'tauros-paldeablaze',
  'tauros-paldea-combat': 'tauros-paldeacombat',

  // Urshifu
  'urshifu-rapid-strike': 'urshifu-rapidstrike',
  'urshifu-single-strike': 'urshifu',

  // Ursaluna Bloodmoon
  'ursaluna-bloodmoon': 'ursaluna-bloodmoon',

  // Treasures of Ruin — Showdown collapses the hyphen
  'ting-lu': 'tinglu',
  'wo-chien': 'wochien',
  'chien-pao': 'chienpao',
  'chi-yu': 'chiyu',

  // Forces of Nature — Incarnate is the default form (no suffix on Showdown)
  'thundurus-incarnate': 'thundurus',
  'tornadus-incarnate': 'tornadus',
  'landorus-incarnate': 'landorus',
  'enamorus-incarnate': 'enamorus',
};

/**
 * Convert a display name to Showdown's sprite filename format.
 * Showdown sprites use lowercase with hyphens for forms:
 *   "Mega Blastoise" → "blastoise-mega"
 *   "Slowking-Galar" → "slowking-galar"
 *   "Marowak-Alola"  → "marowak-alola"
 *   "Rotom-Wash"     → "rotom-wash"
 *   "Mr. Mime"       → "mrmime"
 *   "Mega Charizard X" → "charizard-megax"
 *   "Kommo-o"        → "kommoo"
 */
export function toSpriteId(name: string): string {
  const n = name.trim();

  // Check overrides first (case-insensitive)
  const lower = n.toLowerCase();
  if (SPRITE_OVERRIDES[lower]) return SPRITE_OVERRIDES[lower];

  // Handle "Mega X" / "Mega Y" variants: "Mega Charizard X" → "charizard-megax"
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

/** Play a Pokemon's cry audio at low volume */
export function playCry(name: string, volume = 0.15): void {
  const id = toSpriteId(name);
  const audio = new Audio(`https://play.pokemonshowdown.com/audio/cries/${id}.mp3`);
  audio.volume = volume;
  audio.play().catch(() => {}); // Silently fail if autoplay is blocked
}

/** Get the tier point color class name */
export function tierColor(points: number): string {
  if (points >= 20) return 'var(--color-tier-20)';
  if (points >= 1) return `var(--color-tier-${points})`;
  return 'var(--color-tier-1)';
}
