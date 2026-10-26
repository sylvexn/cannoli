/**
 * Ruleset resolver + cache (plan/ruleset-design.md). Foundation only: nothing
 * enforces through this yet. A league resolves to, in order:
 *   1. its `rulesets` row (with the league's own roster band override applied),
 *   2. a ruleset DERIVED from the legacy season/league columns (pre-backfill DBs),
 *   3. the built-in default.
 * so the answer is always a complete `Ruleset`.
 */
import { eq } from 'drizzle-orm';
import { DEFAULT_RULESET, parseMarkup, type Ruleset } from '@cannoli/rules';
import { db, schema } from '../db';

type Row = typeof schema.rulesets.$inferSelect;

export function rowToRuleset(r: Row): Ruleset {
  return {
    id: r.id,
    name: r.name,
    costFormat: r.costFormat,
    pointCap: r.pointCap,
    rosterSize: r.rosterSize,
    rosterMin: r.rosterMin,
    rosterMax: r.rosterMax,
    megaCap: r.megaCap,
    teraEnabled: r.teraEnabled,
    teraCaptainSlots: r.teraCaptainSlots,
    teraTypesPerCaptain: r.teraTypesPerCaptain,
    teraMarkup: parseMarkup(r.teraMarkup),
  };
}

// ponytail: per-process cache keyed by id, cleared on every write through the
// admin routes. Out-of-process writers (scripts) must restart the backend.
const cache = new Map<number, Ruleset>();

export function invalidateRulesetCache(id?: number): void {
  if (id == null) cache.clear(); else cache.delete(id);
}

export function getRuleset(id: number): Ruleset | undefined {
  const hit = cache.get(id);
  if (hit) return hit;
  const row = db.select().from(schema.rulesets).where(eq(schema.rulesets.id, id)).get();
  if (!row) return undefined;
  const rs = rowToRuleset(row);
  cache.set(id, rs);
  return rs;
}

/**
 * Copy a ruleset's mirrored columns onto the leagues that use it. Pricing reads
 * `leagues.cost_format` and older readers use the roster columns, so they must
 * follow the ruleset after an assign, fork or edit.
 */
export function syncLeagueMirrors(rulesetId: number): void {
  const r = db.select().from(schema.rulesets).where(eq(schema.rulesets.id, rulesetId)).get();
  if (!r) return;
  db.update(schema.leagues).set({
    costFormat: r.costFormat, rosterSize: r.rosterSize, minRosterSize: r.rosterMin, maxRosterSize: r.rosterMax,
  }).where(eq(schema.leagues.rulesetId, rulesetId)).run();
}

/** The ruleset a league plays under (never undefined). */
export function getLeagueRuleset(leagueId: string): Ruleset {
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  if (!league) return { ...DEFAULT_RULESET };

  const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get();
  const base = (league.rulesetId != null ? getRuleset(league.rulesetId) : undefined) ?? {
    ...DEFAULT_RULESET,
    name: `${league.name} (derived)`,
    costFormat: league.costFormat,
    pointCap: season?.pointCap ?? DEFAULT_RULESET.pointCap,
    rosterSize: league.rosterSize,
    teraCaptainSlots: season?.teraCaptainSlots ?? DEFAULT_RULESET.teraCaptainSlots,
  };
  // Per-league band override wins (league.min ?? ruleset.min ?? rosterSize).
  return {
    ...base,
    rosterMin: league.minRosterSize ?? base.rosterMin,
    rosterMax: league.maxRosterSize ?? base.rosterMax,
  };
}

/**
 * Frozen = any referencing league has left predraft, or belongs to an archived
 * season. Templates are never frozen.
 */
export function rulesetUsage(id: number): { frozen: boolean; leagueIds: string[]; draftCenterTeams: number } {
  const rows = db.select({
    id: schema.leagues.id,
    phase: schema.leagues.phase,
    seasonArchived: schema.seasons.archived,
  }).from(schema.leagues)
    .innerJoin(schema.seasons, eq(schema.seasons.id, schema.leagues.seasonId))
    .where(eq(schema.leagues.rulesetId, id)).all();
  const dc = db.select({ id: schema.draftCenterTeams.id }).from(schema.draftCenterTeams)
    .where(eq(schema.draftCenterTeams.rulesetId, id)).all().length;
  return {
    frozen: rows.some(r => r.phase !== 'predraft' || r.seasonArchived),
    leagueIds: rows.map(r => r.id),
    draftCenterTeams: dc,
  };
}
