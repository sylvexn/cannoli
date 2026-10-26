/**
 * Pokemon Showdown team paste <-> Draft Center roster.
 *
 * Tera policy: a paste's `Tera Type:` is kept in `teraTypes` (single entry) but
 * `captain` is never auto-set. Captain status costs budget and is a league
 * decision, so the user flips it in the editor; the saved type is then already
 * there. An info warning tells them it is only a hint until captained.
 */
import { NATURE_BY_NAME } from '@/data/battle-items';
import { POKEMON_DATA } from '@/data/pokemon-data';
import { POKEMON_TYPES, type PokemonType } from '@/lib/pokemon';
import { emptySpread, STAT_KEYS, STAT_LABELS, type DcMon, type DcSet, type StatKey, type StatSpread } from './types';

export interface PasteResult { mons: DcMon[]; warnings: string[] }

const id = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_ID = new Map([...POKEMON_DATA.keys()].map(n => [id(n), n]));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const STAT_BY_LABEL = new Map<string, StatKey>(STAT_KEYS.map(k => [STAT_LABELS[k].toLowerCase(), k]));

/** Cannoli "Mega Charizard X" -> PS "Charizard-Mega-X"; non-megas unchanged. */
function toPsSpecies(name: string): string {
  const m = /^Mega (.+?)( [XY])?$/.exec(name);
  if (!m || !POKEMON_DATA.has(name)) return name;
  return `${m[1]}-Mega${m[2] ? '-' + m[2].trim() : ''}`;
}

/** PS species (+ item) -> Cannoli roster name, or null when unknown. */
function toCannoliSpecies(species: string, item: string): { name: string; note?: string } | null {
  const direct = BY_ID.get(id(species));
  const mega = /^(.+?)-Mega(?:-([XY]))?$/i.exec(species);
  if (mega) {
    const n = BY_ID.get(id(`Mega ${mega[1]}${mega[2] ? ' ' + mega[2] : ''}`));
    if (n) return { name: n };
  }
  if (direct) {
    // Base species holding its Mega Stone -> Cannoli lists the Mega as its own mon.
    if (/ite( [XY])?$/.test(item) && !/^(Eviolite|Leftovers)/.test(item)) {
      const suffix = /ite ([XY])$/.exec(item)?.[1];
      const n = BY_ID.get(id(`Mega ${direct}${suffix ? ' ' + suffix : ''}`));
      if (n) return { name: n, note: `${direct} + ${item} mapped to ${n}` };
    }
    return { name: direct };
  }
  return null;
}

export function exportPaste(roster: DcMon[]): string {
  return roster.map(mon => {
    const s = mon.set;
    const lines = [`${toPsSpecies(mon.name)}${s?.item ? ` @ ${s.item}` : ''}`];
    if (s?.ability) lines.push(`Ability: ${s.ability}`);
    if (mon.captain && mon.teraTypes[0]) lines.push(`Tera Type: ${cap(mon.teraTypes[0])}`);
    if (s) {
      const evs = STAT_KEYS.filter(k => s.evs[k] > 0).map(k => `${s.evs[k]} ${STAT_LABELS[k]}`);
      if (evs.length) lines.push(`EVs: ${evs.join(' / ')}`);
      if (s.nature) lines.push(`${s.nature} Nature`);
      const ivs = STAT_KEYS.filter(k => s.ivs[k] !== 31).map(k => `${s.ivs[k]} ${STAT_LABELS[k]}`);
      if (ivs.length) lines.push(`IVs: ${ivs.join(' / ')}`);
      for (const mv of s.moves) lines.push(`- ${mv}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

function parseSpread(text: string, base: number, warn: (m: string) => void): StatSpread {
  const out = emptySpread(base);
  for (const part of text.split('/')) {
    const m = /^\s*(\d+)\s*([a-z]+)\s*$/i.exec(part);
    const k = m && STAT_BY_LABEL.get(m[2].toLowerCase());
    if (m && k) out[k] = Math.min(Number(m[1]), 252);
    else if (part.trim()) warn(`unreadable stat "${part.trim()}"`);
  }
  return out;
}

export function importPaste(text: string): PasteResult {
  const mons: DcMon[] = [];
  const warnings: string[] = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map(b => b.split('\n').map(l => l.trim()).filter(Boolean)).filter(b => b.length);

  for (const lines of blocks) {
    // Some pastes carry a "=== [gen9] Folder/Team ===" header line; skip it.
    if (/^===.*===$/.test(lines[0])) { lines.shift(); if (!lines.length) continue; }
    const head = lines[0];
    const at = head.indexOf(' @ ');
    const item = at >= 0 ? head.slice(at + 3).trim() : '';
    const who = (at >= 0 ? head.slice(0, at) : head).trim().replace(/\s*\((M|F)\)\s*$/, '');
    const nick = /^.*\(([^()]+)\)$/.exec(who);
    const species = (nick ? nick[1] : who).trim();
    const resolved = toCannoliSpecies(species, item);
    if (!resolved) { warnings.push(`Skipped "${head}": unknown Pokemon "${species}"`); continue; }
    const w = (m: string) => warnings.push(`${resolved.name}: ${m}`);
    if (resolved.note) warnings.push(resolved.note);

    const set: DcSet = { moves: [], item, ability: '', nature: 'Hardy', evs: emptySpread(0), ivs: emptySpread(31) };
    let tera: PokemonType | undefined;
    for (const line of lines.slice(1)) {
      const kv = /^([A-Za-z ]+):\s*(.*)$/.exec(line);
      if (line.startsWith('-')) {
        const mv = line.replace(/^-\s*/, '').split('/')[0].trim();
        if (mv && set.moves.length < 4) set.moves.push(mv);
        else if (mv) w('more than 4 moves, extra ignored');
      } else if (/ Nature$/i.test(line)) {
        const n = cap(line.replace(/\s*Nature$/i, '').trim().toLowerCase());
        if (NATURE_BY_NAME.has(n)) set.nature = n; else w(`unknown nature "${n}"`);
      } else if (kv) {
        const key = kv[1].trim().toLowerCase(), val = kv[2].trim();
        if (key === 'ability') set.ability = val;
        else if (key === 'evs') set.evs = parseSpread(val, 0, w);
        else if (key === 'ivs') set.ivs = parseSpread(val, 31, w);
        else if (key === 'tera type') {
          const t = val.toLowerCase() as PokemonType;
          if (POKEMON_TYPES.includes(t)) tera = t; else w(`unknown Tera Type "${val}"`);
        }
        // Level / Shiny / Happiness / Gigantamax etc. have no Draft Center equivalent.
      }
    }
    if (tera) w('Tera Type kept as a hint; mark the Pokemon as a captain to use it');
    mons.push({ name: resolved.name, captain: false, teraTypes: tera ? [tera] : [], set });
  }
  if (!mons.length && text.trim()) warnings.push('No Pokemon found in that text');
  return { mons, warnings };
}
