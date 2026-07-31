/**
 * Unified draft-board pool search: matchers + suggestion builders shared by the
 * search bar (DraftSearch), the pool filter (use-draft-pool), and the match
 * badges on pool cards.
 *
 * The search spans three axes against the draft pool:
 *   - Pokemon name   (TIER_LIST)
 *   - ability name   (POKEMON_DATA)
 *   - learned move   (per league format, via POKEMON_LEARNSETS_BY_FORMAT)
 *
 * Two filtering modes layer together:
 *   - `search` raw free text → broad OR across all three axes (see matchRawQuery)
 *   - `searchChips` → stacked exact filters, AND'd on top (see matchChip)
 *
 * Move IDs are Showdown's (lowercase, no spaces); MOVE_NAMES maps them to
 * display names for suggestions/labels.
 */

import { TIER_LIST } from '@/data/tier-list';
import { POKEMON_DATA } from '@/data/pokemon-data';
import {
  POKEMON_LEARNSETS_BY_FORMAT,
  getLearnset,
  DEFAULT_FORMAT,
  type DraftFormat,
} from '@/data/pokemon-learnsets';
import { MOVE_NAMES } from '@/data/move-names';

export type SearchChipKind = 'name' | 'ability' | 'move';

/** A committed refine filter chosen from the suggestion dropdown. */
export interface SearchChip {
  kind: SearchChipKind;
  /** Filtering key — name: Pokemon display name; ability: ability display name;
   *  move: Showdown move ID. */
  value: string;
  /** Human label shown on the chip (move → display name; others → value). */
  label: string;
}

/** Why a Pokemon surfaced — drives the badge on its pool card. A name match
 *  produces no reason (no badge needed). */
export interface MatchReason {
  kind: 'ability' | 'move';
  label: string;
}

/** A single dropdown suggestion row. */
export interface Suggestion {
  kind: SearchChipKind;
  value: string;
  label: string;
}

export interface GroupedSuggestions {
  pokemon: Suggestion[];
  abilities: Suggestion[];
  moves: Suggestion[];
}

