/**
 * Draft Center rulesets + roster validator.
 *
 * A "ruleset" is DERIVED from an existing league (cost format, budget, roster
 * size, tera config). `resolveRuleset` is the single seam: when a real rulesets
 * table ever exists, only this function changes.
 *
 * Validation WARNS, it never blocks — callers store illegal teams as-is and the
 * UI renders the violations. The validator is pure (cost lookup injected) so it
 * is unit-testable without a DB; `validateForRuleset` wires the real cost map.
 */

import { db, schema } from '../../db';
import { eq } from 'drizzle-orm';
import { COST_FORMAT_LABELS, DEFAULT_COST_FORMAT, getFormatCostMap, type ResolvedCost } from '../league-costs';
import { effectiveCost } from '../tera-cost';
import { getBaseFormName, getFormCategory } from '../pokedex';
import { MAX_TERA_TYPES, type DcMon } from './types';

export interface Ruleset {
  id: string;
  label: string;
  leagueId: string | null;
  costFormat: string;
  pointCap: number;
  rosterSize: number;
  teraCaptainSlots: number;
  teraTypesPerCaptain: number;
}

/** Highest tier that may be designated a tera captain. */
export const MAX_CAPTAIN_TIER = 9;
export const DEFAULT_ROSTER_SIZE = 12;

/** Fallback when a team has no league (or its league was deleted). */
export const DEFAULT_RULESET: Ruleset = {
  id: 'default',
  label: `Default — ${COST_FORMAT_LABELS[DEFAULT_COST_FORMAT] ?? DEFAULT_COST_FORMAT}`,
  leagueId: null,
  costFormat: DEFAULT_COST_FORMAT,
  pointCap: 110,
  rosterSize: DEFAULT_ROSTER_SIZE,
  teraCaptainSlots: 2,
  teraTypesPerCaptain: MAX_TERA_TYPES,
};

/** league → ruleset. Null league id (or an unknown one) → DEFAULT_RULESET. */
export function resolveRuleset(leagueId: string | null | undefined): Ruleset {
  if (!leagueId) return DEFAULT_RULESET;
  const row = db.select({
    id: schema.leagues.id,
    name: schema.leagues.name,
    costFormat: schema.leagues.costFormat,
    rosterSize: schema.leagues.rosterSize,
    seasonNumber: schema.seasons.seasonNumber,
    pointCap: schema.seasons.pointCap,
    teraCaptainSlots: schema.seasons.teraCaptainSlots,
  }).from(schema.leagues)
    .innerJoin(schema.seasons, eq(schema.seasons.id, schema.leagues.seasonId))
    .where(eq(schema.leagues.id, leagueId)).get();
  if (!row) return DEFAULT_RULESET;
  return {
    id: `league:${row.id}`,
    label: `S${row.seasonNumber} ${row.name.replace(/ League$/, '')} — ${COST_FORMAT_LABELS[row.costFormat] ?? row.costFormat}`,
    leagueId: row.id,
    costFormat: row.costFormat,
    pointCap: row.pointCap,
    rosterSize: row.rosterSize,
    teraCaptainSlots: row.teraCaptainSlots,
    teraTypesPerCaptain: MAX_TERA_TYPES,
  };
}

export type ViolationCode =
  | 'over_budget' | 'roster_over' | 'multi_mega' | 'duplicate_species' | 'banned' | 'unknown_pokemon'
  | 'captain_count' | 'captain_tier' | 'captain_tera_banned' | 'tera_types_over' | 'captain_no_tera';

export interface Violation {
  code: ViolationCode;
  severity: 'warn' | 'info';
  message: string;
  /** Pokemon the violation points at (when specific to one). */
  pokemon?: string;
}

export interface Validation {
  used: number;
  budget: number;
  remaining: number;
  rosterSize: number;
  count: number;
  violations: Violation[];
}

export type CostLookup = (name: string) => ResolvedCost | undefined;

export function validateRoster(roster: DcMon[], rs: Ruleset, cost: CostLookup): Validation {
  const v: Violation[] = [];
  let used = 0;
  const seen = new Map<string, string>();
  const megas: string[] = [];
  const captains = roster.filter(m => m.captain);

  for (const m of roster) {
    const c = cost(m.name);
    if (!c) {
      v.push({ code: 'unknown_pokemon', severity: 'warn', pokemon: m.name, message: `${m.name} has no price in this format` });
    } else {
      used += effectiveCost(c.tier, m.captain);
      if (c.banned) v.push({ code: 'banned', severity: 'warn', pokemon: m.name, message: `${m.name} is banned in this format` });
    }

    const base = getBaseFormName(m.name);
    const prev = seen.get(base);
    if (prev) v.push({ code: 'duplicate_species', severity: 'warn', pokemon: m.name, message: `${m.name} duplicates ${prev} (same National Dex number)` });
    else seen.set(base, m.name);

    if (getFormCategory(m.name) === 'mega') megas.push(m.name);

    if (m.captain) {
      if (c && c.tier > MAX_CAPTAIN_TIER) {
        v.push({ code: 'captain_tier', severity: 'warn', pokemon: m.name, message: `${m.name} is tier ${c.tier}; captains must be tier ${MAX_CAPTAIN_TIER} or below` });
      }
      if (c?.teraBanned) {
        v.push({ code: 'captain_tera_banned', severity: 'warn', pokemon: m.name, message: `${m.name} is tera-banned and cannot be a captain` });
      }
      if (m.teraTypes.length > rs.teraTypesPerCaptain) {
        v.push({ code: 'tera_types_over', severity: 'warn', pokemon: m.name, message: `${m.name} has more than ${rs.teraTypesPerCaptain} tera types` });
      } else if (m.teraTypes.length < rs.teraTypesPerCaptain) {
        v.push({ code: 'captain_no_tera', severity: 'info', pokemon: m.name, message: `${m.name} has ${m.teraTypes.length}/${rs.teraTypesPerCaptain} tera types picked` });
      }
    }
  }

  if (megas.length > 1) {
    v.push({ code: 'multi_mega', severity: 'warn', message: `${megas.length} Megas (${megas.join(', ')}); max 1 per team` });
  }
  if (captains.length > rs.teraCaptainSlots) {
    v.push({ code: 'captain_count', severity: 'warn', message: `${captains.length} captains; this league allows ${rs.teraCaptainSlots}` });
  }
  if (roster.length > rs.rosterSize) {
    v.push({ code: 'roster_over', severity: 'warn', message: `${roster.length} Pokemon; roster size is ${rs.rosterSize}` });
  }
  if (used > rs.pointCap) {
    v.push({ code: 'over_budget', severity: 'warn', message: `${used} points used; budget is ${rs.pointCap}` });
  }

  return { used, budget: rs.pointCap, remaining: rs.pointCap - used, rosterSize: rs.rosterSize, count: roster.length, violations: v };
}

/** Validate against a ruleset's real (DB-backed) per-format cost map. */
export function validateForRuleset(roster: DcMon[], rs: Ruleset): Validation {
  const map = getFormatCostMap(rs.costFormat);
  return validateRoster(roster, rs, name => map.get(name));
}
