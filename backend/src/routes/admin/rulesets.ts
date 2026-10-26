import { Elysia } from 'elysia';
import { eq, desc } from 'drizzle-orm';
import { validateRulesetShape, parseMarkup, type Ruleset } from '@cannoli/rules';
import { db, schema } from '../../db';
import { requireStaff } from '../../lib/auth-guards';
import { getLeagueRuleset, invalidateRulesetCache, rowToRuleset, rulesetUsage } from '../../lib/rulesets';

/**
 * Ruleset library + instances (plan/ruleset-design.md).
 * - Templates (is_template) are freely editable; instances are what leagues point at.
 * - An instance is FROZEN once any referencing league leaves predraft (or its season
 *   is archived): only name/description/archived/band stay editable (band not for
 *   archived-season instances). Escape hatch = fork for one league (with edits).
 */

type Row = typeof schema.rulesets.$inferSelect;
type Body = Record<string, unknown>;

/** Fields that stay editable on a frozen (but not season-archived) instance. */
const ALWAYS_EDITABLE = ['name', 'description', 'archived', 'rosterMin', 'rosterMax'];
const META_ONLY = ['name', 'description', 'archived'];

/** Request field -> column. Everything else in a body is ignored. */
const FIELDS = [
  'name', 'description', 'costFormat', 'pointCap', 'rosterSize', 'rosterMin', 'rosterMax', 'megaCap',
  'teraEnabled', 'teraCaptainSlots', 'teraTypesPerCaptain', 'teraMarkup', 'archived',
] as const;

function toJson(r: Row) {
  const usage = r.isTemplate ? { frozen: false, leagueIds: [] as string[], draftCenterTeams: 0 } : rulesetUsage(r.id);
  return {
    ...rowToRuleset(r),
    description: r.description,
    isTemplate: r.isTemplate,
    sourceRulesetId: r.sourceRulesetId,
    archived: r.archived,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdBy: r.createdBy,
    frozen: usage.frozen,
    usedBy: usage.leagueIds,
    draftCenterTeams: usage.draftCenterTeams,
  };
}

/** Apply requested changes over a row's rules; returns the merged column values or an error. */
function merge(base: Row, b: Body): { values: Partial<Row>; error?: string } {
  const values: Partial<Row> = {};
  for (const f of FIELDS) {
    if (!(f in b)) continue;
    const v = b[f];
    if (f === 'teraMarkup') {
      const m = typeof v === 'string' ? v : JSON.stringify(v);
      const parsed = parseMarkup(m);
      if (Object.keys(parsed).length === 0 && v && Object.keys(v as object).length > 0) return { values, error: 'teraMarkup invalid' };
      values.teraMarkup = JSON.stringify(parsed);
    } else if (f === 'name') {
      if (typeof v !== 'string' || !v.trim()) return { values, error: 'name required' };
      values.name = v.trim();
    } else if (f === 'description') {
      values.description = typeof v === 'string' && v.trim() ? v.trim() : null;
    } else if (f === 'costFormat') {
      if (typeof v !== 'string' || !v.trim()) return { values, error: 'costFormat required' };
      values.costFormat = v.trim();
    } else if (f === 'teraEnabled' || f === 'archived') {
      (values as Record<string, unknown>)[f] = !!v;
    } else if (f === 'rosterMin' || f === 'rosterMax' || f === 'megaCap') {
      if (v !== null && !Number.isInteger(v)) return { values, error: `${f} must be an integer or null` };
      (values as Record<string, unknown>)[f] = v;
    } else {
      if (!Number.isInteger(v)) return { values, error: `${f} must be an integer` };
      (values as Record<string, unknown>)[f] = v;
    }
  }
  if (values.teraEnabled === false && !('teraCaptainSlots' in b)) values.teraCaptainSlots = 0;
  const merged = { ...base, ...values };
  const errs = validateRulesetShape(rowToRuleset(merged as Row) as Ruleset);
  return errs.length ? { values, error: errs.join('; ') } : { values };
}

