#!/usr/bin/env bun
/**
 * Generates the draft-pool learnset data file keyed by format →
 * display-name → set of move IDs.
 *
 * RUN WITH BUN (`bun scripts/gen-learnsets.mjs`): it imports the TypeScript
 * tier-list module directly to get the authoritative Pokemon name set, which is
 * far more robust than regex-scraping the generated source.
 *
 * NAME SOURCE: the union of every drafted Pokemon across all cost formats
 * (`getTierList('natdex')` ∪ `getTierList('natdexplus')`). That is the complete
 * set of mons that can ever appear on a roster, so the coverage page never sees
 * an unknown name.
 *
 * MOVE SOURCE: the local Showdown checkout's `learnsets.json` (network
 * fallback). Using the bundled data means the coverage page agrees with what
 * the battle simulator actually validates.
 *
 * SIMPLIFICATION (intentional): we do NOT run Showdown's full rule resolver.
 * Format legality here boils down to: "which gen-source codes are legal to
 * draw moves from?". Concretely:
 *   - gen9natdex                      → every source (all past gens transfer)
 *   - gen9ou / uu / ru / nu / pu / lc → gen9-source only (`9`-prefixed)
 *   - gen9ubers                       → gen9-source only
 * Both cannoli cost formats (natdex / natdexplus) share the SAME move legality
 * — the "+" only widens the pool/cost, not what moves are legal — so both map
 * to the full-source `gen9natdex` learnset. Species banlists, item bans,
 * ability clauses, and tier cascades are NOT applied; the draft pool is already
 * a hand-curated tier list.
 *
 * Usage: bun scripts/gen-learnsets.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTierList, COST_FORMATS } from '../src/data/tier-list.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// Repo root is one level above the frontend dir (ROOT).
const REPO_ROOT = resolve(ROOT, '..');

// Formats we emit. Order matters only for diff readability — the consumer
// keys by format string.
const FORMATS = [
  'gen9natdex',
  'gen9ou',
  'gen9uu',
  'gen9ru',
  'gen9nu',
  'gen9pu',
  'gen9lc',
  'gen9ubers',
];

/** True if this move-source code is legal in a format that requires gen9 moves
 *  only. PS source codes look like `9M`, `8M`, `7T`, `6L48`, `5S0`, `4E`, `3T`,
 *  `7V` — leading digit is the gen the move was learned in. NatDex accepts
 *  any; gen9-only formats accept only `9*`. */
function moveSourceMatchesFormat(source, format) {
  if (format === 'gen9natdex') return true;
  // every other format we emit is a gen9-only ruleset
  return source.startsWith('9');
}

// ─── 1. Load the Showdown learnsets (local file, network fallback) ─

const LOCAL_LEARNSETS = resolve(
  REPO_ROOT,
  'showdown/client/play.pokemonshowdown.com/data/learnsets.json',
);

function parseLearnsetsText(text) {
  // The .json variant is plain JSON. Guard anyway: some Showdown data files are
  // JS modules (`exports.BattleLearnsets = {...};`). Strip a leading assignment
  // and a trailing semicolon if JSON.parse fails outright.
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('learnsets.json: no object literal found');
    return JSON.parse(text.slice(start, end + 1));
  }
}

let learnsets;
if (existsSync(LOCAL_LEARNSETS)) {
  console.log(`Loading learnsets from local file: ${LOCAL_LEARNSETS}`);
  learnsets = parseLearnsetsText(readFileSync(LOCAL_LEARNSETS, 'utf8'));
} else {
  console.log('Local learnsets.json not found — fetching from Showdown...');
  const res = await fetch('https://play.pokemonshowdown.com/data/learnsets.json');
  if (!res.ok) throw new Error(`Failed to fetch learnsets: ${res.status}`);
  learnsets = await res.json();
}
console.log(`  Loaded ${Object.keys(learnsets).length} learnset entries.`);

