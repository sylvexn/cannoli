/**
 * Draft Center rulesets + roster validator.
 *
 * Teams attach to a real `rulesets` row (draft_center_teams.ruleset_id); legacy
 * league-keyed teams resolve to their league's ruleset.
 *
 * Validation WARNS, it never blocks — callers store illegal teams as-is and the
 * UI renders the violations. The validator is pure (cost lookup injected) so it
 * is unit-testable without a DB; `validateForRuleset` wires the real cost map.
 */

import { eq } from 'drizzle-orm';
import { DEFAULT_RULESET as BASE_RULESET, captainEligible, markupCost, megaLimit, rosterBand, type Ruleset as SharedRuleset } from '@cannoli/rules';
import { db, schema } from '../../db';
import { COST_FORMAT_LABELS, getFormatCostMap, type ResolvedCost } from '../league-costs';
import { getLeagueRuleset, getRuleset } from '../rulesets';
import { getBaseFormName, getFormCategory } from '../pokedex';
import type { DcMon } from './types';

/** The shared ruleset plus display bits. Roster cap for DC is `rosterMax ?? rosterSize`. */
export type Ruleset = SharedRuleset & { label: string; leagueId: string | null };

/** Fallback when a team has no ruleset/league. Band 10-12 keeps DC's historic 12-mon cap. */
export const DEFAULT_RULESET: Ruleset = {
  ...BASE_RULESET,
  rosterMax: 12,
  label: BASE_RULESET.name,
  leagueId: null,
};

const labelFor = (r: SharedRuleset) => r.name || `${COST_FORMAT_LABELS[r.costFormat] ?? r.costFormat}`;

/** league -> its ruleset (compat). Null/unknown league -> DEFAULT_RULESET. */
export function resolveRuleset(leagueId: string | null | undefined): Ruleset {
  if (!leagueId) return DEFAULT_RULESET;
  const exists = db.select({ id: schema.leagues.id }).from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  if (!exists) return DEFAULT_RULESET;
  const rs = getLeagueRuleset(leagueId);
  return { ...rs, label: labelFor(rs), leagueId };
}

/** A team's ruleset: its own ruleset_id, else its league's, else the default. */
export function resolveTeamRuleset(t: { rulesetId: number | null; leagueId: string | null }): Ruleset {
  const rs = t.rulesetId != null ? getRuleset(t.rulesetId) : undefined;
  if (rs) return { ...rs, label: labelFor(rs), leagueId: t.leagueId };
  return resolveRuleset(t.leagueId);
}

export type ViolationCode =
  | 'over_budget' | 'roster_over' | 'multi_mega' | 'duplicate_species' | 'banned' | 'unknown_pokemon'
  | 'captain_count' | 'captain_tier' | 'captain_tera_banned' | 'tera_types_over' | 'captain_no_tera'
  | 'tera_disabled' | 'roster_under';

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
    if (c) used += markupCost(rs, c.tier, m.captain);
    if (c?.banned) v.push({ code: 'banned', severity: 'warn', pokemon: m.name, message: `${m.name} is banned in this format` });
    else if (!c) v.push({ code: 'unknown_pokemon', severity: 'warn', pokemon: m.name, message: `${m.name} has no price in this format` });

    const base = getBaseFormName(m.name);
    const prev = seen.get(base);
    if (prev) v.push({ code: 'duplicate_species', severity: 'warn', pokemon: m.name, message: `${m.name} duplicates ${prev} (same National Dex number)` });
    else seen.set(base, m.name);

    if (getFormCategory(m.name) === 'mega') megas.push(m.name);
    // ponytail: shared mega cap counts only Mega-category forms here (primals not detected by getFormCategory).

    if (m.captain) {
      if (!rs.teraEnabled) {
        v.push({ code: 'tera_disabled', severity: 'warn', pokemon: m.name, message: `${m.name} is a captain but Tera is disabled in this ruleset` });
      } else if (c?.teraBanned) {
        v.push({ code: 'captain_tera_banned', severity: 'warn', pokemon: m.name, message: `${m.name} is tera-banned and cannot be a captain` });
      } else if (c && !captainEligible(rs, { tier: c.tier })) {
        v.push({ code: 'captain_tier', severity: 'warn', pokemon: m.name, message: `${m.name} is tier ${c.tier}, which cannot be a tera captain under this ruleset` });
      }
      if (!rs.teraEnabled) {
        // no tera-type checks without tera
      } else if (m.teraTypes.length > rs.teraTypesPerCaptain) {
        v.push({ code: 'tera_types_over', severity: 'warn', pokemon: m.name, message: `${m.name} has more than ${rs.teraTypesPerCaptain} tera types` });
      } else if (m.teraTypes.length < rs.teraTypesPerCaptain) {
        v.push({ code: 'captain_no_tera', severity: 'info', pokemon: m.name, message: `${m.name} has ${m.teraTypes.length}/${rs.teraTypesPerCaptain} tera types picked` });
      }
    }
  }

  if (megas.length > megaLimit(rs)) {
    v.push({ code: 'multi_mega', severity: 'warn', message: `${megas.length} Megas (${megas.join(', ')}); max ${megaLimit(rs)} per team` });
  }
  if (rs.teraEnabled && captains.length > rs.teraCaptainSlots) {
    v.push({ code: 'captain_count', severity: 'warn', message: `${captains.length} captains; this league allows ${rs.teraCaptainSlots}` });
  }
  const { min: rosterMin, max: rosterCap } = rosterBand(rs);
  if (roster.length > rosterCap) {
    v.push({ code: 'roster_over', severity: 'warn', message: `${roster.length} Pokemon; roster size is ${rosterCap}` });
  }
  if (roster.length > 0 && roster.length < rosterMin) {
    v.push({ code: 'roster_under', severity: 'info', message: `${roster.length}/${rosterMin} - ${rosterMin - roster.length} more to fill` });
  }
  if (used > rs.pointCap) {
    v.push({ code: 'over_budget', severity: 'warn', message: `${used} points used; budget is ${rs.pointCap}` });
  }

  return { used, budget: rs.pointCap, remaining: rs.pointCap - used, rosterSize: rosterCap, count: roster.length, violations: v };
}

/** Validate against a ruleset's real (DB-backed) per-format cost map. */
export function validateForRuleset(roster: DcMon[], rs: Ruleset): Validation {
  const map = getFormatCostMap(rs.costFormat);
  return validateRoster(roster, rs, name => map.get(name));
}
