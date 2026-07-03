// Showdown → Cannoli species-name resolution.
//
// Showdown's species naming diverges from the Cannoli DB in several ways:
//   - Megas/Primals: Showdown "Gardevoir-Mega" / "Charizard-Mega-X" /
//     "Groudon-Primal" vs DB "Mega Gardevoir" / "Mega Charizard X" /
//     "Primal Groudon".
//   - Forme defaults: Showdown's bare name is a specific forme the DB names
//     explicitly — "Indeedee" → "Indeedee-M", "Basculin" → "Basculin-Red",
//     "Urshifu" → "Urshifu-Single-Strike", "Tornadus" → "Tornadus-Incarnate",
//     "Lycanroc" → "Lycanroc-Midday".
//   - Renamed formes: "Basculin-Blue-Striped" → "Basculin-Blue",
//     "Tauros-Paldea-Combat" → "Tauros-Paldea".
//   - Punctuation drift: DB strips SOME punctuation ("Farfetchd-Galar") but
//     keeps other ("Sirfetch'd", "Mr. Mime", "Type: Null") — never compare
//     raw strings, compare normalized keys (the backend's /api/pokemon/:name
//     falls back to the same normalized-key match).
//   - Cosmetic/battle-only formes with no DB row ("Gastrodon-East",
//     "Keldeo-Resolute", "Palafin-Hero") must collapse to the base row, while
//     battle formes that DO have rows ("Rotom-Wash", "Ogerpon-Wellspring",
//     "Zamazenta-Crowned") must hit exactly and never collapse.
//
// `showdownNameCandidates` turns one Showdown species into an ORDERED list of
// Cannoli-convention candidates; `resolvePokemonByName` walks that list
// through a by-name API lookup with a module-level cache. Order is the
// correctness mechanism: exact/normalized name first, then targeted
// transforms, and only then progressive trailing-segment stripping — so
// "Rotom-Wash" resolves before any stripping could degrade it to "Rotom",
// and "Charizard-Mega-X" hits the mega transform before stripping could
// wrongly produce bare "Charizard".
//
// Coverage is audited exhaustively against the real DB name list by
// frontend/scripts/audit-pokemon-names.mjs — run it after changing the
// transform tables or the tier list.

/**
 * Normalized comparison key: lowercase, diacritics stripped (Flabébé →
 * flabebe), all non-alphanumerics dropped (Farfetch'd-Galar →
 * farfetchdgalar, Type: Null → typenull, Zygarde-10% → zygarde10).
 * Mirrored by the backend route (backend/src/routes/leagues/pokemon.ts).
 */
export function normalizePokemonKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Showdown's BARE species name is a specific forme that the Cannoli DB names
 * explicitly. Keyed by normalized name.
 */
const BARE_FORME_DEFAULTS: Record<string, string> = {
  // Gender pairs — the DB stores both -M and -F rows; Showdown's bare name is
  // the male.
  indeedee: 'Indeedee-M',
  meowstic: 'Meowstic-M',
  oinkologne: 'Oinkologne-M',
  basculegion: 'Basculegion-M',
  // Forme families where the DB names the default forme explicitly.
  basculin: 'Basculin-Red',
  urshifu: 'Urshifu-Single-Strike',
  lycanroc: 'Lycanroc-Midday',
  tornadus: 'Tornadus-Incarnate',
  thundurus: 'Thundurus-Incarnate',
  landorus: 'Landorus-Incarnate',
  enamorus: 'Enamorus-Incarnate',
};

/**
 * Whole-name remaps where the DB uses a different forme name than Showdown.
 * Keyed by normalized Showdown name.
 */
const FULL_NAME_REMAPS: Record<string, string> = {
  basculinbluestriped: 'Basculin-Blue',
  basculinwhitestriped: 'Basculin-White',
  // Combat Breed is the base Paldean Tauros row.
  taurospaldeacombat: 'Tauros-Paldea',
  // White Plumage shares Yellow's ability set (Green/Blue collapse to the
  // base row via segment stripping instead).
  squawkabillywhite: 'Squawkabilly-Yellow',
};