// Pokedex — used to resolve `changesFrom` form inheritance. Forms that change
// from another form in battle (Therian, Ogerpon masks, Hoopa-Unbound, Deoxys
// formes, Rotom appliances) carry an empty/signature-only learnset and inherit
// the base movepool. `changesFrom` is the precise marker — regional forms
// (Paldea/Galar/Hisui) have none and keep their own full learnset, so they are
// untouched. (Megas/Primals don't carry changesFrom here; getBaseFormId handles
// them by name.)
const LOCAL_POKEDEX = resolve(
  REPO_ROOT,
  'showdown/client/play.pokemonshowdown.com/data/pokedex.json',
);
let pokedex;
if (existsSync(LOCAL_POKEDEX)) {
  pokedex = parseLearnsetsText(readFileSync(LOCAL_POKEDEX, 'utf8'));
} else {
  const res = await fetch('https://play.pokemonshowdown.com/data/pokedex.json');
  if (!res.ok) throw new Error(`Failed to fetch pokedex: ${res.status}`);
  pokedex = await res.json();
}
console.log(`  Loaded ${Object.keys(pokedex).length} pokedex entries.`);

// ─── 2. Collect every Pokemon name from the tier list (all formats) ─
// The union across cost formats is the complete roster-eligible universe.

const nameSet = new Set();
for (const fmt of COST_FORMATS) {
  for (const entry of getTierList(fmt)) nameSet.add(entry.name);
}
const names = [...nameSet].sort();
console.log(`  Found ${names.length} Pokemon names across ${COST_FORMATS.join(' + ')}.`);

// ─── 3. Name → Showdown learnset ID mapping ──────────────────────
// Reuse exact same logic from gen-pokemon-data.mjs

