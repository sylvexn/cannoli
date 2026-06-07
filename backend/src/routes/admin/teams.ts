import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, and, sql } from 'drizzle-orm';
import { isStaff, isStaffOrTeamOwner } from '../../lib/auth';
import { tx } from '../../lib/tx';

export const teamAdminRoutes = new Elysia()

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

    const { coachName, teamName, teamAbbrev, teamColor, userId, showdownUsername, bio, motto, captainNote } = body as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
    // Owner-allowed fields:
    if (typeof teamColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(teamColor)) updates.teamColor = teamColor;
    if (bio !== undefined) {
      if (bio === null || bio === '') updates.bio = null;
      else if (typeof bio === 'string' && bio.length <= 280) updates.bio = bio;
      else { set.status = 400; return { error: 'bio must be a string ≤ 280 chars' }; }
    }
    // Personality fields — short owner-authored strings rendered on the team
    // detail page. Caps mirror users.statusMessage / users.bio so the UI can
    // share the same character-counter component.
    if (motto !== undefined) {
      if (motto === null || motto === '') updates.motto = null;
      else if (typeof motto === 'string' && motto.length <= 80) updates.motto = motto.trim();
      else { set.status = 400; return { error: 'motto must be a string ≤ 80 chars' }; }
    }
    if (captainNote !== undefined) {
      if (captainNote === null || captainNote === '') updates.captainNote = null;
      else if (typeof captainNote === 'string' && captainNote.length <= 280) updates.captainNote = captainNote;
      else { set.status = 400; return { error: 'captainNote must be a string ≤ 280 chars' }; }
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

  // ─── Roster nickname (owner or admin) ──────────────────────────────

  .put('/api/teams/:teamId/rosters/:rosterId/nickname', ({ params, body, user, set }) => {
    if (!isStaffOrTeamOwner(user, params.teamId)) { set.status = 403; return { error: 'Forbidden' }; }
    const rosterId = parseInt(params.rosterId);
    if (!Number.isFinite(rosterId)) { set.status = 400; return { error: 'Invalid rosterId' }; }

    const roster = db.select().from(schema.rosters)
      .where(and(eq(schema.rosters.id, rosterId), eq(schema.rosters.teamId, params.teamId)))
      .get();
    if (!roster) { set.status = 404; return { error: 'Roster entry not found for this team' }; }

    const { nickname } = body as { nickname?: string | null };
    let normalized: string | null;
    if (nickname == null) {
      normalized = null;
    } else if (typeof nickname === 'string') {
      const trimmed = nickname.trim();
      if (trimmed.length === 0) {
        normalized = null;
      } else if (trimmed.length > 40) {
        set.status = 400;
        return { error: 'nickname must be ≤ 40 characters' };
      } else {
        normalized = trimmed;
      }
    } else {
      set.status = 400;
      return { error: 'nickname must be a string or null' };
    }

    db.update(schema.rosters)
      .set({ nickname: normalized })
      .where(eq(schema.rosters.id, rosterId))
      .run();

    return { success: true, nickname: normalized };
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
    const ALLOWED_DIRS = ['team-logos', 'team-banners', 'user-avatars', 'user-banners'];
    if (!ALLOWED_DIRS.includes(params.dir)) { set.status = 404; return 'Not found'; }
    if (!/^[a-zA-Z0-9_.-]+$/.test(params.file)) { set.status = 400; return 'Invalid filename'; }
    const path = `${process.cwd()}/uploads/${params.dir}/${params.file}`;
    const f = Bun.file(path);
    if (!(await f.exists())) { set.status = 404; return 'Not found'; }
    return new Response(f);
  })

;