/** Normalize a free-text fragment to the Showdown move-ID alphabet. */
export function normalizeMoveQuery(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function moveDisplayName(id: string): string {
  return MOVE_NAMES[id] ?? id;
}

// Lazy indexes (built once, reused across keystrokes)

let _names: string[] | null = null;
function pokemonNames(): string[] {
  if (!_names) _names = TIER_LIST.map(e => e.name).sort((a, b) => a.localeCompare(b));
  return _names;
}

let _abilities: string[] | null = null;
function abilityIndex(): string[] {
  if (_abilities) return _abilities;
  const set = new Set<string>();
  for (const data of POKEMON_DATA.values()) {
    for (const a of data.abilities) set.add(a);
  }
  _abilities = [...set].sort((a, b) => a.localeCompare(b));
  return _abilities;
}

interface MoveEntry { id: string; name: string; }
const _moveIndexByFormat = new Map<DraftFormat, MoveEntry[]>();
function moveIndex(format: DraftFormat): MoveEntry[] {
  const cached = _moveIndexByFormat.get(format);
  if (cached) return cached;
  const map = POKEMON_LEARNSETS_BY_FORMAT[format] ?? POKEMON_LEARNSETS_BY_FORMAT[DEFAULT_FORMAT];
  const ids = new Set<string>();
  for (const moves of map.values()) {
    for (const id of moves) ids.add(id);
  }
  const entries = [...ids].map(id => ({ id, name: moveDisplayName(id) }));
  entries.sort((a, b) => a.name.localeCompare(b.name));
  _moveIndexByFormat.set(format, entries);
  return entries;
}

// Suggestions

/** Build grouped suggestions (top `perGroup` per axis) for the typed query,
 *  excluding anything already committed as a chip. */
export function buildSuggestions(
  query: string,
  format: DraftFormat,
  opts: { perGroup?: number; exclude?: SearchChip[] } = {},
): GroupedSuggestions {
  const perGroup = opts.perGroup ?? 3;
  const q = query.trim().toLowerCase();
  if (!q) return { pokemon: [], abilities: [], moves: [] };
  const nq = normalizeMoveQuery(query);

  const exName = new Set((opts.exclude ?? []).filter(c => c.kind === 'name').map(c => c.value.toLowerCase()));
  const exAbil = new Set((opts.exclude ?? []).filter(c => c.kind === 'ability').map(c => c.value.toLowerCase()));
  const exMove = new Set((opts.exclude ?? []).filter(c => c.kind === 'move').map(c => c.value));

  // Earliest substring hit ranks first (prefix matches beat mid-word).
  const rankBy = (hay: string, needle: string) => {
    const i = hay.toLowerCase().indexOf(needle);
    return i < 0 ? Infinity : i;
  };

  const pokemon: Suggestion[] = pokemonNames()
    .filter(n => !exName.has(n.toLowerCase()) && n.toLowerCase().includes(q))
    .sort((a, b) => rankBy(a, q) - rankBy(b, q) || a.localeCompare(b))
    .slice(0, perGroup)
    .map(n => ({ kind: 'name', value: n, label: n }));

  const abilities: Suggestion[] = abilityIndex()
    .filter(a => !exAbil.has(a.toLowerCase()) && a.toLowerCase().includes(q))
    .sort((a, b) => rankBy(a, q) - rankBy(b, q) || a.localeCompare(b))
    .slice(0, perGroup)
    .map(a => ({ kind: 'ability', value: a, label: a }));

  const moves: Suggestion[] = nq
    ? moveIndex(format)
        .filter(m => !exMove.has(m.id) && (normalizeMoveQuery(m.name).includes(nq) || m.id.includes(nq)))
        .sort((a, b) => rankBy(normalizeMoveQuery(a.name), nq) - rankBy(normalizeMoveQuery(b.name), nq) || a.name.localeCompare(b.name))
        .slice(0, perGroup)
        .map(m => ({ kind: 'move', value: m.id, label: m.name }))
    : [];

  return { pokemon, abilities, moves };
}

/** True if the query yields any suggestion in any group. */
export function hasAnySuggestion(s: GroupedSuggestions): boolean {
  return s.pokemon.length > 0 || s.abilities.length > 0 || s.moves.length > 0;
}

// Matchers (used by the pool filter)

/** Broad-OR match of the raw free text against a Pokemon's name/abilities/moves.
 *  Returns `reason` when the *only* reason it matched was an ability or move, so
 *  the card can badge why it surfaced (a name match needs no badge). */
export function matchRawQuery(
  name: string,
  query: string,
  format: DraftFormat,
  abilities: string[],
): { matched: boolean; reason: MatchReason | null } {
  const q = query.trim().toLowerCase();
  if (!q) return { matched: true, reason: null };
  if (name.toLowerCase().includes(q)) return { matched: true, reason: null };

  const abil = abilities.find(a => a.toLowerCase().includes(q));
  if (abil) return { matched: true, reason: { kind: 'ability', label: abil } };

  const nq = normalizeMoveQuery(query);
  if (nq) {
    const learnset = getLearnset(name, format);
    if (learnset) {
      for (const id of learnset) {
        if (id.includes(nq) || normalizeMoveQuery(moveDisplayName(id)).includes(nq)) {
          return { matched: true, reason: { kind: 'move', label: moveDisplayName(id) } };
        }
      }
    }
  }
  return { matched: false, reason: null };
}

/** Exact match of a single committed chip. */
export function matchChip(
  name: string,
  chip: SearchChip,
  format: DraftFormat,
  abilities: string[],
): boolean {
  switch (chip.kind) {
    case 'name':
      return name.toLowerCase() === chip.value.toLowerCase();
    case 'ability':
      return abilities.some(a => a.toLowerCase() === chip.value.toLowerCase());
    case 'move':
      return getLearnset(name, format)?.has(chip.value) ?? false;
  }
}
