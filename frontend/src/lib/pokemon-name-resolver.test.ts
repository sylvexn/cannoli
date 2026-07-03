import { test, expect, describe, beforeEach } from 'bun:test';
import {
  clearPokemonNameResolverCache,
  normalizePokemonKey,
  resolvePokemonByName,
  showdownNameCandidates,
} from '@/lib/pokemon-name-resolver';

/**
 * Coverage for the Showdown → Cannoli species-name resolver
 * (pokemon-name-resolver.ts), used by the Showdown matchup plugin's
 * teambuilder bridge / paste importer and the site's Matchup Center custom
 * team builder. Exhaustive coverage against the real DB name list lives in
 * frontend/scripts/audit-pokemon-names.mjs; these tests pin the candidate
 * ORDER and the lookup/caching semantics.
 *
 * Run: `bun test src/lib/pokemon-name-resolver.test.ts` from frontend/.
 */

/** Position of `name` (by normalized key) in the candidate list, or -1. */
function candidateIndex(candidates: string[], name: string): number {
  const key = normalizePokemonKey(name);
  return candidates.findIndex(c => normalizePokemonKey(c) === key);
}

/** Assert `earlier` appears in the list and before `later` (if present). */
function expectBefore(candidates: string[], earlier: string, later: string) {
  const e = candidateIndex(candidates, earlier);
  const l = candidateIndex(candidates, later);
  expect(e).toBeGreaterThanOrEqual(0);
  if (l !== -1) expect(e).toBeLessThan(l);
}

describe('normalizePokemonKey', () => {
  test('lowercases and strips punctuation', () => {
    expect(normalizePokemonKey("Farfetch'd-Galar")).toBe('farfetchdgalar');
    expect(normalizePokemonKey('Mr. Mime-Galar')).toBe('mrmimegalar');
    expect(normalizePokemonKey('Mime Jr.')).toBe('mimejr');
    expect(normalizePokemonKey('Type: Null')).toBe('typenull');
    expect(normalizePokemonKey('Zygarde-10%')).toBe('zygarde10');
    expect(normalizePokemonKey("Oricorio-Pa'u")).toBe('oricoriopau');
  });

  test('strips diacritics (Flabébé)', () => {
    expect(normalizePokemonKey('Flabébé')).toBe('flabebe');
  });
});

describe('showdownNameCandidates — megas and primals', () => {
  test('Gardevoir-Mega → Mega Gardevoir before any stripped form', () => {
    const c = showdownNameCandidates('Gardevoir-Mega');
    expect(c[0]).toBe('Gardevoir-Mega');
    expectBefore(c, 'Mega Gardevoir', 'Gardevoir');
  });

  test('Charizard-Mega-X → Mega Charizard X before bare Charizard', () => {
    const c = showdownNameCandidates('Charizard-Mega-X');
    expectBefore(c, 'Mega Charizard X', 'Charizard');
    expectBefore(c, 'Mega Charizard X', 'Charizard-Mega');
  });

  test('Mewtwo-Mega-Y → Mega Mewtwo Y', () => {
    expectBefore(showdownNameCandidates('Mewtwo-Mega-Y'), 'Mega Mewtwo Y', 'Mewtwo');
  });

  test('Groudon-Primal → Primal Groudon before bare Groudon', () => {
    expectBefore(showdownNameCandidates('Groudon-Primal'), 'Primal Groudon', 'Groudon');
  });

  test('cannoli-convention input stays first (Mega Gardevoir)', () => {
    expect(showdownNameCandidates('Mega Gardevoir')[0]).toBe('Mega Gardevoir');
  });
});

describe('showdownNameCandidates — regional formes', () => {
  test.each(['Arcanine-Hisui', 'Diglett-Alola', 'Articuno-Galar', 'Mr. Mime-Galar', 'Samurott-Hisui'])(
    '%s hits exactly first',
    name => {
      expect(showdownNameCandidates(name)[0]).toBe(name);
    },
  );

  test("Farfetch'd-Galar leads with the raw name (normalized key covers the DB spelling)", () => {
    const c = showdownNameCandidates("Farfetch'd-Galar");
    expect(c[0]).toBe("Farfetch'd-Galar");
    expect(normalizePokemonKey(c[0])).toBe(normalizePokemonKey('Farfetchd-Galar'));
  });
});

