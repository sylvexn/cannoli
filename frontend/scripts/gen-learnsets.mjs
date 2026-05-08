#!/usr/bin/env node
/**
 * Fetches Pokemon learnset data from Showdown and generates a TypeScript data
 * file keyed by format → display-name → set of move IDs.
 *
 * SIMPLIFICATION (intentional): we do NOT run Showdown's full rule resolver.
 * Format legality here boils down to: "which gen-source codes are legal
 * to draw moves from?". Concretely:
 *   - gen9natdex                      → every source (all past gens transfer)
 *   - gen9ou / uu / ru / nu / pu / lc → gen9-source only (M/T/L/V/E/S/...
 *                                        prefixed with `9`)
 *   - gen9ubers                       → gen9-source only
 * Species banlists, item bans, ability clauses, restricted-legend lists, and
 * tier cascades (UU bans OU, etc) are NOT applied. The cannoli draft pool is
 * already a hand-curated tier list — we just want to know "if this league is
 * gen9 OU-rules, can Garchomp run Outrage?" and that question is answered by
 * the move-source codes alone. Banlists can be layered on later in the admin
 * tier list / per-template banlist UI without regenerating this file.
 *
 * Usage: node scripts/gen-learnsets.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

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

// ─── 1. Fetch the Showdown learnsets ──────────────────────────────

console.log('Fetching Showdown learnsets...');
const res = await fetch('https://play.pokemonshowdown.com/data/learnsets.json');
if (!res.ok) throw new Error(`Failed to fetch learnsets: ${res.status}`);
const learnsets = await res.json();
console.log(`  Loaded ${Object.keys(learnsets).length} learnset entries.`);

// ─── 2. Extract all Pokemon names from tier-list.ts ───────────────

const tierListSrc = readFileSync(resolve(ROOT, 'src/data/tier-list.ts'), 'utf8');

const tiersRawMatch = tierListSrc.match(/const TIERS_RAW[\s\S]*?;\s*\n/);
if (!tiersRawMatch) throw new Error('Could not find TIERS_RAW in tier-list.ts');

const names = [];
const nameRe = /'((?:[^'\\]|\\.)*)'/g;
let m;
while ((m = nameRe.exec(tiersRawMatch[0])) !== null) {
  const val = m[1].replace(/\\(.)/g, '$1');
  if (/^\d+$/.test(val) || val.length === 0) continue;
  names.push(val);
}

console.log(`  Found ${names.length} Pokemon names in TIERS_RAW.`);

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

  if (!entry && !baseEntry) {
    unmatched.push({ name, id });
    continue;
  }

  // Build move → list-of-source-tags map across base + form learnsets.
  const moveSources = new Map();
  for (const src of [entry, baseEntry]) {
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
  console.log(`  Unmatched (${unmatched.length}):`);
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
