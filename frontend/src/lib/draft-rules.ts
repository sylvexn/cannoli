/**
 * Frontend mirror of backend/src/lib/pokedex.ts + the draft validation rules
 * from backend/src/lib/draft-engine.ts (validatePick). Used for client-side
 * pre-flight checks so we can disable cards, show inline conflict reasons,
 * and skip auto-picks that would fail server validation.
 *
 * The backend remains authoritative — these helpers exist for UX, not security.
 */

import { getEffectiveCost, getTeraBanned, type CostFormat } from '@/data/tier-list';

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

/** Cheapest mon in the tier list — used as the floor when reserving budget for remaining picks. */
export const MIN_PICK_COST = 1;

/**
 * Hard conflicts: a pick that hits any of these is illegal — backend will reject
 * it, so the UI also blocks the action.
 */
export type ConflictReason =
  | { kind: 'duplicate-species'; conflictsWith: string }
  | { kind: 'mega-cap'; conflictsWith: string }
  | { kind: 'over-budget'; cost: number; budget: number }
  /** Fits raw budget but leaves <(picksLeft - 1) × MIN_PICK_COST for remaining slots */
  | { kind: 'roster-reserve'; cost: number; maxAffordable: number; picksLeft: number }
  | { kind: 'banned' };

/**
 * Soft warnings: legal picks that you might still want to second-guess. Surfaced
 * to the user but never block the action — captains are designated post-draft
 * and managers may decide to forgo markup headroom.
 */
export type PickWarning =
  | { kind: 'captain-reserve'; cost: number; reserveNeeded: number; deficit: number };

export interface ConflictInputRoster {
  pokemonNames: string[];
  pointsUsed: number;
  /**
   * Number of snake-draft slots this team still has, INCLUDING the one being decided.
   * When omitted, the roster-reserve check is skipped (e.g. season mode, FA pickup).
   */
  picksLeft?: number;
  /**
   * Worst-case extra points needed to designate captains from the eventual roster
   * (see captainHeadroomNeeded). When omitted or 0, the captain-reserve warning is skipped.
   */
  captainReserve?: number;
}

/**
 * Maximum tier the user can pick right now without breaking any HARD invariant
 * (raw budget + roster-reserve). Captain reserve is not folded in — it's a soft
 * warning, not a block.
 */
export function getMaxAffordableCost(
  roster: ConflictInputRoster,
  pointCap: number,
): number {
  const remaining = pointCap - roster.pointsUsed;
  if (roster.picksLeft == null) return remaining;
  const futureSlots = Math.max(0, roster.picksLeft - 1);
  return Math.max(0, remaining - futureSlots * MIN_PICK_COST);
}

/**
 * Check whether `name` would be a legal addition to a roster.
 * Mirrors backend draft-engine.validatePick (without the DB hits) and adds the
 * picks-left budget reservation the backend should also enforce.
 *
 * Returns the first hard conflict found, or null if pickable.
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
  const remaining = pointCap - roster.pointsUsed;
  if (tier > remaining) {
    return { kind: 'over-budget', cost: tier, budget: remaining };
  }
  if (roster.picksLeft != null) {
    const futureSlots = Math.max(0, roster.picksLeft - 1);
    const minReserve = futureSlots * MIN_PICK_COST;
    if (tier > remaining - minReserve) {
      return { kind: 'roster-reserve', cost: tier, maxAffordable: remaining - minReserve, picksLeft: roster.picksLeft };
    }
  }
  return null;
}

/**
 * Soft warning: would this pick eat into the captain markup reserve?
 * Only meaningful when `captainReserve > 0`. Returns null if no warning applies
 * or the pick would also fail findPickConflict (those are surfaced as conflicts).
 */
export function findPickWarning(
  _name: string,
  tier: number,
  roster: ConflictInputRoster,
  pointCap: number,
): PickWarning | null {
  const reserveNeeded = roster.captainReserve ?? 0;
  if (reserveNeeded <= 0) return null;
  const remainingAfter = pointCap - roster.pointsUsed - tier;
  const futureSlots = roster.picksLeft != null ? Math.max(0, roster.picksLeft - 1) : 0;
  const headroomAfterMinReserve = remainingAfter - futureSlots * MIN_PICK_COST;
  if (headroomAfterMinReserve < reserveNeeded) {
    return {
      kind: 'captain-reserve',
      cost: tier,
      reserveNeeded,
      deficit: reserveNeeded - headroomAfterMinReserve,
    };
  }
  return null;
}

export function describeConflict(c: ConflictReason): string {
  switch (c.kind) {
    case 'duplicate-species': return `Already have ${c.conflictsWith} — same species`;
    case 'mega-cap':          return `Already have a Mega (${c.conflictsWith}) — max 1 per team`;
    case 'over-budget':       return `${c.cost}pt costs more than ${c.budget}pt remaining`;
    case 'roster-reserve':    return `${c.cost}pt would leave too little for ${c.picksLeft - 1} more pick${c.picksLeft - 1 === 1 ? '' : 's'} (max ${c.maxAffordable}pt now)`;
    case 'banned':            return 'Banned';
  }
}

export function describeWarning(w: PickWarning): string {
  switch (w.kind) {
    case 'captain-reserve':
      return `Eats into captain reserve by ${w.deficit}pt (need ~${w.reserveNeeded}pt for tera markup)`;
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
  format?: CostFormat,
): number {
  if (slots <= 0) return 0;
  const teraBanned = getTeraBanned(format);
  const eligible = roster
    .filter(r => r.tier <= 9 && r.tier >= 1 && !teraBanned.includes(r.name))
    .map(r => Math.max(0, getEffectiveCost(r.name, true, format) - r.tier))
    .sort((a, b) => b - a);
  let total = 0;
  for (let i = 0; i < Math.min(slots, eligible.length); i++) total += eligible[i];
  return total;
}
