#!/usr/bin/env node
/**
 * Fetches Pokemon data from Showdown pokedex and generates a TypeScript data file
 * keyed by display names from our tier list.
 *
 * Usage: node scripts/gen-pokemon-data.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── 1. Fetch the Showdown pokedex ─────────────────────────────────

console.log('Fetching Showdown pokedex...');
const res = await fetch('https://play.pokemonshowdown.com/data/pokedex.json');
if (!res.ok) throw new Error(`Failed to fetch pokedex: ${res.status}`);
const pokedex = await res.json();
console.log(`  Loaded ${Object.keys(pokedex).length} pokedex entries.`);

// ─── 2. Extract all Pokemon names from tier-list.ts ─────────────────

const tierListSrc = readFileSync(resolve(ROOT, 'src/mocks/tier-list.ts'), 'utf8');

// Extract the TIERS_RAW block
const tiersRawMatch = tierListSrc.match(/const TIERS_RAW[\s\S]*?;\s*\n/);
if (!tiersRawMatch) throw new Error('Could not find TIERS_RAW in tier-list.ts');

// Extract names: match both 'Name' and 'Name\'s' style quoted strings.
// We use a regex that handles escaped single quotes inside single-quoted strings.
const names = [];
const nameRe = /'((?:[^'\\]|\\.)*)'/g;
let m;
while ((m = nameRe.exec(tiersRawMatch[0])) !== null) {
  // Unescape any backslash-escaped chars
  const val = m[1].replace(/\\(.)/g, '$1');
  // Skip numeric tier values and empty strings
  if (/^\d+$/.test(val) || val.length === 0) continue;
  names.push(val);
}

console.log(`  Found ${names.length} Pokemon names in TIERS_RAW.`);

// ─── 3. Name → Pokedex ID mapping ──────────────────────────────────

/**
 * Convert a display name to the Showdown pokedex key.
 * Pokedex keys are all lowercase, no spaces/hyphens/special chars.
 * But forms are structured differently than a simple strip:
 *   "Mega Blastoise" → "blastoisemega"
 *   "Mega Charizard X" → "charizardmegax"
 *   "Primal Groudon" → "groudonprimal"
 *   "Slowking-Galar" → "slowkinggalar"
 */
function toPokedexId(name) {
  // Handle Mega X/Y
  const megaXY = name.match(/^Mega\s+(.+)\s+([XY])$/i);
  if (megaXY) {
    return strip(megaXY[1]) + 'mega' + megaXY[2].toLowerCase();
  }

  // Handle Mega
  const mega = name.match(/^Mega\s+(.+)$/i);
  if (mega) {
    return strip(mega[1]) + 'mega';
  }

  // Handle Primal
  const primal = name.match(/^Primal\s+(.+)$/i);
  if (primal) {
    return strip(primal[1]) + 'primal';
  }

  // Default: just strip
  return strip(name);
}

function strip(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Manual overrides for tricky cases
const ID_OVERRIDES = {
  'Basculegion-M': 'basculegion',
  'Indeedee-M': 'indeedee',
  'Meowstic-M': 'meowstic',
  'Oinkologne-M': 'oinkologne',
  'Basculin-Red': 'basculin',
  'Basculin-Blue': 'basculinbluestriped',
  'Basculin-White': 'basculinwhitestriped',
  'Oricorio-Pom-Pom': 'oricoriopompom',
  'Lycanroc-Midday': 'lycanroc',
  'Nidoran-F': 'nidoranf',
  'Nidoran-M': 'nidoranm',
  'Farfetchd': 'farfetchd',
  'Farfetchd-Galar': 'farfetchdgalar',
  // Tauros Paldea forms
  'Tauros-Paldea': 'taurospaldeacombat',
  'Tauros-Paldea-Aqua': 'taurospaldeaaqua',
  'Tauros-Paldea-Blaze': 'taurospaldeablaze',
  'Tauros-Paldea-Combat': 'taurospaldeacombat',
  // Urshifu
  'Urshifu-Single-Strike': 'urshifu',
  'Urshifu-Rapid-Strike': 'urshifurapidstrike',
  // Wormadam forms
  'Wormadam': 'wormadam',
  'Wormadam-Sandy': 'wormadamsandy',
  'Wormadam-Trash': 'wormadamtrash',
  // Squawkabilly - yellow is just a color variant, pokedex uses base
  'Squawkabilly-Yellow': 'squawkabilly',
};

function getPokedexId(name) {
  if (ID_OVERRIDES[name]) return ID_OVERRIDES[name];
  return toPokedexId(name);
}

// ─── 4. Match and collect data ──────────────────────────────────────

const matched = [];
const unmatched = [];

for (const name of names) {
  const id = getPokedexId(name);
  const entry = pokedex[id];
  if (!entry) {
    unmatched.push({ name, id });
    continue;
  }

  const types = entry.types.map(t => t.toLowerCase());
  const stats = {
    hp: entry.baseStats.hp,
    atk: entry.baseStats.atk,
    def: entry.baseStats.def,
    spa: entry.baseStats.spa,
    spd: entry.baseStats.spd,
    spe: entry.baseStats.spe,
  };

  // Collect all abilities (regular + hidden)
  const abilities = [];
  for (const key of Object.keys(entry.abilities).sort()) {
    const a = entry.abilities[key];
    if (a && !abilities.includes(a)) abilities.push(a);
  }

  matched.push({ name, types, stats, abilities });
}

console.log(`\n  Matched: ${matched.length}/${names.length}`);
if (unmatched.length > 0) {
  console.log(`  Unmatched (${unmatched.length}):`);
  for (const u of unmatched) {
    console.log(`    "${u.name}" → tried ID "${u.id}"`);
  }
}

// ─── 5. Generate TypeScript output ──────────────────────────────────

function escName(n) {
  // Escape single quotes in names (e.g., Sirfetch'd)
  return n.replace(/'/g, "\\'");
}

const lines = [];
lines.push(`import type { PokemonType } from '@/lib/pokemon';`);
lines.push('');
lines.push('export interface PokemonData {');
lines.push('  types: PokemonType[];');
lines.push('  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };');
lines.push('  abilities: string[];');
lines.push('}');
lines.push('');
lines.push('/** Pokemon data extracted from Showdown pokedex. Keyed by display name (matching tier list). */');
lines.push('export const POKEMON_DATA = new Map<string, PokemonData>([');

for (const p of matched) {
  const typesStr = p.types.map(t => `'${t}'`).join(', ');
  const statsStr = `hp: ${p.stats.hp}, atk: ${p.stats.atk}, def: ${p.stats.def}, spa: ${p.stats.spa}, spd: ${p.stats.spd}, spe: ${p.stats.spe}`;
  const abilitiesStr = p.abilities.map(a => `'${a.replace(/'/g, "\\'")}'`).join(', ');
  lines.push(`  ['${escName(p.name)}', { types: [${typesStr}], stats: { ${statsStr} }, abilities: [${abilitiesStr}] }],`);
}

lines.push(']);');
lines.push('');
lines.push('export function getPokemonData(name: string): PokemonData | undefined {');
lines.push('  return POKEMON_DATA.get(name);');
lines.push('}');
lines.push('');

const outPath = resolve(ROOT, 'src/mocks/pokemon-data.ts');
writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`\nWrote ${outPath} (${matched.length} entries)`);