function strip(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toPokedexId(name) {
  const megaXY = name.match(/^Mega\s+(.+)\s+([XY])$/i);
  if (megaXY) return strip(megaXY[1]) + 'mega' + megaXY[2].toLowerCase();
  const mega = name.match(/^Mega\s+(.+)$/i);
  if (mega) return strip(mega[1]) + 'mega';
  const primal = name.match(/^Primal\s+(.+)$/i);
  if (primal) return strip(primal[1]) + 'primal';
  return strip(name);
}

const ID_OVERRIDES = {
  // Incarnate forms are the base species in Showdown (Therian is the alt form).
  'Enamorus-Incarnate': 'enamorus',
  'Landorus-Incarnate': 'landorus',
  'Thundurus-Incarnate': 'thundurus',
  'Tornadus-Incarnate': 'tornadus',
  'Basculegion-M': 'basculegion',
  'Indeedee-M': 'indeedee',
  'Meowstic-M': 'meowstic',
  'Oinkologne-M': 'oinkologne',
  'Basculin-Red': 'basculin',
  'Basculin-Blue': 'basculin',
  'Basculin-White': 'basculinwhitestriped',
  'Oricorio-Pom-Pom': 'oricorio',
  'Oricorio-Pau': 'oricorio',
  'Oricorio-Sensu': 'oricorio',
  'Lycanroc-Midday': 'lycanroc',
  'Nidoran-F': 'nidoranf',
  'Nidoran-M': 'nidoranm',
  'Farfetchd': 'farfetchd',
  'Farfetchd-Galar': 'farfetchdgalar',
  'Tauros-Paldea': 'taurospaldeacombat',
  'Tauros-Paldea-Aqua': 'taurospaldeaaqua',
  'Tauros-Paldea-Blaze': 'taurospaldeablaze',
  'Tauros-Paldea-Combat': 'taurospaldeacombat',
  'Urshifu-Single-Strike': 'urshifu',
  'Urshifu-Rapid-Strike': 'urshifurapidstrike',
  'Wormadam': 'wormadam',
  'Wormadam-Sandy': 'wormadamsandy',
  'Wormadam-Trash': 'wormadamtrash',
  'Squawkabilly-Yellow': 'squawkabilly',
};

function getLearnsetId(name) {
  if (ID_OVERRIDES[name]) return ID_OVERRIDES[name];
  return toPokedexId(name);
}

// ─── 4. Match and collect learnsets ───────────────────────────────
// For Mega forms, also include the base form's learnset (Megas inherit).
// For each format, filter the merged source list down to legal sources.

function getBaseFormId(name) {
  const megaXY = name.match(/^Mega\s+(.+)\s+[XY]$/i);
  if (megaXY) return strip(megaXY[1]);
  const mega = name.match(/^Mega\s+(.+)$/i);
  if (mega) return strip(mega[1]);
  const primal = name.match(/^Primal\s+(.+)$/i);
  if (primal) return strip(primal[1]);
  return null;
}

// Per-format result: name → sorted move list. Pokemon that have zero legal
// moves in a format (e.g. a transfer-only mon in gen9-only formats) still
// get emitted with an empty list so the consumer can distinguish "no learnset"
// from "Pokemon doesn't exist in this format".
const byFormat = Object.fromEntries(FORMATS.map(f => [f, []]));
const unmatched = [];

for (const name of names) {
  const id = getLearnsetId(name);
  const entry = learnsets[id];
  const baseId = getBaseFormId(name);
  const baseEntry = baseId ? learnsets[baseId] : null;
  // Form-inheritance: a `changesFrom` form draws the base species' movepool.
  const changesFrom = pokedex[id]?.changesFrom;
  const cfId = changesFrom ? strip(changesFrom) : null;
  const cfEntry = cfId ? learnsets[cfId] : null;

  if (!entry && !baseEntry && !cfEntry) {
    unmatched.push({ name, id });
    continue;
  }

  // Pre-evolution inheritance: Showdown stores egg moves and lower-stage moves
  // only on the EARLIEST form that learns them (e.g. `glare` lives on `snivy`,
  // never repeated on `servine`/`serperior`). Walk the full prevo chain from
  // every id we resolve (own id, mega/primal base id, changesFrom id) and fold
  // each ancestor's learnset in. `pokedex[id].prevo` is a display name, so
  // `strip()` it to a learnset key; egg-move tags like `9E` are gen9-legal, so
  // keeping the original PS source tags leaves per-format filtering correct.
  const prevoVisited = new Set();
  const prevoEntries = [];
  for (const startId of [id, baseId, cfId]) {
    if (!startId) continue;
    let cursor = startId;
    // Bounded loop also guards against cyclic / self-referential prevo data.
    for (let hops = 0; hops < 20; hops++) {
      const prevoName = pokedex[cursor]?.prevo;
      if (!prevoName) break;
      const prevoId = strip(prevoName);
      if (!prevoId || prevoVisited.has(prevoId)) break;
      prevoVisited.add(prevoId);
      const prevoEntry = learnsets[prevoId];
      if (prevoEntry) prevoEntries.push(prevoEntry);
      cursor = prevoId;
    }
  }

  // Build move → list-of-source-tags map across own + inherited learnsets.
  const moveSources = new Map();
  for (const src of [entry, baseEntry, cfEntry, ...prevoEntries]) {
    if (!src?.learnset) continue;
    for (const [moveName, sources] of Object.entries(src.learnset)) {
      if (!moveSources.has(moveName)) moveSources.set(moveName, []);
      moveSources.get(moveName).push(...sources);
    }
  }

  for (const format of FORMATS) {
    const moves = [];
    for (const [moveName, sources] of moveSources) {
      if (sources.some(s => moveSourceMatchesFormat(s, format))) {
        moves.push(moveName);
      }
    }
    moves.sort();
    byFormat[format].push({ name, moves });
  }
}

const matchedCount = byFormat.gen9natdex.length;
console.log(`\n  Matched: ${matchedCount}/${names.length}`);
if (unmatched.length > 0) {
  console.log(`\n  ⚠ UNMATCHED (${unmatched.length}) — add ID_OVERRIDES entries:`);
  for (const u of unmatched) {
    console.log(`    "${u.name}" → tried ID "${u.id}"`);
  }
}

// ─── 5. Generate TypeScript output ────────────────────────────────

function escName(n) {
  return n.replace(/'/g, "\\'");
}

const lines = [];
lines.push('/**');
lines.push(' * Pokemon learnset data extracted from Showdown, keyed by format.');
lines.push(' * Generated by scripts/gen-learnsets.mjs — do not edit manually.');
lines.push(' *');
lines.push(' * Shape: format → display-name → set of move IDs (lowercase, no spaces).');
lines.push(' * Display names match the cannoli tier list. Move IDs match the keys');
lines.push(' * in Showdown\'s moves.json.');
lines.push(' *');
lines.push(' * Format legality is approximated by gen-source filtering only — see');
lines.push(' * the generator header for the simplification rationale.');
lines.push(' */');
lines.push('');
lines.push('export type DraftFormat =');
for (let i = 0; i < FORMATS.length; i++) {
  const sep = i === FORMATS.length - 1 ? ';' : '';
  lines.push(`  | '${FORMATS[i]}'${sep}`);
}
lines.push('');
lines.push('export const DRAFT_FORMATS = [');
for (const f of FORMATS) lines.push(`  '${f}',`);
lines.push('] as const satisfies readonly DraftFormat[];');
lines.push('');
lines.push('export const DEFAULT_FORMAT: DraftFormat = \'gen9natdex\';');
lines.push('');

// Build the RAW tables. Formats that produce the same move filter (all
// gen9-only formats currently share the same source-gen filter — see header
// rationale) are aliased to one underlying table so we don't multi-emit the
// same ~40k entries.
const formatBuckets = new Map(); // signature → { rawName, formats: [] }
function bucketKey(rows) {
  // Quick signature: format-stable hash of (name, moves length, joined head).
  // Cheap, sufficient — every format we emit either matches gen9natdex or
  // matches the gen9-only filter; collisions outside those are vanishingly
  // unlikely at our scale.
  let acc = '';
  for (const r of rows) acc += r.name + '|' + r.moves.length + ',' + (r.moves[0] ?? '') + ';';
  return acc;
}
for (const format of FORMATS) {
  const key = bucketKey(byFormat[format]);
  if (!formatBuckets.has(key)) {
    const safeName = format.replace(/[^a-z0-9]/gi, '_').toUpperCase();
    formatBuckets.set(key, { rawName: `RAW_${safeName}`, rows: byFormat[format], formats: [] });
  }
  formatBuckets.get(key).formats.push(format);
}

for (const bucket of formatBuckets.values()) {
  lines.push(`const ${bucket.rawName}: [string, string[]][] = [`);
  for (const p of bucket.rows) {
    const movesStr = p.moves.map(mv => `'${mv}'`).join(',');
    lines.push(`  ['${escName(p.name)}',[${movesStr}]],`);
  }
  lines.push('];');
  lines.push('');
}

lines.push('function toMap(rows: [string, string[]][]): Map<string, Set<string>> {');
lines.push('  return new Map(rows.map(([n, m]) => [n, new Set(m)]));');
lines.push('}');
lines.push('');
// One memoized Map per bucket; aliases share the same instance.
for (const bucket of formatBuckets.values()) {
  lines.push(`const MAP_${bucket.rawName.slice(4)} = toMap(${bucket.rawName});`);
}
lines.push('');
lines.push('export const POKEMON_LEARNSETS_BY_FORMAT: Record<DraftFormat, Map<string, Set<string>>> = {');
for (const bucket of formatBuckets.values()) {
  for (const format of bucket.formats) {
    lines.push(`  ${format}: MAP_${bucket.rawName.slice(4)},`);
  }
}
lines.push('};');
lines.push('');
lines.push('/**');
lines.push(' * Backwards-compat: the natdex map is the historic "every move" set.');
lines.push(' * New code should call `getLearnset(name, format)` with an explicit format.');
lines.push(' */');
lines.push('export const POKEMON_LEARNSETS = POKEMON_LEARNSETS_BY_FORMAT[DEFAULT_FORMAT];');
lines.push('');
lines.push('export function getLearnset(name: string, format: DraftFormat = DEFAULT_FORMAT): Set<string> | undefined {');
lines.push('  return POKEMON_LEARNSETS_BY_FORMAT[format]?.get(name) ?? POKEMON_LEARNSETS_BY_FORMAT[DEFAULT_FORMAT].get(name);');
lines.push('}');
lines.push('');

const outPath = resolve(ROOT, 'src/data/pokemon-learnsets.ts');
writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`\nWrote ${outPath}`);

// Stats per format
for (const format of FORMATS) {
  const totalMoves = byFormat[format].reduce((s, p) => s + p.moves.length, 0);
  const denom = byFormat[format].length || 1;
  console.log(`  ${format}: ${byFormat[format].length} entries, ${totalMoves} moves (avg ${Math.round(totalMoves / denom)}/mon)`);
}

if (unmatched.length > 0) {
  console.error(`\n✖ ${unmatched.length} Pokemon had no learnset match — see list above.`);
  process.exit(1);
}
