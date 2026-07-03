#!/usr/bin/env bun
/**
 * Exhaustive audit of Showdown → Cannoli species-name resolution.
 *
 * RUN WITH BUN (`bun scripts/audit-pokemon-names.mjs` from frontend/): it
 * imports the shared resolver TS module directly and reads the seeded SQLite
 * DB read-only via bun:sqlite.
 *
 * WHAT IT PROVES: for every real, teambuilder-selectable Showdown species
 * (dex entries + their cosmetic formes), `showdownNameCandidates` produces a
 * candidate whose NORMALIZED key matches a Cannoli DB row — i.e. the matchup
 * plugin / paste import can never show a spurious "not found" for a species
 * that exists in the pool. It also proves the inverse: every DB row is
 * reachable from at least one Showdown species (zero orphaned rows).
 *
 * INPUTS:
 *   - showdown/client/play.pokemonshowdown.com/data/pokedex.json — the full
 *     Showdown species universe (network fallback like gen-learnsets.mjs).
 *   - backend/data/cannoli.db `pokemon` table — the ACTUAL runtime name list
 *     (opened read-only; the generated pokemon-data.ts is only a snapshot).
 *
 * EXCLUSIONS (documented, everything else is audited):
 *   - num <= 0 ................ CAP fakemons / Pokestar props / MissingNo.
 *   - isNonstandard CAP ....... CAP fakemons with positive-num formes.
 *   - isNonstandard Custom .... Pokestar/testing constructs.
 *   - isNonstandard LGPE ...... Let's Go exclusives (Starter Pikachu/Eevee &
 *                               Meltan line) — not selectable in gen9 natdex.
 *   - isNonstandard Future .... unreleased species.
 *   - isNonstandard Unobtainable  event-only unreleased formes
 *                               (Eternal Floette etc.).
 *   - Totem formes ............ stat-identical dupes, not teambuilder options.
 *   - Gmax formes ............. gen8-only cosmetic dupes, not selectable in
 *                               gen9 natdex.
 *   isNonstandard "Past" (megas, primals, older-gen mons) is KEPT — natdex
 *   drafts them.
 *
 * EXIT: non-zero when any DB row is unreachable, or when an unresolved
 * species' BASE SPECIES exists in the DB (a genuine resolver gap — a mon in
 * the pool whose forme name fails to land). Species wholly absent from the
 * pool are reported as informational residue.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { showdownNameCandidates, normalizePokemonKey } from '../src/lib/pokemon-name-resolver.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

// ─── 1. Showdown pokedex ─────────────────────────────────────────────
const LOCAL_POKEDEX = resolve(
  REPO_ROOT,
  'showdown/client/play.pokemonshowdown.com/data/pokedex.json',
);
let pokedex;
if (existsSync(LOCAL_POKEDEX)) {
  pokedex = JSON.parse(readFileSync(LOCAL_POKEDEX, 'utf8'));
} else {
  const res = await fetch('https://play.pokemonshowdown.com/data/pokedex.json');
  if (!res.ok) throw new Error(`Failed to fetch pokedex: ${res.status}`);
  pokedex = await res.json();
}
const dexEntries = Object.values(pokedex);
console.log(`Pokedex entries: ${dexEntries.length}`);

// ─── 2. Cannoli DB names (read-only) ─────────────────────────────────
const DB_PATH = resolve(REPO_ROOT, 'backend/data/cannoli.db');
const db = new Database(DB_PATH, { readonly: true });
const dbNames = db.query('SELECT name FROM pokemon ORDER BY name').all().map(r => r.name);
db.close();
console.log(`Cannoli DB rows: ${dbNames.length}`);

const dbByKey = new Map();
for (const name of dbNames) {
  const key = normalizePokemonKey(name);
  if (dbByKey.has(key)) {
    console.error(`✖ DB normalized-key collision: "${dbByKey.get(key)}" vs "${name}"`);
    process.exit(1);
  }
  dbByKey.set(key, name);
}

// ─── 3. Filter to real, teambuilder-selectable species ───────────────
const excluded = { capOrFake: 0, lgpe: 0, future: 0, unobtainable: 0, totem: 0, gmax: 0 };
const species = []; // { name, baseSpecies }

for (const entry of dexEntries) {
  if (entry.num <= 0 || entry.isNonstandard === 'CAP' || entry.isNonstandard === 'Custom') {
    excluded.capOrFake++;
    continue;
  }
  if (entry.isNonstandard === 'LGPE') { excluded.lgpe++; continue; }
  if (entry.isNonstandard === 'Future') { excluded.future++; continue; }
  if (entry.isNonstandard === 'Unobtainable') { excluded.unobtainable++; continue; }
  if (entry.forme?.includes('Totem') || entry.name.includes('-Totem')) { excluded.totem++; continue; }
  if (entry.forme === 'Gmax' || entry.name.endsWith('-Gmax')) { excluded.gmax++; continue; }

  species.push({ name: entry.name, baseSpecies: entry.baseSpecies ?? entry.name });
  // Cosmetic formes ARE teambuilder-selectable (sprite pickers emit them into
  // sets), so audit each one as its own input.
  for (const cosmetic of entry.cosmeticFormes ?? []) {
    species.push({ name: cosmetic, baseSpecies: entry.baseSpecies ?? entry.name });
  }
}

const excludedTotal = Object.values(excluded).reduce((a, b) => a + b, 0);
console.log(
  `Audit inputs: ${species.length} species ` +
  `(excluded ${excludedTotal}: CAP/fake ${excluded.capOrFake}, LGPE ${excluded.lgpe}, ` +
  `future ${excluded.future}, unobtainable ${excluded.unobtainable}, ` +
  `totem ${excluded.totem}, gmax ${excluded.gmax})`,
);

// ─── 4. Resolve every species; track reachable DB rows ───────────────
const reachable = new Set();
const unresolved = [];

for (const s of species) {
  let hit = null;
  for (const candidate of showdownNameCandidates(s.name)) {
    const dbName = dbByKey.get(normalizePokemonKey(candidate));
    if (dbName) { hit = dbName; break; }
  }
  if (hit) reachable.add(hit);
  else unresolved.push(s);
}

console.log(`\nResolved: ${species.length - unresolved.length}/${species.length}`);

// ─── 5. Report ────────────────────────────────────────────────────────
// Residue is only OK when the whole species family is absent from the pool.
// If the BASE species resolves but this forme doesn't, the resolver has a gap.
const gaps = unresolved.filter(s =>
  showdownNameCandidates(s.baseSpecies).some(c => dbByKey.has(normalizePokemonKey(c))),
);
const absent = unresolved.filter(s => !gaps.includes(s));

if (absent.length > 0) {
  console.log(`\nUnresolved, genuinely absent from the Cannoli pool (${absent.length}) — OK:`);
  for (const s of absent) console.log(`  ${s.name}`);
}
if (gaps.length > 0) {
  console.log(`\n✖ RESOLVER GAPS (${gaps.length}) — base species IS in the pool:`);
  for (const s of gaps) {
    console.log(`  ${s.name} (base: ${s.baseSpecies}) — candidates: ${showdownNameCandidates(s.name).join(' | ')}`);
  }
}

const unreachable = dbNames.filter(n => !reachable.has(n));
if (unreachable.length > 0) {
  console.log(`\n✖ UNREACHABLE DB ROWS (${unreachable.length}) — no Showdown species lands here:`);
  for (const n of unreachable) console.log(`  ${n}`);
} else {
  console.log(`\nUnreachable DB rows: 0/${dbNames.length} ✓`);
}

if (gaps.length > 0 || unreachable.length > 0) process.exit(1);
console.log('\nAudit passed.');