function clone(src: Row, name: string, isTemplate: boolean, userId: number | null, overrides: Partial<Row> = {}): Row {
  return db.insert(schema.rulesets).values({
    name,
    description: src.description,
    isTemplate,
    sourceRulesetId: src.id,
    costFormat: src.costFormat,
    pointCap: src.pointCap,
    rosterSize: src.rosterSize,
    rosterMin: src.rosterMin,
    rosterMax: src.rosterMax,
    megaCap: src.megaCap,
    teraEnabled: src.teraEnabled,
    teraCaptainSlots: src.teraCaptainSlots,
    teraTypesPerCaptain: src.teraTypesPerCaptain,
    teraMarkup: src.teraMarkup,
    policy: src.policy,
    createdBy: userId,
    ...overrides,
  }).returning().get();
}

function log(user: { username: string }, type: string, description: string, meta: unknown, leagueId?: string) {
  db.insert(schema.activityLog).values({
    type, category: 'config', actor: user.username, leagueId: leagueId ?? null, description,
    metadata: JSON.stringify(meta),
  }).run();
}

const getRow = (id: number) => db.select().from(schema.rulesets).where(eq(schema.rulesets.id, id)).get();

export const rulesetAdminRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })

  // List: ?kind=template|instance (default all), ?archived=1 includes archived
  .get('/api/admin/rulesets', ({ query }) => {
    let rows = db.select().from(schema.rulesets).orderBy(desc(schema.rulesets.id)).all();
    if (query.kind === 'template') rows = rows.filter(r => r.isTemplate);
    else if (query.kind === 'instance') rows = rows.filter(r => !r.isTemplate);
    if (query.archived !== '1') rows = rows.filter(r => !r.archived);
    return rows.map(toJson);
  })

  .get('/api/admin/rulesets/:id', ({ params, set }) => {
    const row = getRow(Number(params.id));
    if (!row) { set.status = 404; return { error: 'Ruleset not found' }; }
    return toJson(row);
  })

  // Create a template (from scratch, over standard defaults)
  .post('/api/admin/rulesets', ({ body, user, set }) => {
    const b = (body ?? {}) as Body;
    const blank = {
      name: '', description: null, isTemplate: true, sourceRulesetId: null, costFormat: 'natdexplus',
      pointCap: 110, rosterSize: 10, rosterMin: null, rosterMax: null, megaCap: 1, teraEnabled: true,
      teraCaptainSlots: 2, teraTypesPerCaptain: 3,
      teraMarkup: JSON.stringify({ 9: 12, 8: 10, 7: 9, 6: 8, 5: 6, 4: 5, 3: 4, 2: 2, 1: 1 }),
      policy: null, archived: false,
    } as unknown as Row;
    const { values, error } = merge(blank, b);
    if (error) { set.status = 400; return { error }; }
    const row = db.insert(schema.rulesets).values({
      ...blank, ...values, id: undefined, createdBy: parseInt(user.id),
    } as typeof schema.rulesets.$inferInsert).returning().get();
    log(user, 'ruleset_created', `Created ruleset template "${row.name}"`, { rulesetId: row.id });
    return toJson(row);
  })

  // Update (freeze rules apply to instances)
  .put('/api/admin/rulesets/:id', ({ params, body, user, set }) => {
    const row = getRow(Number(params.id));
    if (!row) { set.status = 404; return { error: 'Ruleset not found' }; }
    const b = (body ?? {}) as Body;
    const usage = row.isTemplate ? null : rulesetUsage(row.id);
    const seasonArchived = usage?.leagueIds.some(id => {
      const l = db.select({ a: schema.seasons.archived }).from(schema.leagues)
        .innerJoin(schema.seasons, eq(schema.seasons.id, schema.leagues.seasonId))
        .where(eq(schema.leagues.id, id)).get();
      return l?.a;
    });
    const allowed = row.archived ? ['archived'] : seasonArchived ? META_ONLY : usage?.frozen ? ALWAYS_EDITABLE : null;
    if (allowed) {
      const blocked = FIELDS.filter(f => f in b && !allowed.includes(f) && b[f] !== (row as Record<string, unknown>)[f]);
      if (blocked.length) {
        set.status = 409;
        return { error: 'Ruleset is frozen', code: 'RULESET_FROZEN', usedBy: usage?.leagueIds ?? [], fields: blocked };
      }
    }
    const { values, error } = merge(row, b);
    if (error) { set.status = 400; return { error }; }
    const updated = db.update(schema.rulesets)
      .set({ ...values, updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) })
      .where(eq(schema.rulesets.id, row.id)).returning().get();
    invalidateRulesetCache(row.id);
    log(user, 'ruleset_updated', `Updated ruleset "${updated.name}"`, { rulesetId: row.id, changed: Object.keys(values) });
    return toJson(updated);
  })

  // Clone to a new template (default) or instance
  .post('/api/admin/rulesets/:id/clone', ({ params, body, user, set }) => {
    const src = getRow(Number(params.id));
    if (!src) { set.status = 404; return { error: 'Ruleset not found' }; }
    const b = (body ?? {}) as Body;
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : `${src.name} (copy)`;
    const row = clone(src, name, b.asInstance ? false : true, parseInt(user.id));
    log(user, 'ruleset_cloned', `Cloned ruleset "${src.name}" -> "${name}"`, { from: src.id, to: row.id });
    return toJson(row);
  })

  // Fork an instance for ONE league (escape hatch for frozen instances), optionally with edits.
  .post('/api/admin/rulesets/:id/fork', ({ params, body, user, set }) => {
    const src = getRow(Number(params.id));
    if (!src) { set.status = 404; return { error: 'Ruleset not found' }; }
    const b = (body ?? {}) as Body & { changes?: Body };
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, String(b.leagueId ?? ''))).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }
    if (league.rulesetId !== src.id) { set.status = 400; return { error: 'League does not use this ruleset' }; }
    if (league.phase !== 'predraft' && league.phase !== 'draft') {
      set.status = 409; return { error: 'Forking is only allowed in predraft or draft' };
    }
    const { values, error } = merge(src, b.changes ?? {});
    if (error) { set.status = 400; return { error }; }
    const row = db.transaction(() => {
      const fork = clone(src, typeof b.name === 'string' && b.name.trim() ? b.name.trim() : `${src.name} · ${league.name}`, false, parseInt(user.id), values);
      db.update(schema.leagues).set({ rulesetId: fork.id }).where(eq(schema.leagues.id, league.id)).run();
      return fork;
    });
    log(user, 'ruleset_forked', `Forked ruleset "${src.name}" for ${league.name}`, { from: src.id, to: row.id }, league.id);
    return toJson(row);
  })

  // Point a league at a ruleset (predraft only). A template is copied into a fresh instance.
  .post('/api/admin/rulesets/:id/assign', ({ params, body, user, set }) => {
    const src = getRow(Number(params.id));
    if (!src) { set.status = 404; return { error: 'Ruleset not found' }; }
    if (src.archived) { set.status = 400; return { error: 'Ruleset is archived' }; }
    const league = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, String((body as Body | null)?.leagueId ?? ''))).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }
    if (league.phase !== 'predraft') { set.status = 409; return { error: 'Ruleset can only be changed in predraft' }; }
    const row = db.transaction(() => {
      const target = src.isTemplate ? clone(src, `${src.name} · ${league.name}`, false, parseInt(user.id)) : src;
      db.update(schema.leagues).set({ rulesetId: target.id }).where(eq(schema.leagues.id, league.id)).run();
      return target;
    });
    log(user, 'ruleset_assigned', `Set ruleset "${row.name}" on ${league.name}`, { rulesetId: row.id }, league.id);
    return toJson(row);
  })

  // Delete: only when nothing references it
  .delete('/api/admin/rulesets/:id', ({ params, user, set }) => {
    const row = getRow(Number(params.id));
    if (!row) { set.status = 404; return { error: 'Ruleset not found' }; }
    const usage = rulesetUsage(row.id);
    const children = db.select({ id: schema.rulesets.id }).from(schema.rulesets)
      .where(eq(schema.rulesets.sourceRulesetId, row.id)).all().length;
    if (usage.leagueIds.length || usage.draftCenterTeams || children) {
      set.status = 409;
      return { error: 'Ruleset is in use - archive it instead', usedBy: usage.leagueIds, draftCenterTeams: usage.draftCenterTeams, children };
    }
    db.delete(schema.rulesets).where(eq(schema.rulesets.id, row.id)).run();
    invalidateRulesetCache(row.id);
    log(user, 'ruleset_deleted', `Deleted ruleset "${row.name}"`, { rulesetId: row.id });
    return { success: true };
  })

  // Resolved view for a league (what the engine would use)
  .get('/api/admin/rulesets/for-league/:leagueId', ({ params, set }) => {
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }
    return { rulesetId: league.rulesetId, ruleset: getLeagueRuleset(league.id) };
  });
