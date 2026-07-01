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

/**
 * In-battle transform formes a Pokemon flips INTO mid-battle (ability / item /
 * HP-triggered) but which are never separately draftable. Showdown's battle log
 * emits these forme names (via |detailschange|), yet the roster only ever stores
 * the base species. Stripping the trailing segment lets a battle-log name reduce
 * to the same species key as its drafted roster slot (e.g. "Palafin-Hero" →
 * "Palafin", "Aegislash-Blade" → "Aegislash").
 *
 * This is deliberately SEPARATE from COSMETIC_SUFFIXES: those (Therian, regional,
 * etc.) are draftable-distinct species and must keep their identity. Only the
 * *final* dash-segment is stripped, so a regional that also transforms keeps its
 * region (e.g. "Darmanitan-Galar-Zen" → "Darmanitan-Galar").
 */
const BATTLE_ONLY_SUFFIXES = new Set([
  'Zero', 'Hero',        // Palafin (Zero to Hero)
  'Blade', 'Shield',     // Aegislash (Stance Change)
  'Busted',              // Mimikyu (Disguise)
  'Hangry',              // Morpeko (Hunger Switch)
  'Noice',               // Eiscue (Ice Face)
  'School',              // Wishiwashi (Schooling)
  'Complete',            // Zygarde (Power Construct)
  'Zen',                 // Darmanitan / Darmanitan-Galar (Zen Mode)
  'Sunshine',            // Cherrim (Flower Gift)
  'Pirouette',           // Meloetta (Relic Song)
  'Terastal', 'Stellar', // Terapagos (Tera Shift / Tera Form)
  'Gulping', 'Gorging',  // Cramorant (Gulp Missile)
  'Meteor',              // Minior (Shields Down)
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
/**
 * Undo in-battle transform formes a mon flips INTO mid-battle but that are never
 * separately draftable — Showdown emits them, the roster stores the base:
 *   - stripBattleOnlySuffixes("Palafin-Hero")          → "Palafin"
 *   - stripBattleOnlySuffixes("Darmanitan-Galar-Zen")  → "Darmanitan-Galar"
 * Only the trailing dash-segment(s) are removed, so a regional keeps its region.
 * Idempotent — a base species has no battle suffix, so re-running is a no-op.
 * (Tera `(T)` display suffix is stripped first, mirroring the other helpers.)
 */
export function stripBattleOnlySuffixes(rawName: string): string {
  let name = stripTeraSuffix(rawName);
  let dash = name.lastIndexOf('-');
  while (dash > 0 && BATTLE_ONLY_SUFFIXES.has(name.slice(dash + 1))) {
    name = name.slice(0, dash);
    dash = name.lastIndexOf('-');
  }
  return name;
}

export function getBaseFormName(rawName: string): string {
  // Strip in-battle transform formes first (Palafin-Hero → Palafin,
  // Darmanitan-Galar-Zen → Darmanitan-Galar) before the mega/regional logic.
  let name = stripBattleOnlySuffixes(rawName);

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

/**
 * Normalize a species name to Cannoli's roster naming convention for Megas and
 * Primals — the ONLY forms where Cannoli and Pokemon Showdown diverge. Cannoli
 * stores a `Mega <species>` / `Primal <species>` prefix; Showdown's battle
 * protocol emits a `<species>-Mega[-X|Y]` / `<species>-Primal` suffix. Every
 * other form (regionals like "Marowak-Alola", cosmetics like "Porygon2") is
 * stored identically in both, so those pass through untouched.
 *
 *   - toCannoliSpeciesName("Altaria-Mega")      → "Mega Altaria"
 *   - toCannoliSpeciesName("Charizard-Mega-X")  → "Mega Charizard X"
 *   - toCannoliSpeciesName("Mewtwo-Mega-Y")     → "Mega Mewtwo Y"
 *   - toCannoliSpeciesName("Groudon-Primal")    → "Primal Groudon"
 *
 * Idempotent: a name already in Cannoli convention ("Mega Altaria") or any
 * non-Mega/Primal name is returned unchanged (tera suffix preserved). This lets
 * callers normalize both the roster side and the battle side of a comparison
 * without worrying which convention each came in as. Used by match validation
 * (so a Mega isn't falsely flagged "not on roster") and at match_pokemon
 * storage (so per-Pokemon K/D JOINs to the roster entry by exact name).
 */
export function toCannoliSpeciesName(rawName: string): string {
  if (!rawName) return rawName;
  const tera = / \(T\)\s*$/.test(rawName) ? ' (T)' : '';
  const name = stripTeraSuffix(rawName);

  // "<species>-Mega" / "<species>-Mega-X" / "<species>-Mega-Y" → "Mega <species> [X|Y]"
  const megaSuffix = name.match(/^(.+?)-Mega(?:-([XY]))?$/i);
  if (megaSuffix) {
    const variant = megaSuffix[2] ? ` ${megaSuffix[2].toUpperCase()}` : '';
    return `Mega ${megaSuffix[1]}${variant}${tera}`;
  }

  // "<species>-Primal" → "Primal <species>"
  const primalSuffix = name.match(/^(.+?)-Primal$/i);
  if (primalSuffix) return `Primal ${primalSuffix[1]}${tera}`;

  return rawName;
}

/**
 * Resolve a Showdown battle-log Pokemon name to the EXACT drafted name on a
 * single team's roster, so per-Pokemon match stats (games/kills/deaths) attach
 * to the roster slot by exact-string JOIN. Called at WRITE time when storing a
 * `match_pokemon` row, replacing the older `toCannoliSpeciesName(species)` so no
 * read-side change is needed.
 *
 * A team's roster carries at most ONE slot per National-Dex number (league
 * rule), so a battle mon can be unambiguously mapped to its drafted slot by
 * reducing both sides to a species key. Layered strategy, first hit wins:
 *   1. exact match on `battleName`;
 *   2. exact match on `toCannoliSpeciesName(battleName)` (Showdown Mega/Primal
 *      suffix → Cannoli prefix, e.g. "Lopunny-Mega" → "Mega Lopunny");
 *   3. species-key match — `getBaseFormName(roster) === getBaseFormName(battle)`
 *      AND a true battle-representation of the drafted mon (see
 *      `isLegitBattleRepresentation`) — covers in-battle transforms and
 *      base↔mega / default-forme collapse, e.g. battle "Palafin-Hero"/"Lopunny"/
 *      "Indeedee" → roster "Palafin"/"Mega Lopunny"/"Indeedee-F". A genuine forme
 *      DISCREPANCY (both sides carry a distinct qualifier — "Mega Charizard Y"
 *      vs roster "Mega Charizard X", "Rotom-Mow" vs "Rotom-Heat") is REJECTED so
 *      a mis-recorded forme is never silently rewritten to the drafted one.
 * If nothing matches, fall back to `toCannoliSpeciesName(battleName)` — the exact
 * value stored today — so trades / free-agents / illegal mons (species not on
 * this roster) and genuine discrepancies behave exactly as before (stored raw,
 * visible as an orphan).
 *
 * Pure: no DB access. `rosterNames` is the caller-supplied list of one team's
 * drafted `rosters.pokemonName` values. A trailing ` (T)` tera suffix is handled
 * consistently with the underlying helpers (dropped when a roster name — which
 * never carries it — is returned; preserved by the fallback).
 */
/**
 * True when a battle-log name is just an in-battle / convention REPRESENTATION of
 * a drafted roster name (same actual mon), rather than a genuinely different forme
 * that happens to share a species key.
 *
 * - Same mon once in-battle transforms are undone and Mega/Primal convention is
 *   normalized (`Palafin-Hero` vs `Palafin`, `Charizard-Mega-Y` vs `Mega
 *   Charizard Y`) → true.
 * - Otherwise same base species but a differing qualifier: legit ONLY when one
 *   side is the bare base species (base↔mega, bare↔default-forme like
 *   `Indeedee` vs `Indeedee-F`). Reject when BOTH carry a distinct forme/variant
 *   qualifier (`Mega Charizard X` vs `Mega Charizard Y`, `Rotom-Mow` vs
 *   `Rotom-Heat`) — those are real discrepancies, not representations.
 */
function isLegitBattleRepresentation(battle: string, roster: string): boolean {
  const bC = toCannoliSpeciesName(stripBattleOnlySuffixes(battle));
  const rC = toCannoliSpeciesName(stripBattleOnlySuffixes(roster));
  if (bC === rC) return true;
  const isBareBase = (x: string) => getBaseFormName(x) === toCannoliSpeciesName(x);
  return isBareBase(battle) || isBareBase(roster);
}

export function resolveRosterPokemonName(rosterNames: string[], battleName: string): string {
  if (!battleName) return battleName;

  // 1. exact match on the raw battle name
  if (rosterNames.includes(battleName)) return battleName;

  // 2. exact match on the Cannoli-normalized battle name (Mega/Primal)
  const cannoli = toCannoliSpeciesName(battleName);
  if (cannoli !== battleName && rosterNames.includes(cannoli)) return cannoli;

  // 3. species-key match — accept ONLY a true battle-representation of the
  //    drafted mon; a genuine forme discrepancy (Mega Charizard Y vs roster X,
  //    Rotom-Mow vs Rotom-Heat) is skipped and falls through to the raw fallback.
  const battleKey = getBaseFormName(battleName);
  for (const rosterName of rosterNames) {
    if (getBaseFormName(rosterName) === battleKey
        && isLegitBattleRepresentation(battleName, rosterName)) {
      return rosterName;
    }
  }

  // 4. fallback — unchanged-from-today behavior for mons not on this roster and
  //    for genuine discrepancies (stored raw, surfaced as an orphan for review)
  return cannoli;
}
