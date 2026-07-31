#!/usr/bin/env bun
/**
 * Generates the per-Pokemon data file (types, base stats, abilities) keyed by
 * the tier-list display names.
 *
 * RUN WITH BUN (`bun scripts/gen-pokemon-data.mjs`): it imports the TypeScript
 * tier-list module directly to get the authoritative Pokemon name set, which is
 * far more robust than regex-scraping.
 *
 * NAME SOURCE: the union of every drafted Pokemon across all cost formats
 * (`getTierList('natdex')` ∪ `getTierList('natdexplus')`). That is the complete
 * set of mons that can ever appear, so the tier-list / detail pages never see a
 * name with no type data.
 *
 * DATA SOURCE: the local Showdown checkout's `pokedex.json` (network fallback).
 *
 * Usage: bun scripts/gen-pokemon-data.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTierList, COST_FORMATS } from '../src/data/tier-list.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// Repo root is one level above the frontend dir (ROOT).
const REPO_ROOT = resolve(ROOT, '..');

// 1. Load the Showdown pokedex (local file, network fallback)

const LOCAL_POKEDEX = resolve(
  REPO_ROOT,
  'showdown/client/play.pokemonshowdown.com/data/pokedex.json',
);

function parsePokedexText(text) {
  // The .json variant is plain JSON. Guard anyway: some Showdown data files are
  // JS modules (`exports.BattlePokedex = {...};`).
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('pokedex.json: no object literal found');
    return JSON.parse(text.slice(start, end + 1));
  }
}

let pokedex;
if (existsSync(LOCAL_POKEDEX)) {
  console.log(`Loading pokedex from local file: ${LOCAL_POKEDEX}`);
  pokedex = parsePokedexText(readFileSync(LOCAL_POKEDEX, 'utf8'));
} else {
  console.log('Local pokedex.json not found — fetching from Showdown...');
  const res = await fetch('https://play.pokemonshowdown.com/data/pokedex.json');
  if (!res.ok) throw new Error(`Failed to fetch pokedex: ${res.status}`);
  pokedex = await res.json();
}
console.log(`  Loaded ${Object.keys(pokedex).length} pokedex entries.`);

// 2. Collect every Pokemon name from the tier list (all formats)

const nameSet = new Set();
for (const fmt of COST_FORMATS) {
  for (const entry of getTierList(fmt)) nameSet.add(entry.name);
}
const names = [...nameSet].sort();
console.log(`  Found ${names.length} Pokemon names across ${COST_FORMATS.join(' + ')}.`);

// 3. Name → Pokedex ID mapping
// Pokedex keys are lowercase with no spaces/hyphens. Forms strip cleanly in
// most cases (e.g. "Iron Valiant" → "ironvaliant", "Oricorio-Pau" →
// "oricoriopau"); the overrides below cover the cases where the display name
// does not strip to the form's actual key. NOTE: unlike the learnset
// generator, these MUST resolve to the exact form (types differ per form), so
// gendered/cosmetic forms map to the form whose types match.

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
  // Gendered forms share types; pokedex keys the male/base without a suffix.
  'Basculegion-M': 'basculegion',
  'Indeedee-M': 'indeedee',
  'Meowstic-M': 'meowstic',
  'Oinkologne-M': 'oinkologne',
  // Basculin striped forms (all Water-type; red is base).
  'Basculin-Red': 'basculin',
  'Basculin-Blue': 'basculinbluestriped',
  'Basculin-White': 'basculinwhitestriped',
  // Oricorio styles have DISTINCT types — map to the exact form.
  'Oricorio-Pom-Pom': 'oricoriopompom',
  'Oricorio-Pau': 'oricoriopau',
  'Oricorio-Sensu': 'oricoriosensu',
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

function getPokedexId(name) {
  if (ID_OVERRIDES[name]) return ID_OVERRIDES[name];
  return toPokedexId(name);
}

// 4. Match and collect data

const matched = [];
const unmatched = [];

for (const name of names) {
  const id = getPokedexId(name);
  const entry = pokedex[id];
  if (!entry || !entry.types || !entry.baseStats) {
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

  // Collect all abilities (regular + hidden), de-duped, stable order.
  const abilities = [];
  for (const key of Object.keys(entry.abilities ?? {}).sort()) {
    const a = entry.abilities[key];
    if (a && !abilities.includes(a)) abilities.push(a);
  }

  matched.push({ name, types, stats, abilities });
}

console.log(`\n  Matched: ${matched.length}/${names.length}`);
if (unmatched.length > 0) {
  console.log(`\n  UNMATCHED (${unmatched.length}) — add ID_OVERRIDES entries:`);
  for (const u of unmatched) {
    console.log(`    "${u.name}" → tried ID "${u.id}"`);
  }
}

// 5. Generate TypeScript output

function escName(n) {
  return n.replace(/'/g, "\\'");
}

const lines = [];
lines.push(`import type { PokemonType } from '@/lib/pokemon';`);
lines.push('');
lines.push('/**');
lines.push(' * Pokemon data (types, base stats, abilities) extracted from the Showdown');
lines.push(' * pokedex. Generated by scripts/gen-pokemon-data.mjs — do not edit manually.');
lines.push(' * Keyed by display name (matching the tier list).');
lines.push(' */');
lines.push('export interface PokemonData {');
lines.push('  types: PokemonType[];');
lines.push('  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };');
lines.push('  abilities: string[];');
lines.push('}');
lines.push('');
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

const outPath = resolve(ROOT, 'src/data/pokemon-data.ts');
writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`\nWrote ${outPath} (${matched.length} entries)`);

if (unmatched.length > 0) {
  console.error(`\n${unmatched.length} Pokemon had no pokedex match — see list above.`);
  process.exit(1);
}
