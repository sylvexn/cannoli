import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, sql, asc, desc } from 'drizzle-orm';
import { hashPassword, isStaff } from '../lib/auth';
import { generateLeagueSchedule } from '../lib/schedule-generator';

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
    }).from(schema.users)
      .orderBy(asc(schema.users.id))
      .all()
      .map(u => ({ ...u, id: String(u.id) }));
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
      draftTimerEnabled: s.draftTimerEnabled !== undefined ? !!s.draftTimerEnabled : true,
      draftDemoVisible: s.draftDemoVisible !== undefined ? !!s.draftDemoVisible : true,
    }).where(eq(schema.siteSettings.id, 1)).run();

    return { success: true };
  })

  // ─── Tier List ──────────────────────────────────────────────────────

  .put('/api/tier-list/:name', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { tier, status } = body as { tier?: number; status?: string };

    const updates: Record<string, unknown> = {};
    if (tier !== undefined) updates.tier = tier;
    if (status === 'banned') { updates.banned = true; updates.teraBanned = false; }
    else if (status === 'tera-banned') { updates.teraBanned = true; updates.banned = false; }
    else if (status === 'available') { updates.banned = false; updates.teraBanned = false; }

    db.update(schema.pokemon).set(updates).where(eq(schema.pokemon.name, params.name)).run();
    return { success: true };
  })

  // ─── Move Categories CRUD ──────────────────────────────────────────

  .post('/api/move-categories', ({ body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { name } = body as { name: string };
    if (!name?.trim()) { set.status = 400; return { error: 'Name required' }; }

    const id = name.trim().toLowerCase().replace(/\s+/g, '-');
    const maxSort = db.select({ max: sql<number>`MAX(sort_order)` }).from(schema.moveCategories).get()?.max || 0;

    db.insert(schema.moveCategories).values({ id, name: name.trim(), sortOrder: maxSort + 1 }).run();
    return { id, name: name.trim() };
  })

  .put('/api/move-categories/:id', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { name } = body as { name: string };
    db.update(schema.moveCategories).set({ name }).where(eq(schema.moveCategories.id, params.id)).run();
    return { success: true };
  })

  .delete('/api/move-categories/:id', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    db.delete(schema.moveCategoryEntries).where(eq(schema.moveCategoryEntries.categoryId, params.id)).run();
    db.delete(schema.moveCategories).where(eq(schema.moveCategories.id, params.id)).run();
    return { success: true };
  })

  .post('/api/move-categories/:id/entries', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { name, isAbility } = body as { name: string; isAbility?: boolean };
    if (!name?.trim()) { set.status = 400; return { error: 'Name required' }; }

    const moveId = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    db.insert(schema.moveCategoryEntries).values({
      categoryId: params.id,
      name: name.trim(),
      moveId,
      isAbility: isAbility || false,
    }).run();
    return { success: true };
  })

  .delete('/api/move-category-entries/:id', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    db.delete(schema.moveCategoryEntries).where(eq(schema.moveCategoryEntries.id, parseInt(params.id))).run();
    return { success: true };
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
    const { name, color, draftDate, pointCap, teraCaptainSlots, tradeDeadlineWeek, weekDates, maxTeams, rosterSize } = body as Record<string, unknown>;

    const leagueUpdates: Record<string, unknown> = {};
    if (name) leagueUpdates.name = name;
    if (color) leagueUpdates.color = color;
    if (draftDate !== undefined) leagueUpdates.draftDate = draftDate;
    if (Object.keys(leagueUpdates).length > 0) {
      db.update(schema.leagues).set(leagueUpdates).where(eq(schema.leagues.id, params.leagueId)).run();
    }

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (league) {
      const seasonUpdates: Record<string, unknown> = {};
      if (pointCap !== undefined) seasonUpdates.pointCap = pointCap;
      if (teraCaptainSlots !== undefined) seasonUpdates.teraCaptainSlots = teraCaptainSlots;
      if (tradeDeadlineWeek !== undefined) seasonUpdates.tradeDeadlineWeek = tradeDeadlineWeek;
      if (weekDates !== undefined) seasonUpdates.weekDates = typeof weekDates === 'string' ? weekDates : JSON.stringify(weekDates);
      if (Object.keys(seasonUpdates).length > 0) {
        db.update(schema.seasons).set(seasonUpdates).where(eq(schema.seasons.id, league.seasonId)).run();
      }
    }

    return { success: true };
  })

  .delete('/api/leagues/:leagueId', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const teamIds = db.select({ id: schema.teams.id }).from(schema.teams)
      .where(eq(schema.teams.leagueId, params.leagueId)).all().map(t => t.id);

    for (const tid of teamIds) {
      db.delete(schema.rosters).where(eq(schema.rosters.teamId, tid)).run();
      db.delete(schema.matchPokemon).where(eq(schema.matchPokemon.teamId, tid)).run();
    }
    db.delete(schema.draftPicks).where(eq(schema.draftPicks.leagueId, params.leagueId)).run();
    db.delete(schema.matches).where(eq(schema.matches.leagueId, params.leagueId)).run();
    db.delete(schema.transactions).where(eq(schema.transactions.leagueId, params.leagueId)).run();
    db.delete(schema.trades).where(eq(schema.trades.leagueId, params.leagueId)).run();
    db.delete(schema.tradeBlockListings).where(eq(schema.tradeBlockListings.leagueId, params.leagueId)).run();
    db.delete(schema.teams).where(eq(schema.teams.leagueId, params.leagueId)).run();
    db.delete(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).run();
    return { success: true };
  })

  // ─── Season Management ──────────────────────────────────────────────

  .post('/api/leagues/:leagueId/phase', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { phase } = body as { phase: string };
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get();
    const previousPhase = season?.phase;

    db.update(schema.seasons).set({ phase: phase as any }).where(eq(schema.seasons.id, league.seasonId)).run();

    // Auto-generate schedule when advancing from draft → regular
    let scheduleGenerated = false;
    if (previousPhase === 'draft' && phase === 'regular') {
      const result = generateLeagueSchedule(params.leagueId);
      scheduleGenerated = result.success;
      // Also set week to 1
      if (season) {
        db.update(schema.seasons).set({ currentWeek: 1 }).where(eq(schema.seasons.id, season.id)).run();
      }
    }

    return { success: true, scheduleGenerated };
  })

  .post('/api/leagues/:leagueId/week', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }

    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get();
    if (!season) { set.status = 404; return { error: 'Season not found' }; }

    db.update(schema.seasons).set({ currentWeek: season.currentWeek + 1 }).where(eq(schema.seasons.id, season.id)).run();
    return { success: true, week: season.currentWeek + 1 };
  })

  .post('/api/leagues/:leagueId/draft-order', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { order } = body as { order: string[] };
    db.update(schema.leagues).set({ draftOrder: JSON.stringify(order) }).where(eq(schema.leagues.id, params.leagueId)).run();
    return { success: true };
  })

;
