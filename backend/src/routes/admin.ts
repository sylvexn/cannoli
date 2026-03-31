import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, sql, asc, desc } from 'drizzle-orm';
import { hashPassword, isStaff, isStaffOrTeamOwner } from '../lib/auth';
import { generateLeagueSchedule } from '../lib/schedule-generator';
import { tx } from '../lib/tx';
import { getBotStatus } from '../lib/ps-bot';
import { runOnce } from '../lib/scheduler';

export const adminRoutes = new Elysia()

  // ─── Users (admin read) ──────────────────────────────────────────────

  .get('/api/users', ({ user, set }) => {
    if (!isStaff(user)) {
      set.status = 403;
      return { error: 'Forbidden' };
    }
    return db.select({
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
      mustChangePassword: schema.users.mustChangePassword,
      active: schema.users.active,
      createdAt: schema.users.createdAt,
      primaryColor: schema.users.primaryColor,
      secondaryColor: schema.users.secondaryColor,
      tertiaryColor: schema.users.tertiaryColor,
    }).from(schema.users)
      .orderBy(asc(schema.users.id))
      .all()
      .map(u => ({ ...u, id: String(u.id) }));
  })

  // ─── PS Bot Status ──────────────────────────────────────────────────

  .get('/api/admin/bot-status', ({ user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    return getBotStatus();
  })

  // ─── Manual job trigger (admin tool) ────────────────────────────────

  .post('/api/admin/jobs/:name/run', async ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const ok = await runOnce(params.name);
    if (!ok) { set.status = 404; return { error: `Unknown job: ${params.name}` }; }
    db.insert(schema.activityLog).values({
      type: 'job_run',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Manually ran job: ${params.name}`,
      metadata: JSON.stringify({ jobName: params.name }),
    }).run();
    return { success: true };
  })

  // ─── Force match result (admin override for forfeits / disputes) ────

  .post('/api/admin/matches/:matchId/force-result', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { homeScore, awayScore, forfeitedBy, note } = body as {
      homeScore: number; awayScore: number;
      forfeitedBy?: 'home' | 'away' | 'both' | null;
      note?: string;
    };
    const match = db.select().from(schema.matches).where(eq(schema.matches.id, params.matchId)).get();
    if (!match) { set.status = 404; return { error: 'Match not found' }; }

    // If overwriting a previously-recorded result, snapshot prior K/D rows so
    // history isn't silently destroyed. Activity log metadata is the system of
    // record (no separate history table).
    const isOverwrite = match.status === 'completed' || match.status === 'disputed';
    const priorPokemon = isOverwrite
      ? db.select().from(schema.matchPokemon)
          .where(eq(schema.matchPokemon.matchId, params.matchId))
          .all()
      : [];

    tx(() => {
      db.update(schema.matches).set({
        status: 'completed',
        homeScore: homeScore ?? 0,
        awayScore: awayScore ?? 0,
        forfeitedBy: forfeitedBy ?? null,
        completedAt: new Date().toISOString(),
        warnings: null,
      }).where(eq(schema.matches.id, params.matchId)).run();

      if (isOverwrite) {
        db.insert(schema.activityLog).values({
          type: 'match_result_overwritten',
          category: 'admin',
          actor: user.username,
          leagueId: match.leagueId,
          description: `Overwrote prior result for ${params.matchId}: was ${match.homeScore ?? '-'}-${match.awayScore ?? '-'}, now ${homeScore}-${awayScore}`,
          metadata: JSON.stringify({
            matchId: params.matchId,
            previous: priorPokemon,
            new: [],
            priorScore: { home: match.homeScore, away: match.awayScore },
            newScore: { home: homeScore, away: awayScore },
            by: user.username,
          }),
        }).run();
      }

      db.insert(schema.activityLog).values({
        type: 'match_force_result',
        category: 'admin',
        actor: user.username,
        leagueId: match.leagueId,
        description: `Force-recorded ${params.matchId}: ${homeScore}-${awayScore}${forfeitedBy ? ` (forfeit: ${forfeitedBy})` : ''}${note ? ' — ' + note : ''}`,
        metadata: JSON.stringify({ matchId: params.matchId, homeScore, awayScore, forfeitedBy, note }),
      }).run();
    });

    return { success: true };
  })

  // ─── Activity Log ───────────────────────────────────────────────────

  .get('/api/activity-log', ({ user, set, query }) => {
    if (!isStaff(user)) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    let rows = db.select().from(schema.activityLog)
      .orderBy(desc(schema.activityLog.timestamp))
      .all();

    const category = query.category as string | undefined;
    if (category && category !== 'all') {
      rows = rows.filter(r => r.category === category);
    }

    const leagueId = query.leagueId as string | undefined;
    if (leagueId && leagueId !== 'all') {
      rows = rows.filter(r => r.leagueId === leagueId);
    }

    const actor = query.actor as string | undefined;
    if (actor && actor !== 'all') {
      rows = rows.filter(r => r.actor === actor);
    }

    const search = (query.search as string || '').toLowerCase();
    if (search) {
      rows = rows.filter(r =>
        r.description.toLowerCase().includes(search) ||
        r.actor.toLowerCase().includes(search) ||
        r.type.toLowerCase().includes(search) ||
        (r.metadata || '').toLowerCase().includes(search)
      );
    }

    const limit = parseInt(query.limit as string) || 50;
    const offset = parseInt(query.offset as string) || 0;
    const total = rows.length;
    rows = rows.slice(offset, offset + limit);

    return {
      events: rows.map(r => ({
        id: String(r.id),
        type: r.type,
        category: r.category,
        actor: r.actor,
        leagueId: r.leagueId,
        description: r.description,
        metadata: r.metadata ? JSON.parse(r.metadata) : {},
        timestamp: r.timestamp,
      })),
      total,
    };
  })

  // ═══════════════════════════════════════════════════════════════════════
  // WRITE ENDPOINTS (dev role required)
  // ═══════════════════════════════════════════════════════════════════════

  // ─── Users CRUD ─────────────────────────────────────────────────────

  .post('/api/users', ({ body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { username, role } = body as { username: string; role?: string };
    if (!username?.trim()) { set.status = 400; return { error: 'Username required' }; }

    const existing = db.select().from(schema.users).where(eq(schema.users.username, username.trim().toLowerCase())).get();
    if (existing) { set.status = 409; return { error: 'Username already exists' }; }

    const settings = db.select().from(schema.siteSettings).get();
    const password = settings?.defaultUserPassword || 'password';
    const result = db.insert(schema.users).values({
      username: username.trim().toLowerCase(),
      passwordHash: hashPassword(password),
      role: (role === 'admin' ? 'admin' : 'user') as 'admin' | 'user',
      mustChangePassword: true,
      active: true,
    }).returning().get();

    return { user: { id: String(result.id), username: result.username, role: result.role }, password };
  })

  .put('/api/users/:id', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const userId = parseInt(params.id);
    const { role, active } = body as { role?: string; active?: boolean };

    const updates: Record<string, unknown> = {};
    if (role !== undefined) updates.role = role;
    if (active !== undefined) updates.active = active;

    if (Object.keys(updates).length === 0) { set.status = 400; return { error: 'No updates' }; }

    db.update(schema.users).set(updates).where(eq(schema.users.id, userId)).run();
    db.insert(schema.activityLog).values({
      type: 'user_updated',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Updated user #${userId}: ${Object.keys(updates).join(', ')}`,
      metadata: JSON.stringify({ userId, updates }),
    }).run();
    return { success: true };
  })

  .post('/api/users/:id/reset-password', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const userId = parseInt(params.id);
    const settings = db.select().from(schema.siteSettings).get();
    const password = settings?.defaultUserPassword || 'password';

    db.update(schema.users).set({
      passwordHash: hashPassword(password),
      mustChangePassword: true,
    }).where(eq(schema.users.id, userId)).run();

    return { password };
  })

  // ─── Site Settings ──────────────────────────────────────────────────

  .put('/api/site-settings', ({ body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const s = body as Record<string, unknown>;

    db.update(schema.siteSettings).set({
      siteName: (s.siteName as string) ?? 'Cannoli',
      announcement: s.announcementEnabled ? ((s.announcementText as string) ?? null) : null,
      announcementType: ((s.announcementType as string) ?? 'info') as 'info' | 'warning' | 'success',
      defaultPointCap: (s.defaultPointCap as number) ?? 110,
      defaultTeraCaptainSlots: (s.defaultTeraCaptainSlots as number) ?? 2,
      defaultTradeDeadlineWeek: (s.defaultTradeDeadlineWeek as number) ?? 7,
      defaultRosterSize: (s.defaultRosterSize as number) ?? 10,
      defaultMaxTeams: (s.defaultMaxTeams as number) ?? 12,
      defaultUserPassword: (s.defaultUserPassword as string) ?? 'password',
      tradeExpiryDays: (s.tradeExpiryDays as number) ?? 7,
      draftTimerEnabled: s.draftTimerEnabled !== undefined ? !!s.draftTimerEnabled : true,
      draftDemoVisible: s.draftDemoVisible !== undefined ? !!s.draftDemoVisible : true,
      faDeadlineWeek: (s.faDeadlineWeek as number) ?? 7,
      defaultPlayoffTeamCount: (s.defaultPlayoffTeamCount as number) ?? 6,
    }).where(eq(schema.siteSettings.id, 1)).run();

    return { success: true };
  })

  // ─── Tier List ──────────────────────────────────────────────────────

  .put('/api/tier-list/:name', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { tier, status, force, confirmLeague } = body as {
      tier?: number;
      status?: string;
      /** Acknowledge that this edit will affect a league past draft — required when active leagues exist */
      force?: boolean;
      /** Must match the active (regular/playoffs) league's name when force=true */
      confirmLeague?: string;
    };

    // Phase gate: refuse mid-season tier moves unless the caller explicitly
    // confirms via { force: true, confirmLeague: <league name> }. Roster cost
    // totals are snapshotted via rosters.costAtDraft, but tier-list edits still
    // affect future FA cost validation, captain eligibility, etc., so we
    // surface the risk to admins instead of silently letting it through.
    const activeLeagues = db.select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      phase: schema.leagues.phase,
    }).from(schema.leagues)
      .where(sql`${schema.leagues.phase} IN ('regular', 'playoffs')`)
      .all();

    if (activeLeagues.length > 0) {
      if (!force) {
        set.status = 409;
        return {
          error: `Cannot edit tier list while leagues are in regular/playoffs phase`,
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

    const existing = db.select().from(schema.pokemon).where(eq(schema.pokemon.name, params.name)).get();
    if (!existing) { set.status = 404; return { error: 'Pokemon not found' }; }

    const updates: Record<string, unknown> = {};
    if (tier !== undefined) updates.tier = tier;
    if (status === 'banned') { updates.banned = true; updates.teraBanned = false; }
    else if (status === 'tera-banned') { updates.teraBanned = true; updates.banned = false; }
    else if (status === 'available') { updates.banned = false; updates.teraBanned = false; }

    tx(() => {
      db.update(schema.pokemon).set(updates).where(eq(schema.pokemon.name, params.name)).run();

      // Force-edits during regular/playoffs are flagged with a distinct activity
      // type so they're easy to filter in the audit view.
      const isForced = activeLeagues.length > 0;
      db.insert(schema.activityLog).values({
        type: isForced ? 'tier_list_forced_edit' : 'tier_list_edit',
        category: 'config',
        actor: user!.username,
        leagueId: null,
        description: isForced
          ? `FORCED tier-list edit: ${params.name} (during ${activeLeagues.map(l => l.name).join(', ')}) — confirmed: "${confirmLeague}"`
          : `Tier-list edit: ${params.name}${tier !== undefined ? ` → tier ${tier}` : ''}${status ? ` [${status}]` : ''}`,
        metadata: JSON.stringify({
          pokemon: params.name,
          before: { tier: existing.tier, banned: existing.banned, teraBanned: existing.teraBanned },
          after: updates,
          forced: isForced,
          confirmLeague: confirmLeague ?? null,
          activeLeagues: activeLeagues.map(l => l.id),
        }),
      }).run();
    });

    return { success: true, forced: activeLeagues.length > 0 };
  })

  // ─── Move Categories CRUD ──────────────────────────────────────────

  .post('/api/move-categories', ({ body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
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
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
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
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
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
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
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
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
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
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
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

  // ─── Seasons CRUD ───────────────────────────────────────────────────

  .post('/api/seasons', async ({ body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const {
      seasonNumber,
      totalWeeks = 11,
      pointCap = 110,
      teraCaptainSlots = 2,
      tradeDeadlineWeek = 7,
      rosterSize = 10,
      forfeitPolicy = 'double_forfeit',
      weekDates = null,
      leagues: leaguePayloads = [],
      overlapOverride = false,
    } = body as {
      seasonNumber: number;
      totalWeeks?: number;
      pointCap?: number;
      teraCaptainSlots?: number;
      tradeDeadlineWeek?: number;
      rosterSize?: number;
      forfeitPolicy?: 'double_forfeit' | 'admin_review';
      weekDates?: Record<string, string> | null;
      leagues?: {
        id: string;
        name: string;
        color: string;
        draftDate?: string | null;
        teams?: {
          coachName?: string;
          teamName: string;
          teamAbbrev: string;
          teamColor?: string;
          managerUsername?: string | null;
        }[];
      }[];
      overlapOverride?: boolean;
    };

    if (!seasonNumber || typeof seasonNumber !== 'number') {
      set.status = 400; return { error: 'seasonNumber required' };
    }
    const dup = db.select().from(schema.seasons).where(eq(schema.seasons.seasonNumber, seasonNumber)).get();
    if (dup) { set.status = 409; return { error: `Season ${seasonNumber} already exists` }; }

    // Overlap guard: block if any league in any prior season is still in a
    // non-offseason phase, unless override flag set. (Phase now lives on the
    // league row — surface the worst-offending league's phase to the caller.)
    const active = db.select({
      seasonNumber: schema.seasons.seasonNumber,
      phase: schema.leagues.phase,
    })
      .from(schema.leagues)
      .innerJoin(schema.seasons, eq(schema.leagues.seasonId, schema.seasons.id))
      .where(sql`${schema.leagues.phase} != 'offseason'`)
      .orderBy(desc(schema.seasons.seasonNumber))
      .get();
    if (active && !overlapOverride) {
      set.status = 409;
      return {
        error: 'prior_season_active',
        priorSeasonNumber: active.seasonNumber,
        priorPhase: active.phase,
      };
    }

    // Pre-resolve manager usernames -> userIds (avoid resolving inside tx)
    const managerLookup = new Map<string, number>();
    for (const lg of leaguePayloads) {
      for (const t of lg.teams ?? []) {
        const u = (t.managerUsername ?? '').trim().toLowerCase();
        if (!u || managerLookup.has(u)) continue;
        const userRow = db.select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.username, u))
          .get();
        if (userRow) managerLookup.set(u, userRow.id);
      }
    }

    const weekDatesJson = weekDates ? JSON.stringify(weekDates) : null;

    let teamsCreated = 0;
    try {
      const seasonId = tx(() => {
        const row = db.insert(schema.seasons).values({
          seasonNumber,
          pointCap,
          teraCaptainSlots,
        }).returning().get();

        for (const lg of leaguePayloads) {
          db.insert(schema.leagues).values({
            id: lg.id,
            name: lg.name,
            color: lg.color,
            seasonId: row.id,
            draftDate: lg.draftDate ?? null,
            // Per-league lifecycle defaults — wizard inputs supply the same
            // values to every league at creation; admins tune individually
            // afterwards via PUT /api/leagues/:id.
            phase: 'predraft',
            currentWeek: 0,
            totalWeeks,
            weekDates: weekDatesJson,
            tradeDeadlineWeek,
            rosterSize,
            forfeitPolicy,
          }).run();

          for (const t of lg.teams ?? []) {
            const teamName = (t.teamName ?? '').trim();
            const teamAbbrev = (t.teamAbbrev ?? '').trim();
            if (!teamName || !teamAbbrev) {
              throw new Error(`Team in league ${lg.id} missing name/abbrev`);
            }
            const teamId = `${lg.id}-${teamAbbrev.toLowerCase()}`;
            const lookupKey = (t.managerUsername ?? '').trim().toLowerCase();
            const userId = lookupKey ? managerLookup.get(lookupKey) ?? null : null;
            const coachName = (t.coachName?.trim()) || lookupKey || teamName;
            db.insert(schema.teams).values({
              id: teamId,
              leagueId: lg.id,
              userId,
              coachName,
              teamName,
              teamAbbrev,
              teamColor: t.teamColor ?? '#888888',
              showdownUsername: null,
            }).run();
            db.insert(schema.activityLog).values({
              type: 'team_created',
              category: 'admin',
              actor: user.username,
              leagueId: lg.id,
              description: `Created team ${teamName} (${teamAbbrev})`,
              metadata: JSON.stringify({ teamId, userId, coachName, viaWizard: true }),
            }).run();
            teamsCreated++;
          }
        }

        db.insert(schema.activityLog).values({
          type: 'season_created',
          category: 'config',
          actor: user.username,
          leagueId: null,
          description: `Created Season ${seasonNumber} (${leaguePayloads.length} leagues, ${teamsCreated} teams)`,
          metadata: JSON.stringify({
            seasonNumber,
            leagues: leaguePayloads.map(l => l.id),
            pointCap,
            teraCaptainSlots,
            teamsCreated,
            overlapOverride,
          }),
        }).run();

        return row.id;
      });

      return {
        id: seasonId,
        seasonNumber,
        teamsCreated,
        unresolvedManagers: Array.from(
          new Set(
            leaguePayloads.flatMap(l =>
              (l.teams ?? [])
                .map(t => (t.managerUsername ?? '').trim().toLowerCase())
                .filter(u => u && !managerLookup.has(u)),
            ),
          ),
        ),
      };
    } catch (err: any) {
      set.status = 500;
      return {
        error: 'partial_provision_failure',
        message: err?.message ?? String(err),
        teamsCreated,
        hint: 'Transaction rolled back. Inspect server logs and retry.',
      };
    }
  })

  // ─── Team creation (per-league) ────────────────────────────────────

  .post('/api/leagues/:leagueId/teams', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { id, coachName, teamName, teamAbbrev, teamColor, userId, showdownUsername } = body as {
      id?: string;
      coachName: string;
      teamName: string;
      teamAbbrev: string;
      teamColor?: string;
      userId?: number | null;
      showdownUsername?: string | null;
    };
    if (!coachName || !teamName || !teamAbbrev) {
      set.status = 400; return { error: 'coachName, teamName, teamAbbrev required' };
    }
    const teamId = id ?? `${params.leagueId}-${teamAbbrev.toLowerCase()}`;
    const exists = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    if (exists) { set.status = 409; return { error: `Team ${teamId} already exists` }; }

    tx(() => {
      db.insert(schema.teams).values({
        id: teamId,
        leagueId: params.leagueId,
        userId: userId ?? null,
        coachName,
        teamName,
        teamAbbrev,
        teamColor: teamColor ?? '#888888',
        showdownUsername: showdownUsername ?? null,
      }).run();
      db.insert(schema.activityLog).values({
        type: 'team_created',
        category: 'admin',
        actor: user.username,
        leagueId: params.leagueId,
        description: `Created team ${teamName} (${teamAbbrev})`,
        metadata: JSON.stringify({ teamId, userId, coachName }),
      }).run();
    });

    return { id: teamId };
  })

  // ─── Team update ──────────────────────────────────────────────────

  .put('/api/teams/:teamId', ({ params, body, user, set }) => {
    if (!isStaffOrTeamOwner(user, params.teamId)) { set.status = 403; return { error: 'Forbidden' }; }
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    const staff = isStaff(user);

    const { coachName, teamName, teamAbbrev, teamColor, userId, showdownUsername, bio } = body as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
    // Owner-allowed fields:
    if (typeof teamColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(teamColor)) updates.teamColor = teamColor;
    if (bio !== undefined) {
      if (bio === null || bio === '') updates.bio = null;
      else if (typeof bio === 'string' && bio.length <= 280) updates.bio = bio;
      else { set.status = 400; return { error: 'bio must be a string ≤ 280 chars' }; }
    }
    // Staff-only fields:
    if (staff) {
      if (typeof coachName === 'string' && coachName.trim()) updates.coachName = coachName.trim();
      if (typeof teamName === 'string' && teamName.trim()) updates.teamName = teamName.trim();
      if (typeof teamAbbrev === 'string' && teamAbbrev.trim()) updates.teamAbbrev = teamAbbrev.trim();
      if (userId === null) updates.userId = null;
      else if (typeof userId === 'number') updates.userId = userId;
      if (showdownUsername === null) updates.showdownUsername = null;
      else if (typeof showdownUsername === 'string') updates.showdownUsername = showdownUsername.trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      set.status = 400; return { error: 'No valid fields to update' };
    }

    tx(() => {
      db.update(schema.teams).set(updates).where(eq(schema.teams.id, params.teamId)).run();
      db.insert(schema.activityLog).values({
        type: 'team_updated',
        category: 'admin',
        actor: user.username,
        leagueId: team.leagueId,
        description: `Updated team ${team.teamAbbrev}: ${Object.keys(updates).join(', ')}`,
        metadata: JSON.stringify({ teamId: params.teamId, updates }),
      }).run();
    });

    return { success: true };
  })

  // ─── Team delete (with safety: forbid if has roster/picks/match-results) ─

  .delete('/api/teams/:teamId', ({ params, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

    const force = query.force === '1' || query.force === 'true';

    const rosterCount = db.select({ c: sql<number>`COUNT(*)` })
      .from(schema.rosters).where(eq(schema.rosters.teamId, params.teamId)).get()?.c ?? 0;
    const matchPokemonCount = db.select({ c: sql<number>`COUNT(*)` })
      .from(schema.matchPokemon).where(eq(schema.matchPokemon.teamId, params.teamId)).get()?.c ?? 0;
    const matchCount = db.select({ c: sql<number>`COUNT(*)` })
      .from(schema.matches)
      .where(sql`(${schema.matches.homeTeamId} = ${params.teamId} OR ${schema.matches.awayTeamId} = ${params.teamId}) AND ${schema.matches.homeScore} IS NOT NULL`)
      .get()?.c ?? 0;

    if (!force && (rosterCount > 0 || matchPokemonCount > 0 || matchCount > 0)) {
      set.status = 409;
      return {
        error: `Team has ${rosterCount} roster entries, ${matchPokemonCount} match stats, ${matchCount} completed matches. Pass ?force=1 to delete anyway.`,
        code: 'TEAM_HAS_DATA',
        rosterCount,
        matchPokemonCount,
        matchCount,
      };
    }

    tx(() => {
      // Cascade clean up team-scoped rows. Don't touch matches with other live teams.
      db.delete(schema.rosters).where(eq(schema.rosters.teamId, params.teamId)).run();
      db.delete(schema.matchPokemon).where(eq(schema.matchPokemon.teamId, params.teamId)).run();
      db.delete(schema.draftPicks).where(eq(schema.draftPicks.teamId, params.teamId)).run();
      db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.teamId, params.teamId)).run();
      db.delete(schema.playerAvailability).where(eq(schema.playerAvailability.teamId, params.teamId)).run();
      db.delete(schema.tradeBlockListings).where(eq(schema.tradeBlockListings.teamId, params.teamId)).run();
      // Drop matches mentioning this team (other team's record loses those rows too — necessary for a clean delete)
      db.delete(schema.matches).where(sql`${schema.matches.homeTeamId} = ${params.teamId} OR ${schema.matches.awayTeamId} = ${params.teamId}`).run();
      db.delete(schema.transactions).where(sql`${schema.transactions.teamId} = ${params.teamId} OR ${schema.transactions.otherTeamId} = ${params.teamId}`).run();
      db.delete(schema.trades).where(sql`${schema.trades.proposerId} = ${params.teamId} OR ${schema.trades.recipientId} = ${params.teamId}`).run();
      db.delete(schema.teams).where(eq(schema.teams.id, params.teamId)).run();

      db.insert(schema.activityLog).values({
        type: 'team_deleted',
        category: 'admin',
        actor: user.username,
        leagueId: team.leagueId,
        description: `Deleted team ${team.teamName} (${team.teamAbbrev})${force ? ' [forced]' : ''}`,
        metadata: JSON.stringify({ teamId: params.teamId, force, rosterCount, matchPokemonCount, matchCount }),
      }).run();
    });

    return { success: true };
  })

  // ─── Team logo upload ──────────────────────────────────────────────

  .post('/api/teams/:teamId/logo', async ({ params, request, user, set }) => {
    if (!isStaffOrTeamOwner(user, params.teamId)) { set.status = 403; return { error: 'Forbidden' }; }
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

    const form = await request.formData().catch(() => null);
    const file = form?.get('logo');
    if (!(file instanceof File)) { set.status = 400; return { error: 'No file uploaded under "logo" field' }; }
    if (!file.type.startsWith('image/')) { set.status = 400; return { error: 'File must be an image' }; }
    if (file.size > 512 * 1024) { set.status = 400; return { error: 'File must be ≤ 512KB' }; }

    const ext = (file.type.split('/')[1] || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) ? ext : 'png';
    const filename = `${params.teamId}.${safeExt}`;
    const relativePath = `team-logos/${filename}`;
    const absPath = `${process.cwd()}/uploads/${relativePath}`;

    await Bun.write(absPath, file);

    db.update(schema.teams).set({ logoPath: relativePath }).where(eq(schema.teams.id, params.teamId)).run();
    db.insert(schema.activityLog).values({
      type: 'team_logo_uploaded',
      category: 'team',
      actor: user!.username,
      leagueId: team.leagueId,
      description: `Uploaded logo for ${team.teamName}`,
      metadata: JSON.stringify({ teamId: params.teamId, path: relativePath, size: file.size }),
    }).run();

    return { success: true, path: `/uploads/${relativePath}` };
  })

  // ─── Team banner upload ────────────────────────────────────────────

  .post('/api/teams/:teamId/banner', async ({ params, request, user, set }) => {
    if (!isStaffOrTeamOwner(user, params.teamId)) { set.status = 403; return { error: 'Forbidden' }; }
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

    const form = await request.formData().catch(() => null);
    const file = form?.get('banner');
    if (!(file instanceof File)) { set.status = 400; return { error: 'No file uploaded under "banner" field' }; }
    if (!file.type.startsWith('image/')) { set.status = 400; return { error: 'File must be an image' }; }
    if (file.size > 1024 * 1024) { set.status = 400; return { error: 'File must be ≤ 1MB' }; }

    const ext = (file.type.split('/')[1] || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png';
    const filename = `${params.teamId}.${safeExt}`;
    const relativePath = `team-banners/${filename}`;
    const absPath = `${process.cwd()}/uploads/${relativePath}`;

    await Bun.write(absPath, file);

    db.update(schema.teams).set({ bannerPath: relativePath }).where(eq(schema.teams.id, params.teamId)).run();
    db.insert(schema.activityLog).values({
      type: 'team_banner_uploaded',
      category: 'team',
      actor: user!.username,
      leagueId: team.leagueId,
      description: `Uploaded banner for ${team.teamName}`,
      metadata: JSON.stringify({ teamId: params.teamId, path: relativePath, size: file.size }),
    }).run();

    return { success: true, path: `/uploads/${relativePath}` };
  })

  // ─── Static upload serving ─────────────────────────────────────────

  .get('/uploads/:dir/:file', async ({ params, set }) => {
    // Whitelist directories — only the ones we write to
    const ALLOWED_DIRS = ['team-logos', 'team-banners', 'user-avatars'];
    if (!ALLOWED_DIRS.includes(params.dir)) { set.status = 404; return 'Not found'; }
    if (!/^[a-zA-Z0-9_.-]+$/.test(params.file)) { set.status = 400; return 'Invalid filename'; }
    const path = `${process.cwd()}/uploads/${params.dir}/${params.file}`;
    const f = Bun.file(path);
    if (!(await f.exists())) { set.status = 404; return 'Not found'; }
    return new Response(f);
  })

  // ─── Leagues CRUD ───────────────────────────────────────────────────

  .post('/api/leagues', ({ body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { name, color } = body as { name: string; color: string };
    if (!name?.trim()) { set.status = 400; return { error: 'Name required' }; }

    const id = name.trim().toLowerCase().replace(/\s+league$/i, '').replace(/\s+/g, '-');
    const season = db.select().from(schema.seasons).orderBy(desc(schema.seasons.seasonNumber)).get();
    if (!season) { set.status = 400; return { error: 'No active season' }; }

    db.insert(schema.leagues).values({ id, name: name.trim(), color: color || '#888888', seasonId: season.id }).run();
    return { id };
  })

  .put('/api/leagues/:leagueId', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { name, color, draftDate, pointCap, teraCaptainSlots, tradeDeadlineWeek, weekDates, maxTeams: _maxTeams, rosterSize, paused, forfeitPolicy } = body as Record<string, unknown>;

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const leagueUpdates: Record<string, unknown> = {};
    if (name) leagueUpdates.name = name;
    if (color) leagueUpdates.color = color;
    if (draftDate !== undefined) leagueUpdates.draftDate = draftDate;
    if (tradeDeadlineWeek !== undefined) leagueUpdates.tradeDeadlineWeek = tradeDeadlineWeek;
    if (weekDates !== undefined) leagueUpdates.weekDates = typeof weekDates === 'string' ? weekDates : JSON.stringify(weekDates);
    if (paused !== undefined) leagueUpdates.paused = !!paused;
    if (forfeitPolicy !== undefined) leagueUpdates.forfeitPolicy = forfeitPolicy;

    // Phase-aware locks (phase now lives on the league row)
    const draftStarted = !!db.select().from(schema.draftState)
      .where(and(eq(schema.draftState.leagueId, params.leagueId), sql`current_pick_index > 0`)).get();
    if (pointCap !== undefined && draftStarted) {
      set.status = 400; return { error: 'Cannot change point cap once draft has begun' };
    }
    if (teraCaptainSlots !== undefined && league.phase !== 'predraft' && league.phase !== 'draft') {
      set.status = 400; return { error: `Cannot change tera captain slots in ${league.phase} phase` };
    }
    // rosterSize must be locked once any picks have been made — would invalidate
    // the snake order. Editable until draft starts.
    if (rosterSize !== undefined) {
      if (draftStarted || (league.phase !== 'predraft' && league.phase !== 'draft')) {
        set.status = 400;
        return { error: `Cannot change roster size once draft has started (phase: ${league.phase})` };
      }
      const n = Number(rosterSize);
      if (!Number.isInteger(n) || n < 2 || n > 20) {
        set.status = 400;
        return { error: 'rosterSize must be an integer between 2 and 20' };
      }
      leagueUpdates.rosterSize = n;
    }

    // pointCap and teraCaptainSlots remain season-wide settings.
    const seasonUpdates: Record<string, unknown> = {};
    if (pointCap !== undefined) seasonUpdates.pointCap = pointCap;
    if (teraCaptainSlots !== undefined) seasonUpdates.teraCaptainSlots = teraCaptainSlots;

    tx(() => {
      if (Object.keys(leagueUpdates).length > 0) {
        db.update(schema.leagues).set(leagueUpdates).where(eq(schema.leagues.id, params.leagueId)).run();
      }
      if (Object.keys(seasonUpdates).length > 0) {
        db.update(schema.seasons).set(seasonUpdates).where(eq(schema.seasons.id, league.seasonId)).run();
      }
      if (Object.keys(leagueUpdates).length > 0 || Object.keys(seasonUpdates).length > 0) {
        db.insert(schema.activityLog).values({
          type: 'league_config_updated',
          category: 'config',
          actor: user.username,
          leagueId: params.leagueId,
          description: `Updated config for ${league.name}`,
          metadata: JSON.stringify({ leagueUpdates, seasonUpdates }),
        }).run();
      }
    });

    return { success: true };
  })

  .delete('/api/leagues/:leagueId', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    tx(() => {
      const teamIds = db.select({ id: schema.teams.id }).from(schema.teams)
        .where(eq(schema.teams.leagueId, params.leagueId)).all().map(t => t.id);

      for (const tid of teamIds) {
        db.delete(schema.rosters).where(eq(schema.rosters.teamId, tid)).run();
        db.delete(schema.matchPokemon).where(eq(schema.matchPokemon.teamId, tid)).run();
        db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.teamId, tid)).run();
        db.delete(schema.playerAvailability).where(eq(schema.playerAvailability.teamId, tid)).run();
      }
      db.delete(schema.draftState).where(eq(schema.draftState.leagueId, params.leagueId)).run();
      db.delete(schema.draftPicks).where(eq(schema.draftPicks.leagueId, params.leagueId)).run();
      db.delete(schema.matches).where(eq(schema.matches.leagueId, params.leagueId)).run();
      db.delete(schema.transactions).where(eq(schema.transactions.leagueId, params.leagueId)).run();
      db.delete(schema.trades).where(eq(schema.trades.leagueId, params.leagueId)).run();
      db.delete(schema.tradeBlockListings).where(eq(schema.tradeBlockListings.leagueId, params.leagueId)).run();
      db.delete(schema.teams).where(eq(schema.teams.leagueId, params.leagueId)).run();
      db.delete(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).run();

      db.insert(schema.activityLog).values({
        type: 'league_deleted',
        category: 'admin',
        actor: user.username,
        leagueId: null,
        description: `Deleted league ${league.name}`,
        metadata: JSON.stringify({ leagueId: params.leagueId }),
      }).run();
    });

    return { success: true };
  })

  // ─── Season Management ──────────────────────────────────────────────

  .post('/api/leagues/:leagueId/phase', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { phase, override } = body as { phase: string; override?: boolean };
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    // Phase now lives on the league — advancing one league no longer drags
    // the others in the same season along with it.
    const previousPhase = league.phase;

    // ─── Phase transition preconditions ────────────────────────────────
    const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, params.leagueId)).all();
    const draftState = db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, params.leagueId)).get();

    if (phase === 'draft') {
      const order: string[] = league.draftOrder ? JSON.parse(league.draftOrder) : [];
      if (order.length === 0) { set.status = 400; return { error: 'Cannot start draft: draft order not set' }; }
      if (order.length !== teams.length) {
        set.status = 400; return { error: `Draft order has ${order.length} teams but league has ${teams.length}` };
      }
      const teamIdSet = new Set(teams.map(t => t.id));
      const seen = new Set<string>();
      for (const tid of order) {
        if (!teamIdSet.has(tid)) { set.status = 400; return { error: `Draft order contains unknown team ${tid}` }; }
        if (seen.has(tid)) { set.status = 400; return { error: `Draft order has duplicate team ${tid}` }; }
        seen.add(tid);
      }
      if (draftState && draftState.status === 'in_progress') {
        set.status = 400; return { error: 'Draft already in progress' };
      }
    }

    if (phase === 'regular' && previousPhase === 'draft') {
      if (!draftState || draftState.status !== 'completed') {
        if (!override) {
          set.status = 400; return { error: 'Draft is not complete', code: 'DRAFT_NOT_COMPLETE' };
        }
      }
    }

    if (phase === 'playoffs') {
      const incomplete = db.select({ count: sql<number>`COUNT(*)` })
        .from(schema.matches)
        .where(and(
          eq(schema.matches.leagueId, params.leagueId),
          eq(schema.matches.phase, 'regular'),
          sql`(home_score IS NULL OR away_score IS NULL)`,
        )).get()?.count ?? 0;
      if (incomplete > 0 && !override) {
        set.status = 400;
        return { error: `${incomplete} regular-season matches still missing scores`, code: 'REGULAR_INCOMPLETE' };
      }
    }

    let scheduleGenerated = false;
    tx(() => {
      const leagueUpdates: Record<string, unknown> = { phase: phase as any };
      if (phase === 'regular' && previousPhase !== 'regular') {
        leagueUpdates.currentWeek = 1;
      }
      db.update(schema.leagues).set(leagueUpdates).where(eq(schema.leagues.id, params.leagueId)).run();

      // Auto-generate schedule when advancing from draft → regular
      if (previousPhase === 'draft' && phase === 'regular') {
        const result = generateLeagueSchedule(params.leagueId);
        scheduleGenerated = result.success;
      }

      db.insert(schema.activityLog).values({
        type: 'phase_advanced',
        category: 'config',
        actor: user.username,
        leagueId: params.leagueId,
        description: `Phase: ${previousPhase} → ${phase}${override ? ' (override)' : ''}`,
        metadata: JSON.stringify({ from: previousPhase, to: phase, override: !!override, scheduleGenerated }),
      }).run();
    });

    return { success: true, scheduleGenerated };
  })

  .post('/api/leagues/:leagueId/week', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const newWeek = league.currentWeek + 1;
    tx(() => {
      db.update(schema.leagues).set({ currentWeek: newWeek }).where(eq(schema.leagues.id, params.leagueId)).run();
      db.insert(schema.activityLog).values({
        type: 'week_advanced',
        category: 'config',
        actor: user.username,
        leagueId: params.leagueId,
        description: `Week ${league.currentWeek} → ${newWeek}`,
        metadata: JSON.stringify({ from: league.currentWeek, to: newWeek }),
      }).run();
    });
    return { success: true, week: newWeek };
  })

  .post('/api/leagues/:leagueId/draft-order', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { order } = body as { order: string[] };

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }
    // Lock once we're past draft phase
    if (league.phase !== 'predraft' && league.phase !== 'draft') {
      set.status = 400; return { error: `Cannot change draft order in ${league.phase} phase` };
    }
    // Lock once the draft has begun (any picks made)
    const draftState = db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, params.leagueId)).get();
    if (draftState && draftState.currentPickIndex > 0) {
      set.status = 400; return { error: 'Cannot change draft order once picks have been made' };
    }

    tx(() => {
      db.update(schema.leagues).set({ draftOrder: JSON.stringify(order) }).where(eq(schema.leagues.id, params.leagueId)).run();
      db.insert(schema.activityLog).values({
        type: 'draft_order_set',
        category: 'config',
        actor: user.username,
        leagueId: params.leagueId,
        description: `Set draft order (${order.length} teams)`,
        metadata: JSON.stringify({ order }),
      }).run();
    });
    return { success: true };
  })

;