describe('showdownNameCandidates — gender pairs', () => {
  test.each([
    ['Indeedee', 'Indeedee-M'],
    ['Meowstic', 'Meowstic-M'],
    ['Oinkologne', 'Oinkologne-M'],
    ['Basculegion', 'Basculegion-M'],
  ])('bare %s resolves to %s', (bare, male) => {
    const c = showdownNameCandidates(bare);
    expect(c[0]).toBe(bare);
    expect(candidateIndex(c, male)).toBe(1);
  });

  test('explicit -F formes hit exactly first', () => {
    expect(showdownNameCandidates('Indeedee-F')[0]).toBe('Indeedee-F');
    expect(showdownNameCandidates('Nidoran-F')[0]).toBe('Nidoran-F');
    expect(showdownNameCandidates('Nidoran-M')[0]).toBe('Nidoran-M');
  });
});

describe('showdownNameCandidates — special forme families', () => {
  test('Basculin trio', () => {
    // Bare name still leads (it misses against the real DB — no bare row),
    // with the Red-Striped default as the immediate second candidate.
    expect(candidateIndex(showdownNameCandidates('Basculin'), 'Basculin-Red')).toBe(1);
    expectBefore(showdownNameCandidates('Basculin-Blue-Striped'), 'Basculin-Blue', 'Basculin');
    expectBefore(showdownNameCandidates('Basculin-White-Striped'), 'Basculin-White', 'Basculin');
  });

  test('Urshifu pair', () => {
    const bare = showdownNameCandidates('Urshifu');
    expect(candidateIndex(bare, 'Urshifu-Single-Strike')).toBe(1);
    expect(showdownNameCandidates('Urshifu-Rapid-Strike')[0]).toBe('Urshifu-Rapid-Strike');
  });

  test('Tauros-Paldea trio', () => {
    expectBefore(showdownNameCandidates('Tauros-Paldea-Combat'), 'Tauros-Paldea', 'Tauros');
    expect(showdownNameCandidates('Tauros-Paldea-Aqua')[0]).toBe('Tauros-Paldea-Aqua');
    expect(showdownNameCandidates('Tauros-Paldea-Blaze')[0]).toBe('Tauros-Paldea-Blaze');
  });

  test('forces of nature: bare name → -Incarnate; Therian stays exact', () => {
    expect(candidateIndex(showdownNameCandidates('Landorus'), 'Landorus-Incarnate')).toBe(1);
    expect(showdownNameCandidates('Landorus-Therian')[0]).toBe('Landorus-Therian');
  });

  test('bare Lycanroc → Lycanroc-Midday', () => {
    expect(candidateIndex(showdownNameCandidates('Lycanroc'), 'Lycanroc-Midday')).toBe(1);
  });

  test('Squawkabilly plumage: White remaps to Yellow before base', () => {
    expectBefore(showdownNameCandidates('Squawkabilly-White'), 'Squawkabilly-Yellow', 'Squawkabilly');
    expect(showdownNameCandidates('Squawkabilly-Yellow')[0]).toBe('Squawkabilly-Yellow');
  });
});

describe('showdownNameCandidates — battle formes stay exact', () => {
  test.each(['Rotom-Wash', 'Ogerpon-Wellspring', 'Zamazenta-Crowned'])(
    '%s is the FIRST candidate (never pre-collapsed)',
    name => {
      expect(showdownNameCandidates(name)[0]).toBe(name);
    },
  );
});

describe('showdownNameCandidates — cosmetic collapse', () => {
  test.each([
    ['Gastrodon-East', 'Gastrodon'],
    ['Keldeo-Resolute', 'Keldeo'],
    ['Vivillon-Fancy', 'Vivillon'],
    ['Minior-Meteor', 'Minior'],
  ])('%s falls back to %s', (cosmetic, base) => {
    const c = showdownNameCandidates(cosmetic);
    expect(c[0]).toBe(cosmetic); // exact still gets first shot
    expect(candidateIndex(c, base)).toBeGreaterThan(0);
  });

  test('multi-segment stripping goes longest-prefix first (Necrozma-Dawn-Wings)', () => {
    expectBefore(showdownNameCandidates('Necrozma-Dawn-Wings'), 'Necrozma-Dawn', 'Necrozma');
  });

  test('stripped prefixes re-apply forme defaults (Urshifu-Gmax)', () => {
    const c = showdownNameCandidates('Urshifu-Gmax');
    expectBefore(c, 'Urshifu', 'Urshifu-Single-Strike');
    expect(candidateIndex(c, 'Urshifu-Single-Strike')).toBeGreaterThan(0);
  });
});

