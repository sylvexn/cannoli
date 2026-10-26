/**
 * League <-> ruleset write helpers (used by the season wizard and PUT /api/leagues/:id).
 * The season row is never a rules store any more.
 */
import { eq } from 'drizzle-orm';
import { DEFAULT_MARKUP, validateRulesetShape } from '@cannoli/rules';
import { db, schema } from '../db';
import { getLeagueRuleset, invalidateRulesetCache, rowToRuleset, rulesetUsage } from './rulesets';

type Row = typeof schema.rulesets.$inferSelect;

export interface LegacyRules {
  costFormat?: string;
  pointCap?: number;
  rosterSize?: number;
  rosterMin?: number | null;
  rosterMax?: number | null;
  teraCaptainSlots?: number;
}

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/**
 * Create a league-bound instance: a copy of `sourceId` (template or instance) when
 * given, else built from legacy fields over the standard defaults. Throws on an
 * unknown/archived source or an internally inconsistent result.
 */
export function createInstance(name: string, opts: { sourceId?: number | null; legacy?: LegacyRules; userId?: number | null }): Row {
  const src = opts.sourceId != null
    ? db.select().from(schema.rulesets).where(eq(schema.rulesets.id, opts.sourceId)).get()
    : undefined;
  if (opts.sourceId != null && !src) throw new Error(`Ruleset ${opts.sourceId} not found`);
  if (src?.archived) throw new Error(`Ruleset ${src.id} is archived`);
  const l = opts.legacy ?? {};
  const values = {
    name,
    description: src?.description ?? null,
    isTemplate: false,
    sourceRulesetId: src?.id ?? null,
    costFormat: src?.costFormat ?? l.costFormat ?? 'natdexplus',
    pointCap: src?.pointCap ?? l.pointCap ?? 110,
    rosterSize: src?.rosterSize ?? l.rosterSize ?? 10,
    rosterMin: src ? src.rosterMin : (l.rosterMin ?? null),
    rosterMax: src ? src.rosterMax : (l.rosterMax ?? null),
    megaCap: src ? src.megaCap : 1,
    teraEnabled: src?.teraEnabled ?? true,
    teraCaptainSlots: src?.teraCaptainSlots ?? l.teraCaptainSlots ?? 2,
    teraTypesPerCaptain: src?.teraTypesPerCaptain ?? 3,
    teraMarkup: src?.teraMarkup ?? JSON.stringify(DEFAULT_MARKUP),
    policy: src?.policy ?? null,
    createdBy: opts.userId ?? null,
  };
  const errs = validateRulesetShape(rowToRuleset({ ...values, id: 0, archived: false, createdAt: null, updatedAt: null } as Row));
  if (errs.length) throw new Error(`Invalid ruleset: ${errs.join('; ')}`);
  return db.insert(schema.rulesets).values(values).returning().get();
}

export type RuleEdit = { pointCap?: number; teraCaptainSlots?: number; rosterSize?: number };

/**
 * Edit rules for ONE league through its ruleset. Never touches the season row or
 * other leagues: an un-backfilled league, or an instance shared with other
 * leagues, is given a private copy first. Frozen instances are refused (the
 * caller answers 409 + fork hint). Run inside the caller's transaction.
 */
export function editLeagueRules(
  league: { id: string; name: string; rulesetId: number | null },
  edit: RuleEdit,
  userId?: number | null,
): { frozen: true; usedBy: string[]; rulesetId: number } | { frozen: false; rulesetId: number } | { error: string } {
  let row = league.rulesetId != null
    ? db.select().from(schema.rulesets).where(eq(schema.rulesets.id, league.rulesetId)).get()
    : undefined;
  if (row) {
    const usage = rulesetUsage(row.id);
    if (usage.frozen) return { frozen: true, usedBy: usage.leagueIds, rulesetId: row.id };
  }
  const patch: Partial<Row> = {};
  if (edit.pointCap !== undefined) patch.pointCap = edit.pointCap;
  if (edit.teraCaptainSlots !== undefined) patch.teraCaptainSlots = edit.teraCaptainSlots;
  if (edit.rosterSize !== undefined) patch.rosterSize = edit.rosterSize;

  const shared = row && rulesetUsage(row.id).leagueIds.some(id => id !== league.id);
  if (!row || shared) {
    const cur = getLeagueRuleset(league.id);
    row = createInstance(`${row?.name ?? 'Custom'} · ${league.name}`, {
      sourceId: row?.id,
      legacy: row ? undefined : cur,
      userId,
    });
    db.update(schema.leagues).set({ rulesetId: row.id }).where(eq(schema.leagues.id, league.id)).run();
  }
  const errs = validateRulesetShape(rowToRuleset({ ...row, ...patch } as Row));
  if (errs.length) return { error: errs.join('; ') };
  db.update(schema.rulesets).set({ ...patch, updatedAt: now() }).where(eq(schema.rulesets.id, row.id)).run();
  invalidateRulesetCache(row.id);
  return { frozen: false, rulesetId: row.id };
}
