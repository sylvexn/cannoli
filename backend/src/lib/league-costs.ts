/**
 * Per-league cost resolution.
 *
 * A league prices its pool against a named COST FORMAT (`leagues.costFormat`,
 * e.g. 'natdex' | 'natdexplus'). The per-format prices/bans live in the
 * `format_costs` table; the global `pokemon` reference table is the last-resort
 * fallback for any species a format sheet doesn't carry. Resolution:
 *
 *     format_costs[(format, name)]  ??  pokemon[name]
 *
 * Every cost/ban/tera-ban read that happens IN A LEAGUE CONTEXT (draft validation,
 * auto-pick, free agents, trades, the tier-list endpoint) goes through here so a
 * single resolution rule is shared. Roster `costAtDraft` snapshots are unaffected —
 * those freeze the price actually paid and must never be recomputed.
 */

import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { effectiveCost } from './tera-cost';

export interface ResolvedCost {
  tier: number;
  banned: boolean;
  teraBanned: boolean;
}

/** Display labels for the cost formats we ship. New formats can exist in the DB
 *  without an entry here (the admin UI falls back to the raw id). */
export const COST_FORMAT_LABELS: Record<string, string> = {
  natdex: 'NatDex',
  natdexplus: 'NatDex+',
};

export const DEFAULT_COST_FORMAT = 'natdexplus';

// Cache
// Building a format's cost map scans format_costs + pokemon, so cache per format.
// Picks/edits are human-paced, but draft validation can read several times per
// pick. League → format is NOT cached (a cheap single-row read) so changing a
// league's format takes effect immediately without a separate invalidation.
const mapCache = new Map<string, Map<string, ResolvedCost>>();

/** Drop cached cost maps. Call after any write to format_costs (admin edits,
 *  seed/apply scripts). Omit `format` to clear everything. */
export function invalidateCostCache(format?: string): void {
  if (format) mapCache.delete(format);
  else mapCache.clear();
}

/** The resolved cost map for a format: every known species → {tier, banned,
 *  teraBanned}, format overrides first, pokemon baseline as fallback. */
export function getFormatCostMap(format: string): Map<string, ResolvedCost> {
  const cached = mapCache.get(format);
  if (cached) return cached;

  const map = new Map<string, ResolvedCost>();

  // Baseline from the global reference table (covers species absent from the
  // format sheet, e.g. a newly-added mon before the sheet is re-applied).
  for (const p of db.select({
    name: schema.pokemon.name,
    tier: schema.pokemon.tier,
    banned: schema.pokemon.banned,
    teraBanned: schema.pokemon.teraBanned,
  }).from(schema.pokemon).all()) {
    map.set(p.name, { tier: p.tier, banned: !!p.banned, teraBanned: !!p.teraBanned });
  }

  // Format-specific overrides win.
  for (const fc of db.select().from(schema.formatCosts)
    .where(eq(schema.formatCosts.costFormat, format)).all()) {
    map.set(fc.pokemonName, { tier: fc.tier, banned: !!fc.banned, teraBanned: !!fc.teraBanned });
  }

  mapCache.set(format, map);
  return map;
}

/** A league's cost format id (read fresh — cheap, avoids staleness). */
export function getLeagueCostFormat(leagueId: string): string {
  const row = db.select({ costFormat: schema.leagues.costFormat })
    .from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  return row?.costFormat ?? DEFAULT_COST_FORMAT;
}

/** The resolved cost map a league prices against. */
export function getLeagueCostMap(leagueId: string): Map<string, ResolvedCost> {
  return getFormatCostMap(getLeagueCostFormat(leagueId));
}

/** Resolve one species' cost in a format. Returns undefined if the species is
 *  unknown to both the format sheet and the reference table. */
export function resolveCost(format: string, name: string): ResolvedCost | undefined {
  return getFormatCostMap(format).get(name);
}

/** Resolve one species' cost in a league's format. */
export function resolveLeagueCost(leagueId: string, name: string): ResolvedCost | undefined {
  return resolveCost(getLeagueCostFormat(leagueId), name);
}

/** Point cost a species contributes to a roster in a format, with tera-captain
 *  markup applied. Unknown species cost 0 (mirrors the pre-existing helpers). */
export function effectiveCostFor(format: string, name: string, isCaptain: boolean): number {
  const c = getFormatCostMap(format).get(name);
  if (!c) return 0;
  return effectiveCost(c.tier, isCaptain);
}

/** Distinct cost formats present in the DB (format_costs ∪ league assignments),
 *  with display labels and the leagues using each — powers the admin editor's
 *  format picker. */
export function listCostFormats(): { id: string; label: string; leagueIds: string[] }[] {
  const ids = new Set<string>();
  for (const r of db.selectDistinct({ f: schema.formatCosts.costFormat }).from(schema.formatCosts).all()) {
    if (r.f) ids.add(r.f);
  }
  const leagues = db.select({ id: schema.leagues.id, costFormat: schema.leagues.costFormat })
    .from(schema.leagues).all();
  for (const l of leagues) ids.add(l.costFormat);

  return [...ids].sort().map(id => ({
    id,
    label: COST_FORMAT_LABELS[id] ?? id,
    leagueIds: leagues.filter(l => l.costFormat === id).map(l => l.id),
  }));
}