describe('showdownNameCandidates — hyphen/space/punctuation names', () => {
  test.each(['Kommo-o', 'Ho-Oh', 'Porygon-Z', 'Ting-Lu', 'Wo-Chien'])(
    '%s hits exactly before its stripped stub',
    name => {
      expect(showdownNameCandidates(name)[0]).toBe(name);
    },
  );

  test.each(['Great Tusk', 'Iron Valiant'])('%s is a single self-candidate', name => {
    expect(showdownNameCandidates(name)).toEqual([name]);
  });

  test.each(['Mime Jr.', 'Mr. Mime', 'Type: Null', 'Flabébé', "Sirfetch'd"])(
    '%s leads with itself',
    name => {
      expect(showdownNameCandidates(name)[0]).toBe(name);
    },
  );

  test('empty/whitespace input yields no candidates', () => {
    expect(showdownNameCandidates('')).toEqual([]);
    expect(showdownNameCandidates('   ')).toEqual([]);
  });
});

describe('resolvePokemonByName', () => {
  // Miniature Cannoli DB with the backend's exact-then-normalized matching.
  const DB = [
    'Mega Gardevoir', 'Mega Charizard X', 'Charizard', 'Gardevoir',
    'Urshifu-Single-Strike', 'Urshifu-Rapid-Strike',
    'Tauros-Paldea', 'Tauros-Paldea-Aqua', 'Tauros',
    'Indeedee-M', 'Indeedee-F',
    'Basculin-Red', 'Basculin-Blue', 'Basculin-White',
    'Flabebe', 'Farfetchd-Galar', 'Type: Null',
    'Gastrodon', 'Keldeo', 'Rotom', 'Rotom-Wash', 'Zamazenta', 'Zamazenta-Crowned',
  ];
  const byKey = new Map(DB.map(n => [normalizePokemonKey(n), { name: n }]));
  const lookup = async (name: string) => byKey.get(normalizePokemonKey(name)) ?? null;

  beforeEach(() => clearPokemonNameResolverCache());

  test.each([
    ['Gardevoir-Mega', 'Mega Gardevoir'],
    ['Charizard-Mega-X', 'Mega Charizard X'],
    ['Urshifu', 'Urshifu-Single-Strike'],
    ['Urshifu-Rapid-Strike', 'Urshifu-Rapid-Strike'],
    ['Tauros-Paldea-Combat', 'Tauros-Paldea'],
    ['Tauros-Paldea-Aqua', 'Tauros-Paldea-Aqua'],
    ['Indeedee', 'Indeedee-M'],
    ['Indeedee-F', 'Indeedee-F'],
    ['Basculin', 'Basculin-Red'],
    ['Basculin-Blue-Striped', 'Basculin-Blue'],
    ['Flabébé', 'Flabebe'],
    ["Farfetch'd-Galar", 'Farfetchd-Galar'],
    ['Type: Null', 'Type: Null'],
    ['Gastrodon-East', 'Gastrodon'],
    ['Keldeo-Resolute', 'Keldeo'],
    ['Rotom-Wash', 'Rotom-Wash'],
    ['Zamazenta-Crowned', 'Zamazenta-Crowned'],
  ])('%s resolves to DB row %s', async (species, dbName) => {
    const row = await resolvePokemonByName(species, lookup);
    expect(row?.name).toBe(dbName);
  });

  test('genuine miss returns null', async () => {
    expect(await resolvePokemonByName('Missingno', lookup)).toBeNull();
  });

  test('caches hits and misses per candidate', async () => {
    let calls = 0;
    const counting = async (name: string) => {
      calls++;
      return lookup(name);
    };
    await resolvePokemonByName('Gardevoir-Mega', counting); // miss, hit → 2 calls
    expect(calls).toBe(2);
    await resolvePokemonByName('Gardevoir-Mega', counting); // fully cached
    expect(calls).toBe(2);
    await resolvePokemonByName('Missingno', counting);
    const missCalls = calls;
    await resolvePokemonByName('Missingno', counting); // misses cached too
    expect(calls).toBe(missCalls);
  });

  test('network errors are not cached — the candidate retries next pass', async () => {
    let fail = true;
    let calls = 0;
    const flaky = async (name: string) => {
      calls++;
      if (fail) throw new Error('network down');
      return lookup(name);
    };
    expect(await resolvePokemonByName('Rotom-Wash', flaky)).toBeNull();
    const failedCalls = calls;
    fail = false;
    const row = await resolvePokemonByName('Rotom-Wash', flaky);
    expect(row?.name).toBe('Rotom-Wash');
    expect(calls).toBeGreaterThan(failedCalls); // it actually re-queried
  });
});