/**
 * Ordered candidate list of Cannoli-convention names for a Showdown species.
 *
 * Order: 1) the name itself (exact/normalized hit — covers every DB row that
 * keeps Showdown naming, including punctuation drift via the backend's
 * normalized match); 2) targeted transforms (Mega/Primal word order, bare
 * forme defaults, whole-name remaps); 3) progressive trailing-segment
 * stripping as the cosmetic/battle-forme collapse fallback (longest prefix
 * first, so "Necrozma-Dawn-Wings" tries "Necrozma-Dawn" before "Necrozma");
 * 4) forme defaults of stripped prefixes (so "Urshifu-Gmax" → "Urshifu" →
 * "Urshifu-Single-Strike").
 *
 * Deduped by normalized key; resolution stops at the first hit, so earlier
 * candidates always win.
 */
export function showdownNameCandidates(species: string): string[] {
  const raw = species.trim();
  if (!raw) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const key = normalizePokemonKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };

  const pushTransforms = (name: string) => {
    const key = normalizePokemonKey(name);
    const remap = FULL_NAME_REMAPS[key];
    if (remap) push(remap);
    const bare = BARE_FORME_DEFAULTS[key];
    if (bare) push(bare);
    // Suffix megas/primals → DB's prefix convention. -Mega-X/Y first: the
    // plain -Mega pattern can't match those (they end in -X/-Y), but keep
    // the specific rule ahead of the general one anyway.
    const megaXY = name.match(/^(.+)-Mega-([XY])$/i);
    if (megaXY) push(`Mega ${megaXY[1]} ${megaXY[2].toUpperCase()}`);
    const mega = name.match(/^(.+)-Mega$/i);
    if (mega) push(`Mega ${mega[1]}`);
    const primal = name.match(/^(.+)-Primal$/i);
    if (primal) push(`Primal ${primal[1]}`);
  };

  push(raw);
  pushTransforms(raw);

  // Progressive trailing-segment stripping (cosmetic-forme collapse).
  const parts = raw.split('-');
  const prefixes: string[] = [];
  for (let n = parts.length - 1; n >= 1; n--) {
    const prefix = parts.slice(0, n).join('-').trim();
    if (prefix) {
      push(prefix);
      prefixes.push(prefix);
    }
  }
  // Forme defaults of stripped prefixes come LAST — every explicit row and
  // longer prefix has already had its chance.
  for (const prefix of prefixes) pushTransforms(prefix);

  return out;
}

/**
 * Candidate-lookup cache: normalized candidate name → API row (or null for a
 * confirmed miss). Hits AND misses are cached; lookups that THROW (network /
 * API failure) are deliberately NOT cached so a later call retries them.
 * Module-level — shared by every resolution site in the bundle.
 */
const candidateCache = new Map<string, unknown>();

/** Test hook: reset the module-level candidate cache. */
export function clearPokemonNameResolverCache(): void {
  candidateCache.clear();
}

/**
 * Resolve a Showdown species to a Cannoli Pokemon row by walking
 * `showdownNameCandidates` through `lookup` (normally
 * `api.getPokemonByName`). Returns the first hit, or null when every
 * candidate misses. Null only means "not in the Cannoli pool" when no lookup
 * errored; a fully-errored pass also returns null but stays retryable.
 */
export async function resolvePokemonByName<T>(
  species: string,
  lookup: (name: string) => Promise<T | null>,
): Promise<T | null> {
  for (const candidate of showdownNameCandidates(species)) {
    const key = normalizePokemonKey(candidate);
    if (candidateCache.has(key)) {
      const cached = candidateCache.get(key) as T | null;
      if (cached) return cached;
      continue; // confirmed miss — try the next candidate
    }
    try {
      const row = await lookup(candidate);
      candidateCache.set(key, row);
      if (row) return row;
    } catch {
      // Network/API failure — skip WITHOUT caching so this candidate is
      // retried on the next resolution pass.
    }
  }
  return null;
}
