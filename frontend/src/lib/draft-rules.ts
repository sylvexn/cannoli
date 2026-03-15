/**
 * Frontend mirror of backend/src/lib/pokedex.ts + the draft validation rules
 * from backend/src/lib/draft-engine.ts (validatePick). Used for client-side
 * pre-flight checks so we can disable cards, show inline conflict reasons,
 * and skip auto-picks that would fail server validation.
 *
 * The backend remains authoritative — these helpers exist for UX, not security.
 */

import { getEffectiveCost, TERA_BANNED } from '@/data/tier-list';

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
  if (
    name.includes('-')
    && !name.startsWith('Tapu')
    && !name.startsWith('Ho-Oh')
    && !name.startsWith('Porygon-Z')
    && !name.startsWith('Mr.')
  ) {
    return 'other';
  }
  return 'base';
}

/** Reduce a name to a "species key" used for duplicate detection on a team roster. */
export function getBaseFormName(rawName: string): string {
  const name = stripTeraSuffix(rawName);

  const megaPrefix = name.match(/^Mega\s+(.+?)(?:\s+[XY])?$/i);
  if (megaPrefix) return megaPrefix[1];

  const primalPrefix = name.match(/^Primal\s+(.+)$/i);
  if (primalPrefix) return primalPrefix[1];

  const megaSuffix = name.match(/^(.+?)-Mega(?:-[XY])?$/i);
  if (megaSuffix) return megaSuffix[1];

  for (const region of REGIONAL_SUFFIXES) {
    if (new RegExp(`-${region}(-|$)`, 'i').test(name)) return name;
  }

  const lastDash = name.lastIndexOf('-');
  if (lastDash > 0) {
    const suffix = name.slice(lastDash + 1);
    if (COSMETIC_SUFFIXES.has(suffix)) return name.slice(0, lastDash);
  }
  return name;
}

export function isMegaForm(name: string): boolean {
  return getFormCategory(name) === 'mega';
}

// ─── Conflict detection ────────────────────────────────────────────────────

export type ConflictReason =
  | { kind: 'duplicate-species'; conflictsWith: string }
  | { kind: 'mega-cap'; conflictsWith: string }
  | { kind: 'over-budget'; cost: number; budget: number }
  | { kind: 'banned' };

export interface ConflictInputRoster {
  pokemonNames: string[];
  pointsUsed: number;
}

/**
 * Check whether `name` would be a legal addition to a roster.
 * Mirrors backend draft-engine.validatePick (without the DB hits).
 *
 * Returns the first conflict found, or null if pickable.
 */
export function findPickConflict(
  name: string,
  tier: number,
  roster: ConflictInputRoster,
  pointCap: number,
): ConflictReason | null {
  const incomingBase = getBaseFormName(name);
  const incomingIsMega = isMegaForm(name);

  let megaCount = 0;
  for (const existing of roster.pokemonNames) {
    if (getBaseFormName(existing) === incomingBase) {
      return { kind: 'duplicate-species', conflictsWith: existing };
    }
    if (isMegaForm(existing)) megaCount++;
  }
  if (incomingIsMega && megaCount >= 1) {
    const offender = roster.pokemonNames.find(isMegaForm);
    return { kind: 'mega-cap', conflictsWith: offender ?? '' };
  }
  if (roster.pointsUsed + tier > pointCap) {
    return { kind: 'over-budget', cost: tier, budget: pointCap - roster.pointsUsed };
  }
  return null;
}

export function describeConflict(c: ConflictReason): string {
  switch (c.kind) {
    case 'duplicate-species': return `Already have ${c.conflictsWith} — same species`;
    case 'mega-cap':          return `Already have a Mega (${c.conflictsWith}) — max 1 per team`;
    case 'over-budget':       return `${c.cost}pt costs more than ${c.budget}pt remaining`;
    case 'banned':            return 'Banned';
  }
}

// ─── Captain-budget headroom ───────────────────────────────────────────────

/**
 * Worst-case extra points a team would need to designate `slots` captains
 * from their roster. Tier 9→12, 8→10, 7→9, 6→8, 5→6, 4→5, 3→4, 2→2, 1→1.
 * Worst case = picking the captain-eligible mons whose markup is highest.
 *
 * Only tier-≤9 mons can be captains, and we ignore tera-banned mons.
 */
export function captainHeadroomNeeded(
  roster: { name: string; tier: number }[],
  slots: number,
): number {
  if (slots <= 0) return 0;
  const eligible = roster
    .filter(r => r.tier <= 9 && r.tier >= 1 && !TERA_BANNED.includes(r.name))
    .map(r => Math.max(0, getEffectiveCost(r.name, true) - r.tier))
    .sort((a, b) => b - a);
  let total = 0;
  for (let i = 0; i < Math.min(slots, eligible.length); i++) total += eligible[i];
  return total;
}
