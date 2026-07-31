import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, sql } from 'drizzle-orm';
import { tx } from '../../lib/tx';
import { requireStaff } from '../../lib/auth-guards';
import { getFormatCostMap, invalidateCostCache, DEFAULT_COST_FORMAT } from '../../lib/league-costs';
import { normalizeRules } from '../../lib/rules-defaults';

// Group-level staff guard: every route below is staff-only. The guard runs
// before each handler and short-circuits non-staff with 401/403, so the check
// is structural rather than hand-copied per handler.
export const configRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })

  // Site Settings

  .put('/api/site-settings', ({ body, set }) => {
    const s = body as Record<string, unknown>;

    db.update(schema.siteSettings).set({
      defaultUserPassword: (s.defaultUserPassword as string) ?? 'password',
      tradeExpiryDays: (s.tradeExpiryDays as number) ?? 7,
      draftTimerEnabled: s.draftTimerEnabled !== undefined ? !!s.draftTimerEnabled : true,
      draftDemoVisible: s.draftDemoVisible !== undefined ? !!s.draftDemoVisible : true,
      faDeadlineWeek: (s.faDeadlineWeek as number) ?? 7,
      defaultPlayoffTeamCount: (s.defaultPlayoffTeamCount as number) ?? 6,
      faPickupsPerSeason: (s.faPickupsPerSeason as number) ?? 6,
    }).where(eq(schema.siteSettings.id, 1)).run();

    return { success: true };
  })

  // Rules content (admin write, per-league)
  // Saves the structured rules document for one league. The body is coerced
  // through normalizeRules (length-capped, shape-validated) before storage.

  .put('/api/leagues/:leagueId/rules', ({ params, body, user, set }) => {
    const league = db.select({ id: schema.leagues.id })
      .from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const content = normalizeRules((body as { content?: unknown })?.content);
    const json = JSON.stringify(content);
    const now = new Date().toISOString();

    tx(() => {
      db.insert(schema.leagueRules)
        .values({ leagueId: params.leagueId, content: json, updatedAt: now, updatedBy: user!.username })
        .onConflictDoUpdate({
          target: schema.leagueRules.leagueId,
          set: { content: json, updatedAt: now, updatedBy: user!.username },
        }).run();
      db.insert(schema.activityLog).values({
        type: 'rules_updated',
        category: 'config',
        actor: user!.username,
        leagueId: params.leagueId,
        description: `Updated rules for ${params.leagueId}`,
        metadata: null,
      }).run();
    });
    return { success: true, content };
  })

  // Reset a league back to its cost-format default by dropping the override.
  .delete('/api/leagues/:leagueId/rules', ({ params, user }) => {
    tx(() => {
      db.delete(schema.leagueRules).where(eq(schema.leagueRules.leagueId, params.leagueId)).run();
      db.insert(schema.activityLog).values({
        type: 'rules_reset',
        category: 'config',
        actor: user!.username,
        leagueId: params.leagueId,
        description: `Reset rules for ${params.leagueId} to format default`,
        metadata: null,
      }).run();
    });
    return { success: true };
  })

  // Tier List

  .put('/api/tier-list/:name', ({ params, body, user, set }) => {
    const { format: rawFormat, tier, status, force, confirmLeague } = body as {
      /** Which cost format to edit — 'natdex' | 'natdexplus'. Edits land in
       *  `format_costs`, so they only affect leagues using that format. */
      format?: string;
      tier?: number;
      status?: string;
      /** Acknowledge that this edit will affect a league past draft — required when active leagues exist */
      force?: boolean;
      /** Must match the active (regular/playoffs) league's name when force=true */
      confirmLeague?: string;
    };
    const format = rawFormat?.trim() || DEFAULT_COST_FORMAT;

    // Phase gate: refuse mid-draft / mid-season tier moves unless the caller
    // explicitly confirms via { force: true, confirmLeague: <league name> }.
    // Roster cost totals are snapshotted via rosters.costAtDraft for completed
    // picks, but a live draft snapshots the *current* tier on each pick — so a
    // mid-draft tier move silently shifts point math for picks made after the
    // edit. 'draft' is included alongside regular/playoffs to surface the
    // risk to admins instead of letting it through.
    //
    // Archived-season leagues count as locked too, even at offseason phase —
    // historical seasons should be read-only so old standings/rosters stay
    // referentially valid.
    const activeLeagues = db.select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      phase: schema.leagues.phase,
    }).from(schema.leagues)
      .innerJoin(schema.seasons, eq(schema.leagues.seasonId, schema.seasons.id))
      .where(sql`${schema.leagues.phase} IN ('draft', 'regular', 'playoffs') OR ${schema.seasons.archived} = 1`)
      .all();

    if (activeLeagues.length > 0) {
      if (!force) {
        set.status = 409;
        return {
          error: `Cannot edit tier list while leagues are in draft/regular/playoffs phase`,
          code: 'tier_list_locked',
          activeLeagues: activeLeagues.map(l => ({ id: l.id, name: l.name, phase: l.phase })),
        };
      }
      const expectedNames = new Set(activeLeagues.map(l => l.name.toLowerCase()));
      if (!confirmLeague || !expectedNames.has(confirmLeague.trim().toLowerCase())) {
        set.status = 409;
        return {
          error: `Force edit requires confirmLeague to match an active league name`,
          code: 'tier_list_confirm_required',
          activeLeagues: activeLeagues.map(l => ({ id: l.id, name: l.name, phase: l.phase })),
        };
      }
    }

    // Resolve the species' CURRENT value in this format (existing format_costs
    // row, or the pokemon-table baseline). Unknown species → 404.
    const before = getFormatCostMap(format).get(params.name);
    if (!before) { set.status = 404; return { error: 'Pokemon not found' }; }

    // Build the full target row (format_costs needs every column on insert).
    const after = { tier: before.tier, banned: before.banned, teraBanned: before.teraBanned };
    if (tier !== undefined) after.tier = tier;
    if (status === 'banned') { after.banned = true; after.teraBanned = false; }
    else if (status === 'tera-banned') { after.teraBanned = true; after.banned = false; }
    else if (status === 'available') { after.banned = false; after.teraBanned = false; }

    tx(() => {
      db.insert(schema.formatCosts).values({
        costFormat: format,
        pokemonName: params.name,
        tier: after.tier,
        banned: after.banned,
        teraBanned: after.teraBanned,
      }).onConflictDoUpdate({
        target: [schema.formatCosts.costFormat, schema.formatCosts.pokemonName],
        set: { tier: after.tier, banned: after.banned, teraBanned: after.teraBanned },
      }).run();

      // Force-edits during regular/playoffs are flagged with a distinct activity
      // type so they're easy to filter in the audit view.
      const isForced = activeLeagues.length > 0;
      db.insert(schema.activityLog).values({
        type: isForced ? 'tier_list_forced_edit' : 'tier_list_edit',
        category: 'config',
        actor: user!.username,
        leagueId: null,
        description: isForced
          ? `FORCED tier-list edit [${format}]: ${params.name} (during ${activeLeagues.map(l => l.name).join(', ')}) — confirmed: "${confirmLeague}"`
          : `Tier-list edit [${format}]: ${params.name}${tier !== undefined ? ` → tier ${tier}` : ''}${status ? ` [${status}]` : ''}`,
        metadata: JSON.stringify({
          pokemon: params.name,
          format,
          before,
          after,
          forced: isForced,
          confirmLeague: confirmLeague ?? null,
          activeLeagues: activeLeagues.map(l => l.id),
        }),
      }).run();
    });

    invalidateCostCache(format);
    return { success: true, forced: activeLeagues.length > 0 };
  })

  // Move Categories CRUD

  .post('/api/move-categories', ({ body, user, set }) => {
    const { name } = body as { name: string };
    if (!name?.trim()) { set.status = 400; return { error: 'Name required' }; }

    const id = name.trim().toLowerCase().replace(/\s+/g, '-');
    const maxSort = db.select({ max: sql<number>`MAX(sort_order)` }).from(schema.moveCategories).get()?.max || 0;

    tx(() => {
      db.insert(schema.moveCategories).values({ id, name: name.trim(), sortOrder: maxSort + 1 }).run();
      db.insert(schema.activityLog).values({
        type: 'move_category_created',
        category: 'config',
        actor: user.username,
        leagueId: null,
        description: `Created move category "${name.trim()}"`,
        metadata: JSON.stringify({ categoryId: id, name: name.trim() }),
      }).run();
    });
    return { id, name: name.trim() };
  })

  .put('/api/move-categories/:id', ({ params, body, user, set }) => {
    const { name } = body as { name: string };
    if (!name?.trim()) { set.status = 400; return { error: 'Name required' }; }
    const existing = db.select().from(schema.moveCategories).where(eq(schema.moveCategories.id, params.id)).get();
    if (!existing) { set.status = 404; return { error: 'Category not found' }; }

    tx(() => {
      db.update(schema.moveCategories).set({ name: name.trim() }).where(eq(schema.moveCategories.id, params.id)).run();
      db.insert(schema.activityLog).values({
        type: 'move_category_updated',
        category: 'config',
        actor: user.username,
        leagueId: null,
        description: `Renamed move category "${existing.name}" → "${name.trim()}"`,
        metadata: JSON.stringify({ categoryId: params.id, oldName: existing.name, newName: name.trim() }),
      }).run();
    });
    return { success: true };
  })

  .delete('/api/move-categories/:id', ({ params, user, set }) => {
    const existing = db.select().from(schema.moveCategories).where(eq(schema.moveCategories.id, params.id)).get();
    if (!existing) { set.status = 404; return { error: 'Category not found' }; }
    const entryCount = db.select({ c: sql<number>`COUNT(*)` })
      .from(schema.moveCategoryEntries)
      .where(eq(schema.moveCategoryEntries.categoryId, params.id))
      .get()?.c ?? 0;

    tx(() => {
      db.delete(schema.moveCategoryEntries).where(eq(schema.moveCategoryEntries.categoryId, params.id)).run();
      db.delete(schema.moveCategories).where(eq(schema.moveCategories.id, params.id)).run();
      db.insert(schema.activityLog).values({
        type: 'move_category_deleted',
        category: 'config',
        actor: user.username,
        leagueId: null,
        description: `Deleted move category "${existing.name}" (${entryCount} entries)`,
        metadata: JSON.stringify({ categoryId: params.id, name: existing.name, entryCount }),
      }).run();
    });
    return { success: true };
  })

  .post('/api/move-categories/:id/entries', ({ params, body, user, set }) => {
    const { name, isAbility } = body as { name: string; isAbility?: boolean };
    if (!name?.trim()) { set.status = 400; return { error: 'Name required' }; }
    const cat = db.select().from(schema.moveCategories).where(eq(schema.moveCategories.id, params.id)).get();
    if (!cat) { set.status = 404; return { error: 'Category not found' }; }

    const moveId = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const entryId = tx(() => {
      const row = db.insert(schema.moveCategoryEntries).values({
        categoryId: params.id,
        name: name.trim(),
        moveId,
        isAbility: isAbility || false,
      }).returning().get();
      db.insert(schema.activityLog).values({
        type: 'move_category_entry_added',
        category: 'config',
        actor: user.username,
        leagueId: null,
        description: `Added ${isAbility ? 'ability' : 'move'} "${name.trim()}" to "${cat.name}"`,
        metadata: JSON.stringify({ categoryId: params.id, categoryName: cat.name, entryId: row.id, name: name.trim(), isAbility: !!isAbility }),
      }).run();
      return row.id;
    });
    return { success: true, id: entryId };
  })

  .put('/api/move-category-entries/:id', ({ params, body, user, set }) => {
    const id = parseInt(params.id);
    const { name, isAbility } = body as { name?: string; isAbility?: boolean };
    const existing = db.select().from(schema.moveCategoryEntries).where(eq(schema.moveCategoryEntries.id, id)).get();
    if (!existing) { set.status = 404; return { error: 'Entry not found' }; }

    const updates: Record<string, unknown> = {};
    if (typeof name === 'string' && name.trim()) {
      updates.name = name.trim();
      updates.moveId = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    if (typeof isAbility === 'boolean') updates.isAbility = isAbility;
    if (Object.keys(updates).length === 0) {
      set.status = 400; return { error: 'No valid fields to update' };
    }

    const cat = db.select().from(schema.moveCategories).where(eq(schema.moveCategories.id, existing.categoryId)).get();
    tx(() => {
      db.update(schema.moveCategoryEntries).set(updates).where(eq(schema.moveCategoryEntries.id, id)).run();
      db.insert(schema.activityLog).values({
        type: 'move_category_entry_updated',
        category: 'config',
        actor: user.username,
        leagueId: null,
        description: `Updated entry "${existing.name}"${updates.name && updates.name !== existing.name ? ` → "${updates.name}"` : ''} in "${cat?.name ?? existing.categoryId}"`,
        metadata: JSON.stringify({
          entryId: id,
          categoryId: existing.categoryId,
          before: { name: existing.name, isAbility: existing.isAbility },
          after: { name: updates.name ?? existing.name, isAbility: updates.isAbility ?? existing.isAbility },
        }),
      }).run();
    });
    return { success: true };
  })

  .delete('/api/move-category-entries/:id', ({ params, user, set }) => {
    const id = parseInt(params.id);
    const existing = db.select().from(schema.moveCategoryEntries).where(eq(schema.moveCategoryEntries.id, id)).get();
    if (!existing) { set.status = 404; return { error: 'Entry not found' }; }
    const cat = db.select().from(schema.moveCategories).where(eq(schema.moveCategories.id, existing.categoryId)).get();

    tx(() => {
      db.delete(schema.moveCategoryEntries).where(eq(schema.moveCategoryEntries.id, id)).run();
      db.insert(schema.activityLog).values({
        type: 'move_category_entry_deleted',
        category: 'config',
        actor: user.username,
        leagueId: null,
        description: `Removed ${existing.isAbility ? 'ability' : 'move'} "${existing.name}" from "${cat?.name ?? existing.categoryId}"`,
        metadata: JSON.stringify({ entryId: id, categoryId: existing.categoryId, name: existing.name, isAbility: existing.isAbility }),
      }).run();
    });
    return { success: true };
  })

;
