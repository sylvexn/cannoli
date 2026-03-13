/**
 * Lightweight Pokemon name classifier — covers the rules we need without
 * shipping a full Pokedex:
 *
 *   - getBaseFormName("Mega Charizard X")      → "Charizard"
 *   - getBaseFormName("Charizard-Mega-X")      → "Charizard"
 *   - getBaseFormName("Tauros-Paldea-Aqua")    → "Tauros-Paldea-Aqua" (regional stays distinct)
 *   - getBaseFormName("Greninja-Ash")          → "Greninja"
 *   - getFormCategory("Mega Charizard X")      → "mega"
 *   - getFormCategory("Tauros-Paldea-Aqua")    → "regional"
 *
 * The base-form name is what we use to enforce "no duplicate species on a roster".
 * Two megas of the same species (e.g. Mega Charizard X and Mega Charizard Y) both
 * normalize to "Charizard" and are caught as duplicates. A regional form is
 * considered a distinct species for roster-uniqueness purposes.
 */

export type FormCategory = 'base' | 'mega' | 'regional' | 'other';

const REGIONAL_SUFFIXES = ['Alola', 'Galar', 'Hisui', 'Paldea'];
const COSMETIC_SUFFIXES = new Set([
  'Ash', 'F', 'M', 'Heat', 'Wash', 'Frost', 'Fan', 'Mow',
  'Therian', 'Incarnate', 'Origin', 'Altered',
  'Sky', 'Land', 'Sandy', 'Trash', 'Plant',
  'Pau', 'Pom-Pom', 'Sensu', 'Baile',
  'Dawn', 'Dusk', 'Ultra', 'Crowned',
  'Single-Strike', 'Rapid-Strike',
  'Aqua', 'Blaze',
  'X', 'Y',
]);

function stripTeraSuffix(name: string): string {
  return name.replace(/\s*\(T\)\s*$/, '').trim();
}

export function getFormCategory(rawName: string): FormCategory {
  const name = stripTeraSuffix(rawName);

  if (/^Mega\s+/i.test(name)) return 'mega';
  if (/-Mega(-[XY])?$/i.test(name)) return 'mega';
  if (/^Primal\s+/i.test(name)) return 'mega';

  for (const region of REGIONAL_SUFFIXES) {
    if (new RegExp(`-${region}(-|$)`, 'i').test(name)) return 'regional';
  }

  // Hyphenated form that isn't regional is "other" (Therian, Origin, Crowned, etc.)
  if (name.includes('-') && !name.startsWith('Tapu') && !name.startsWith('Ho-Oh') && !name.startsWith('Porygon-Z') && !name.startsWith('Mr.')) {
    return 'other';
  }

  return 'base';
}

/**
 * Reduce a name to a "species key" used for duplicate detection on a team roster.
 * - "Mega Charizard X" and "Mega Charizard Y" both → "Charizard"
 * - "Charizard" and "Mega Charizard" both → "Charizard"
 * - Regional forms keep their suffix (different species for our purposes)
 */
export function getBaseFormName(rawName: string): string {
  let name = stripTeraSuffix(rawName);

  // "Mega <species> [X|Y]" → "<species>"
  const megaPrefix = name.match(/^Mega\s+(.+?)(?:\s+[XY])?$/i);
  if (megaPrefix) return megaPrefix[1];

  // "Primal <species>" → "<species>"
  const primalPrefix = name.match(/^Primal\s+(.+)$/i);
  if (primalPrefix) return primalPrefix[1];

  // "<species>-Mega" or "<species>-Mega-X|Y" → "<species>"
  const megaSuffix = name.match(/^(.+?)-Mega(?:-[XY])?$/i);
  if (megaSuffix) return megaSuffix[1];

  // Regional / cosmetic suffixes keep base prefix only when cosmetic
  for (const region of REGIONAL_SUFFIXES) {
    if (new RegExp(`-${region}(-|$)`, 'i').test(name)) {
      // Regional forms are treated as distinct species — return full name
      return name;
    }
  }

  // Strip cosmetic-only suffixes like -Therian, -Ash, -Crowned
  const lastDash = name.lastIndexOf('-');
  if (lastDash > 0) {
    const suffix = name.slice(lastDash + 1);
    if (COSMETIC_SUFFIXES.has(suffix)) {
      return name.slice(0, lastDash);
    }
  }

  return name;
}
