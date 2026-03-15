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

    tx(() => {
      db.update(schema.matches).set({
        status: 'completed',
        homeScore: homeScore ?? 0,
        awayScore: awayScore ?? 0,
        forfeitedBy: forfeitedBy ?? null,
        completedAt: new Date().toISOString(),
        warnings: null,
      }).where(eq(schema.matches.id, params.matchId)).run();

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

  // ─── Seasons CRUD ───────────────────────────────────────────────────

  .post('/api/seasons', async ({ body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const {
      seasonNumber,
      totalWeeks = 11,
      pointCap = 110,
      teraCaptainSlots = 2,
      tradeDeadlineWeek = 7,
      forfeitPolicy = 'double_forfeit',
      weekDates = null,
      leagues: leaguePayloads = [],
    } = body as {
      seasonNumber: number;
      totalWeeks?: number;
      pointCap?: number;
      teraCaptainSlots?: number;
      tradeDeadlineWeek?: number;
      forfeitPolicy?: 'double_forfeit' | 'admin_review';
      weekDates?: Record<string, string> | null;
      leagues?: { id: string; name: string; color: string; draftDate?: string | null }[];
    };

    if (!seasonNumber || typeof seasonNumber !== 'number') {
      set.status = 400; return { error: 'seasonNumber required' };
    }
    const dup = db.select().from(schema.seasons).where(eq(schema.seasons.seasonNumber, seasonNumber)).get();
    if (dup) { set.status = 409; return { error: `Season ${seasonNumber} already exists` }; }

    const seasonId = tx(() => {
      const row = db.insert(schema.seasons).values({
        seasonNumber,
        phase: 'predraft',
        currentWeek: 0,
        totalWeeks,
        pointCap,
        teraCaptainSlots,
        tradeDeadlineWeek,
        forfeitPolicy,
        weekDates: weekDates ? JSON.stringify(weekDates) : null,
      }).returning().get();

      for (const lg of leaguePayloads) {
        db.insert(schema.leagues).values({
          id: lg.id,
          name: lg.name,
          color: lg.color,
          seasonId: row.id,
          draftDate: lg.draftDate ?? null,
        }).run();
      }

      db.insert(schema.activityLog).values({
        type: 'season_created',
        category: 'config',
        actor: user.username,
        leagueId: null,
        description: `Created Season ${seasonNumber} (${leaguePayloads.length} leagues)`,
        metadata: JSON.stringify({ seasonNumber, leagues: leaguePayloads.map(l => l.id), pointCap, teraCaptainSlots }),
      }).run();

      return row.id;
    });

    return { id: seasonId, seasonNumber };
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
    const { name, color, draftDate, pointCap, teraCaptainSlots, tradeDeadlineWeek, weekDates, maxTeams: _maxTeams, rosterSize: _rosterSize, paused, forfeitPolicy } = body as Record<string, unknown>;

    const leagueUpdates: Record<string, unknown> = {};
    if (name) leagueUpdates.name = name;
    if (color) leagueUpdates.color = color;
    if (draftDate !== undefined) leagueUpdates.draftDate = draftDate;

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }
    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get();

    // Phase-aware locks
    const draftStarted = !!db.select().from(schema.draftState)
      .where(and(eq(schema.draftState.leagueId, params.leagueId), sql`current_pick_index > 0`)).get();
    if (pointCap !== undefined && draftStarted) {
      set.status = 400; return { error: 'Cannot change point cap once draft has begun' };
    }
    if (teraCaptainSlots !== undefined && season && season.phase !== 'predraft' && season.phase !== 'draft') {
      set.status = 400; return { error: `Cannot change tera captain slots in ${season.phase} phase` };
    }

    const seasonUpdates: Record<string, unknown> = {};
    if (pointCap !== undefined) seasonUpdates.pointCap = pointCap;
    if (teraCaptainSlots !== undefined) seasonUpdates.teraCaptainSlots = teraCaptainSlots;
    if (tradeDeadlineWeek !== undefined) seasonUpdates.tradeDeadlineWeek = tradeDeadlineWeek;
    if (weekDates !== undefined) seasonUpdates.weekDates = typeof weekDates === 'string' ? weekDates : JSON.stringify(weekDates);
    if (paused !== undefined) seasonUpdates.paused = !!paused;
    if (forfeitPolicy !== undefined) seasonUpdates.forfeitPolicy = forfeitPolicy;

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

    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get();
    if (!season) { set.status = 404; return { error: 'Season not found' }; }
    const previousPhase = season.phase;

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
      const seasonUpdates: Record<string, unknown> = { phase: phase as any };
      if (phase === 'regular' && previousPhase !== 'regular') {
        seasonUpdates.currentWeek = 1;
      }
      db.update(schema.seasons).set(seasonUpdates).where(eq(schema.seasons.id, league.seasonId)).run();

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

    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get();
    if (!season) { set.status = 404; return { error: 'Season not found' }; }

    const newWeek = season.currentWeek + 1;
    tx(() => {
      db.update(schema.seasons).set({ currentWeek: newWeek }).where(eq(schema.seasons.id, season.id)).run();
      db.insert(schema.activityLog).values({
        type: 'week_advanced',
        category: 'config',
        actor: user.username,
        leagueId: params.leagueId,
        description: `Week ${season.currentWeek} → ${newWeek}`,
        metadata: JSON.stringify({ from: season.currentWeek, to: newWeek }),
      }).run();
    });
    return { success: true, week: newWeek };
  })

  .post('/api/leagues/:leagueId/draft-order', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { order } = body as { order: string[] };

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    if (!league) { set.status = 404; return { error: 'League not found' }; }
    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get();
    // Lock once we're past draft phase
    if (season && season.phase !== 'predraft' && season.phase !== 'draft') {
      set.status = 400; return { error: `Cannot change draft order in ${season.phase} phase` };
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
