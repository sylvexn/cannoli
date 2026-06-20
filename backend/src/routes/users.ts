/**
 * User profile + preferences + cross-league stats.
 *
 * Endpoints:
 *   PATCH /api/users/me                  — update displayName/bio
 *   POST  /api/users/me/avatar           — multipart avatar upload (image/*, ≤512KB)
 *   GET   /api/users/me/preferences      — read prefs (lazy default)
 *   PUT   /api/users/me/preferences      — upsert prefs
 *   GET   /api/users/me/lifetime-stats   — aggregate W/L, K/D, championships across leagues
 *   GET   /api/users/:username           — public profile + career summary
 */

import { Elysia } from 'elysia';
import { unlinkSync } from 'fs';
import { db, schema } from '../db';
import { eq, and, sql, ne } from 'drizzle-orm';
import { isStaff } from '../lib/auth';
import { writeUpload, uploadsPath } from '../lib/uploads';
import { isR2Configured, r2Delete } from '../lib/r2';
import { toUserid } from '../lib/ps-login';

/** Best-effort cleanup of a previously stored asset.
 *  - If the key looks like an R2 public URL (starts with http) and R2 is configured,
 *    derives the object key from the URL and calls r2Delete.
 *  - Otherwise treats it as a local relative path and unlinks it from disk.
 *  Never throws — errors are logged and swallowed so callers never fail. */
async function deleteOldAsset(oldPath: string, newPath: string): Promise<void> {
  if (!oldPath || oldPath === newPath) return;
  try {
    if (oldPath.startsWith('http')) {
      // R2 public URL — extract the object key (everything after the base URL).
      if (isR2Configured()) {
        const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/+$/, '') ?? '';
        const key = publicBase && oldPath.startsWith(publicBase)
          ? oldPath.slice(publicBase.length).replace(/^\/+/, '')
          : oldPath.split('/').slice(3).join('/'); // fallback: strip protocol+host
        await r2Delete(key);
      }
    } else {
      // Local relative path (e.g. "user-avatars/1.png")
      const abs = uploadsPath(oldPath.replace(/^\/uploads\//, ''));
      unlinkSync(abs);
    }
  } catch (e: any) {
    console.warn('[uploads] deleteOldAsset failed (non-fatal):', e?.message ?? e);
  }
}

const MAX_DISPLAY_NAME = 32;
const MAX_BIO = 280;
const MAX_STATUS = 80;
const MAX_BANNER_URL = 255;
const MAX_AVATAR_BYTES = 512 * 1024;
/** PS userid (post-normalization) length limit. */
const MAX_PS_USERID = 18;

/** Parse the stored spoiler_revealed_through JSON into a { leagueId: week } map,
 *  tolerating null/garbage (always returns a plain numeric map). */
function parseRevealedThrough(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Parse the stored spoiler_revealed_matches JSON array into a string[] of
 *  match IDs, tolerating null/garbage (always returns a deduped array). */
function parseRevealedMatches(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return Array.from(new Set(arr.filter((m): m is string => typeof m === 'string' && m.length > 0)));
  } catch {
    return [];
  }
}

// IANA zone validator. Modern Bun ships Intl.supportedValuesOf, but if a
// future runtime drops it we fall back to a try/catch DateTimeFormat probe
// (which throws RangeError on unknown zones).
function isValidIanaZone(tz: string): boolean {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof supported === 'function') {
      return supported('timeZone').includes(tz);
    }
  } catch { /* fall through */ }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const userRoutes = new Elysia()

  // ─── PATCH /api/users/me ──────────────────────────────────────────────
  // Self-only edit endpoint. Accepts any subset of:
  //   displayName        — overrides username in UI (≤ 32)
  //   bio                — markdown-light, ≤ 280
  //   statusMessage      — one-liner, ≤ 80
  //   bannerUrl          — relative or absolute URL, ≤ 255 (null clears)
  // Banner uploads should go through POST /api/users/me/banner (multipart);
  // this PATCH is for clearing the banner or pasting an external image URL.
  .patch('/api/users/me', ({ body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const {
      displayName, bio, statusMessage, bannerUrl, psUsername,
    } = (body ?? {}) as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
    if (displayName !== undefined) {
      if (displayName === null || displayName === '') {
        updates.displayName = null;
      } else if (typeof displayName !== 'string' || displayName.length > MAX_DISPLAY_NAME) {
        set.status = 400;
        return { error: `displayName must be a string ≤ ${MAX_DISPLAY_NAME} chars` };
      } else {
        updates.displayName = displayName.trim();
      }
    }
    if (bio !== undefined) {
      if (bio === null || bio === '') {
        updates.bio = null;
      } else if (typeof bio !== 'string' || bio.length > MAX_BIO) {
        set.status = 400;
        return { error: `bio must be a string ≤ ${MAX_BIO} chars` };
      } else {
        updates.bio = bio;
      }
    }
    if (statusMessage !== undefined) {
      if (statusMessage === null || statusMessage === '') {
        updates.statusMessage = null;
      } else if (typeof statusMessage !== 'string' || statusMessage.length > MAX_STATUS) {
        set.status = 400;
        return { error: `statusMessage must be a string ≤ ${MAX_STATUS} chars` };
      } else {
        updates.statusMessage = statusMessage.trim();
      }
    }
    if (bannerUrl !== undefined) {
      if (bannerUrl === null || bannerUrl === '') {
        updates.bannerUrl = null;
      } else if (typeof bannerUrl !== 'string' || bannerUrl.length > MAX_BANNER_URL) {
        set.status = 400;
        return { error: `bannerUrl must be a string ≤ ${MAX_BANNER_URL} chars` };
      } else {
        updates.bannerUrl = bannerUrl.trim();
      }
    }
    if (psUsername !== undefined) {
      if (psUsername === null || psUsername === '') {
        // Clear — fall back to username-derived userid
        updates.psUsername = null;
      } else if (typeof psUsername !== 'string') {
        set.status = 400;
        return { error: 'psUsername must be a string' };
      } else {
        const normalized = toUserid(psUsername.trim());
        if (normalized.length === 0) {
          set.status = 400;
          return { error: 'psUsername must contain at least one alphanumeric character' };
        }
        if (normalized.length > MAX_PS_USERID) {
          set.status = 400;
          return { error: `psUsername normalizes to "${normalized}" which is ${normalized.length} chars — PS limit is ${MAX_PS_USERID}` };
        }
        // Uniqueness check: no other user may have the same effective PS userid.
        // We compare normalized psUsername against other users' psUsername (if set)
        // and against their username (the fallback identity) so there are no collisions.
        const myId = parseInt(user.id);
        const conflictByPsUsername = db.select({ id: schema.users.id })
          .from(schema.users)
          .where(and(ne(schema.users.id, myId), eq(schema.users.psUsername, psUsername.trim())))
          .get();
        if (conflictByPsUsername) {
          set.status = 409;
          return { error: `That Showdown username is already taken` };
        }
        // Also check whether the normalized form collides with any user's
        // effective PS userid (normalized psUsername if set, else username).
        const allOthers = db.select({ id: schema.users.id, username: schema.users.username, psUsername: schema.users.psUsername })
          .from(schema.users)
          .where(ne(schema.users.id, myId))
          .all();
        const collision = allOthers.find(u => {
          const effective = u.psUsername ? toUserid(u.psUsername) : toUserid(u.username);
          return effective === normalized;
        });
        if (collision) {
          set.status = 409;
          return { error: `That Showdown username normalizes to "${normalized}" which conflicts with another user` };
        }
        updates.psUsername = psUsername.trim();
      }
    }
    if (Object.keys(updates).length === 0) {
      set.status = 400;
      return { error: 'No fields to update' };
    }

    db.update(schema.users).set(updates).where(eq(schema.users.id, parseInt(user.id))).run();
    return { success: true };
  })

  // ─── PATCH /api/users/:username (staff-only profile edit) ─────────────
  // Mirrors the field set of PATCH /api/users/me, but lets dev/admin edit
  // someone else's bio / status / banner. Owner edits still go through /me —
  // this route hard-rejects owner self-targeting so we don't silently route
  // around the owner-only audit trail.
  // Emits an audit-log event `profile_edited_by_staff` per call with
  // metadata { targetUserId, fields, editorId } so admin actions are
  // distinguishable from owner self-edits in the activity feed.
  .patch('/api/users/:username', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Staff only' }; }

    const targetUsername = params.username.toLowerCase().trim();
    if (targetUsername === 'me') { set.status = 400; return { error: 'Use /api/users/me for self edits' }; }

    const target = db.select({ id: schema.users.id, username: schema.users.username, active: schema.users.active })
      .from(schema.users)
      .where(eq(schema.users.username, targetUsername))
      .get();
    if (!target || !target.active) { set.status = 404; return { error: 'User not found' }; }

    if (target.id === parseInt(user.id)) {
      set.status = 400;
      return { error: 'Owner self-edit must use PATCH /api/users/me (so the audit log distinguishes it).' };
    }

    const {
      bio, statusMessage, bannerUrl,
    } = (body ?? {}) as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
    if (bio !== undefined) {
      if (bio === null || bio === '') {
        updates.bio = null;
      } else if (typeof bio !== 'string' || bio.length > MAX_BIO) {
        set.status = 400;
        return { error: `bio must be a string ≤ ${MAX_BIO} chars` };
      } else {
        updates.bio = bio;
      }
    }
    if (statusMessage !== undefined) {
      if (statusMessage === null || statusMessage === '') {
        updates.statusMessage = null;
      } else if (typeof statusMessage !== 'string' || statusMessage.length > MAX_STATUS) {
        set.status = 400;
        return { error: `statusMessage must be a string ≤ ${MAX_STATUS} chars` };
      } else {
        updates.statusMessage = statusMessage.trim();
      }
    }
    if (bannerUrl !== undefined) {
      if (bannerUrl === null || bannerUrl === '') {
        updates.bannerUrl = null;
      } else if (typeof bannerUrl !== 'string' || bannerUrl.length > MAX_BANNER_URL) {
        set.status = 400;
        return { error: `bannerUrl must be a string ≤ ${MAX_BANNER_URL} chars` };
      } else {
        updates.bannerUrl = bannerUrl.trim();
      }
    }
    if (Object.keys(updates).length === 0) {
      set.status = 400;
      return { error: 'No fields to update' };
    }

    db.update(schema.users).set(updates).where(eq(schema.users.id, target.id)).run();
    db.insert(schema.activityLog).values({
      type: 'profile_edited_by_staff',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Edited ${target.username}'s profile`,
      metadata: JSON.stringify({
        targetUserId: target.id,
        targetUsername: target.username,
        editorId: parseInt(user.id),
        fields: Object.keys(updates),
      }),
    }).run();

    return { success: true };
  })

  // ─── POST /api/users/me/avatar ────────────────────────────────────────
  .post('/api/users/me/avatar', async ({ request, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const form = await request.formData().catch(() => null);
    const file = form?.get('avatar');
    if (!(file instanceof File)) { set.status = 400; return { error: 'No file uploaded under "avatar" field' }; }
    if (!file.type.startsWith('image/')) { set.status = 400; return { error: 'File must be an image' }; }
    if (file.size > MAX_AVATAR_BYTES) { set.status = 400; return { error: 'File must be ≤ 512KB' }; }

    const ext = (file.type.split('/')[1] || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? ext : 'png';
    const filename = `${user.id}.${safeExt}`;
    const relativePath = `user-avatars/${filename}`;

    // Snapshot the old path BEFORE writing so we can clean it up after.
    const oldRow = db.select({ avatarPath: schema.users.avatarPath })
      .from(schema.users)
      .where(eq(schema.users.id, parseInt(user.id)))
      .get();
    const oldPath = oldRow?.avatarPath ?? null;

    await writeUpload(relativePath, file);

    db.update(schema.users).set({ avatarPath: relativePath }).where(eq(schema.users.id, parseInt(user.id))).run();
    db.insert(schema.activityLog).values({
      type: 'user_avatar_uploaded',
      category: 'auth',
      actor: user.username,
      leagueId: null,
      description: `Updated avatar`,
      metadata: JSON.stringify({ path: relativePath, size: file.size }),
    }).run();

    // Best-effort: remove the old avatar only after new write + DB update succeed.
    if (oldPath && oldPath !== relativePath) {
      void deleteOldAsset(oldPath, relativePath);
    }

    return { success: true, path: `/uploads/${relativePath}` };
  })

  // ─── DELETE /api/users/me/avatar ─────────────────────────────────────
  .delete('/api/users/me/avatar', async ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const row = db.select({ avatarPath: schema.users.avatarPath })
      .from(schema.users)
      .where(eq(schema.users.id, parseInt(user.id)))
      .get();

    if (row?.avatarPath) {
      // Best-effort delete — ignore errors (file may already be gone).
      try {
        unlinkSync(uploadsPath(row.avatarPath));
      } catch {
        // ignore
      }
    }

    db.update(schema.users).set({ avatarPath: null }).where(eq(schema.users.id, parseInt(user.id))).run();

    return { success: true };
  })

  // ─── POST /api/users/me/banner ────────────────────────────────────────
  // Banner image upload. Stored under uploads/user-banners/<userId>.<ext>;
  // the static-file route in admin/teams.ts (`GET /uploads/:dir/:file`) is
  // the shared server — its allow-list now includes user-banners.
  .post('/api/users/me/banner', async ({ request, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const form = await request.formData().catch(() => null);
    const file = form?.get('banner');
    if (!(file instanceof File)) { set.status = 400; return { error: 'No file uploaded under "banner" field' }; }
    if (!file.type.startsWith('image/')) { set.status = 400; return { error: 'File must be an image' }; }
    if (file.size > 1024 * 1024) { set.status = 400; return { error: 'File must be ≤ 1MB' }; }

    const ext = (file.type.split('/')[1] || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png';
    const filename = `${user.id}.${safeExt}`;
    const relativePath = `user-banners/${filename}`;

    // Snapshot the old banner path BEFORE writing so we can clean it up after.
    const oldBannerRow = db.select({ bannerUrl: schema.users.bannerUrl })
      .from(schema.users)
      .where(eq(schema.users.id, parseInt(user.id)))
      .get();
    const oldBannerPath = oldBannerRow?.bannerUrl ?? null;

    await writeUpload(relativePath, file);

    const publicPath = `/uploads/${relativePath}`;
    db.update(schema.users).set({ bannerUrl: publicPath }).where(eq(schema.users.id, parseInt(user.id))).run();
    db.insert(schema.activityLog).values({
      type: 'user_banner_uploaded',
      category: 'auth',
      actor: user.username,
      leagueId: null,
      description: `Updated banner`,
      metadata: JSON.stringify({ path: relativePath, size: file.size }),
    }).run();

    // Best-effort: remove the old banner only after new write + DB update succeed.
    if (oldBannerPath && oldBannerPath !== publicPath) {
      void deleteOldAsset(oldBannerPath, publicPath);
    }

    return { success: true, path: publicPath };
  })

  // ─── GET /api/users/me/preferences ────────────────────────────────────
  .get('/api/users/me/preferences', ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const row = db.select().from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, parseInt(user.id)))
      .get();
    if (row) {
      // /me was the old "My Hub" route — folded into / on the home merge.
      // Coerce stale prefs on read so existing users land on the unified
      // home instead of hitting a redirect on every login.
      const landing = row.defaultLandingPath === '/me' ? '/' : row.defaultLandingPath;
      return {
        theme: row.theme,
        density: row.density,
        defaultLandingPath: landing,
        timezone: row.timezone,
        colorblindMode: row.colorblindMode,
        spoilerFreeMode: row.spoilerFreeMode,
        spoilerRevealedThrough: parseRevealedThrough(row.spoilerRevealedThrough),
        spoilerRevealedMatches: parseRevealedMatches(row.spoilerRevealedMatches),
        updatedAt: row.updatedAt,
      };
    }
    // Lazy defaults — do not write until PUT. Spoiler-free defaults ON.
    return {
      theme: 'dark',
      density: 'comfortable',
      defaultLandingPath: '/',
      timezone: null,
      colorblindMode: false,
      spoilerFreeMode: true,
      spoilerRevealedThrough: {},
      spoilerRevealedMatches: [],
      updatedAt: null,
    };
  })

  // ─── PUT /api/users/me/preferences ────────────────────────────────────
  .put('/api/users/me/preferences', ({ body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const { theme, density, defaultLandingPath, timezone, colorblindMode, spoilerFreeMode } =
      (body ?? {}) as Record<string, unknown>;

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (theme !== undefined) {
      if (theme !== 'dark' && theme !== 'light') { set.status = 400; return { error: "theme must be 'dark' or 'light'" }; }
      updates.theme = theme;
    }
    if (density !== undefined) {
      if (density !== 'compact' && density !== 'comfortable') { set.status = 400; return { error: "density must be 'compact' or 'comfortable'" }; }
      updates.density = density;
    }
    if (defaultLandingPath !== undefined) {
      if (typeof defaultLandingPath !== 'string' || !defaultLandingPath.startsWith('/') || defaultLandingPath.length > 128) {
        set.status = 400;
        return { error: 'defaultLandingPath must be a path starting with /' };
      }
      updates.defaultLandingPath = defaultLandingPath;
    }
    if (timezone !== undefined) {
      if (timezone === null || timezone === '') {
        updates.timezone = null;
      } else if (typeof timezone !== 'string' || timezone.length > 64 || !isValidIanaZone(timezone)) {
        set.status = 400;
        return { error: 'timezone must be a valid IANA zone (e.g. America/New_York) or null' };
      } else {
        updates.timezone = timezone;
      }
    }
    if (colorblindMode !== undefined) {
      if (typeof colorblindMode !== 'boolean') { set.status = 400; return { error: 'colorblindMode must be boolean' }; }
      updates.colorblindMode = colorblindMode;
    }
    if (spoilerFreeMode !== undefined) {
      if (typeof spoilerFreeMode !== 'boolean') { set.status = 400; return { error: 'spoilerFreeMode must be boolean' }; }
      updates.spoilerFreeMode = spoilerFreeMode;
    }

    const userId = parseInt(user.id);
    const existing = db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)).get();
    if (existing) {
      db.update(schema.userPreferences).set(updates).where(eq(schema.userPreferences.userId, userId)).run();
    } else {
      db.insert(schema.userPreferences).values({ userId, ...updates }).run();
    }
    return { success: true };
  })

  // ─── POST /api/users/me/spoiler-reveal ────────────────────────────────
  // Reveal a league's results THROUGH a given week — bumps the per-league
  // high-water mark to max(existing, week). Revealing week N reveals weeks 1..N
  // (catch-up), so the client un-veils every result for weeks <= N at once.
  .post('/api/users/me/spoiler-reveal', ({ body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const { leagueId, week } = (body ?? {}) as { leagueId?: unknown; week?: unknown };

    if (typeof leagueId !== 'string' || !leagueId || leagueId.length > 64) {
      set.status = 400; return { error: 'leagueId must be a non-empty string' };
    }
    if (typeof week !== 'number' || !Number.isInteger(week) || week < 1) {
      set.status = 400; return { error: 'week must be a positive integer' };
    }

    const userId = parseInt(user.id);
    const existing = db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)).get();
    const map = parseRevealedThrough(existing?.spoilerRevealedThrough);
    map[leagueId] = Math.max(map[leagueId] ?? 0, week);

    const patch = { spoilerRevealedThrough: JSON.stringify(map), updatedAt: new Date().toISOString() };
    if (existing) {
      db.update(schema.userPreferences).set(patch).where(eq(schema.userPreferences.userId, userId)).run();
    } else {
      db.insert(schema.userPreferences).values({ userId, ...patch }).run();
    }
    return { spoilerRevealedThrough: map };
  })

  // ─── POST /api/users/me/spoiler-reveal-match ──────────────────────────
  // Reveal a SINGLE match individually (schedule/replays per-match tag). Adds
  // the match ID to the user's revealed set (deduped). The reveal persists
  // across reloads, independent of the per-week reveal high-water mark.
  .post('/api/users/me/spoiler-reveal-match', ({ body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const { matchId } = (body ?? {}) as { matchId?: unknown };

    if (typeof matchId !== 'string' || !matchId || matchId.length > 64) {
      set.status = 400; return { error: 'matchId must be a non-empty string' };
    }

    const userId = parseInt(user.id);
    const existing = db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)).get();
    const set_ = new Set(parseRevealedMatches(existing?.spoilerRevealedMatches));
    set_.add(matchId);
    const list = Array.from(set_);

    const patch = { spoilerRevealedMatches: JSON.stringify(list), updatedAt: new Date().toISOString() };
    if (existing) {
      db.update(schema.userPreferences).set(patch).where(eq(schema.userPreferences.userId, userId)).run();
    } else {
      db.insert(schema.userPreferences).values({ userId, ...patch }).run();
    }
    return { success: true, spoilerRevealedMatches: list };
  })

  // ─── GET /api/users/me/lifetime-stats ─────────────────────────────────
  .get('/api/users/me/lifetime-stats', ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    return computeLifetimeStats(parseInt(user.id));
  })

  // ─── GET /api/users/:username (public profile) ────────────────────────
  // NOTE: route order matters — this must come AFTER /api/users/me/* so
  // 'me' isn't matched as a username. Elysia resolves longer-prefix routes
  // first, but we keep the literal routes above for clarity.
  .get('/api/users/:username', ({ params, set }) => {
    const username = params.username.toLowerCase().trim();
    if (username === 'me') { set.status = 404; return { error: 'Not found' }; }
    const row = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
    if (!row || !row.active) { set.status = 404; return { error: 'User not found' }; }

    // Pull every team this user has ever owned, joined with the season the
    // team belonged to. Active-season tenures populate `currentTeams`;
    // archived-season tenures populate `pastTeams` with finish data so the
    // history list can render finishing-position badges. Prefer the
    // pre-stamped `teams.finishPosition`/`teams.finishLabel` columns
    // (set during season-end archival in A4); fall back to the dynamic
    // finals-match + seeding-rank computation for rows that haven't been
    // stamped yet (un-archived seasons in mid-flight, or older rows that
    // pre-date the columns).
    const allTeams = db.select({
      teamId: schema.teams.id,
      leagueId: schema.teams.leagueId,
      teamName: schema.teams.teamName,
      teamAbbrev: schema.teams.teamAbbrev,
      teamColor: schema.teams.teamColor,
      logoPath: schema.teams.logoPath,
      rank: schema.teams.rank,
      finishPosition: schema.teams.finishPosition,
      finishLabel: schema.teams.finishLabel,
      seasonId: schema.leagues.seasonId,
      leaguePhase: schema.leagues.phase,
      seasonNumber: schema.seasons.seasonNumber,
      seasonArchived: schema.seasons.archived,
    })
      .from(schema.teams)
      .innerJoin(schema.leagues, eq(schema.teams.leagueId, schema.leagues.id))
      .innerJoin(schema.seasons, eq(schema.leagues.seasonId, schema.seasons.id))
      .where(eq(schema.teams.userId, row.id))
      .all();

    const currentTeams = allTeams
      .filter(t => !t.seasonArchived)
      .map(t => ({
        teamId: t.teamId,
        leagueId: t.leagueId,
        teamName: t.teamName,
        teamAbbrev: t.teamAbbrev,
        teamColor: t.teamColor,
        logoPath: t.logoPath,
        seasonNumber: t.seasonNumber,
        leaguePhase: t.leaguePhase,
      }));

    // Past tenures: archived seasons only. For each, derive a finish
    // descriptor. Prefer the stamped `teams.finishPosition` /
    // `teams.finishLabel` columns when present (A4's archive flow stamps
    // them at season-end). Otherwise compute dynamically from the finals
    // match (champion/finalist), then fall back to `teams.rank` (set when
    // playoff seeding ran). Missing data renders as `null` on the client
    // so a partially-seeded archive doesn't crash the history wall.
    const pastTeams = allTeams
      .filter(t => t.seasonArchived)
      .map(t => {
        let finish: { position: number; label: string } | null = null;

        // 1. Pre-stamped columns (A4 archive flow).
        if (typeof t.finishPosition === 'number' && t.finishLabel) {
          finish = { position: t.finishPosition, label: t.finishLabel };
        }

        // 2. Dynamic from finals match.
        if (!finish) {
          const finals = db.select({
            homeTeamId: schema.matches.homeTeamId,
            awayTeamId: schema.matches.awayTeamId,
            homeScore: schema.matches.homeScore,
            awayScore: schema.matches.awayScore,
            status: schema.matches.status,
          })
            .from(schema.matches)
            .where(and(
              eq(schema.matches.leagueId, t.leagueId),
              eq(schema.matches.phase, 'playoffs'),
              eq(schema.matches.playoffRound, 'f'),
            ))
            .get();

          if (finals && finals.status === 'completed' &&
              finals.homeScore != null && finals.awayScore != null) {
            const isHome = finals.homeTeamId === t.teamId;
            const isAway = finals.awayTeamId === t.teamId;
            if (isHome || isAway) {
              const myScore = isHome ? finals.homeScore : finals.awayScore;
              const oppScore = isHome ? finals.awayScore : finals.homeScore;
              if (myScore > oppScore) finish = { position: 1, label: 'Champion' };
              else finish = { position: 2, label: 'Runner-up' };
            }
          }
        }

        // 3. Fallback to seeding rank.
        if (!finish && typeof t.rank === 'number' && t.rank > 0) {
          const r = t.rank;
          const label = r === 3 ? 'Semifinalist'
            : r === 4 ? 'Semifinalist'
            : r <= 6 ? 'Quarterfinalist'
            : `Rank ${r}`;
          finish = { position: r, label };
        }

        return {
          teamId: t.teamId,
          leagueId: t.leagueId,
          // seasonId (DB id, numeric) is required for /archive/:seasonId/:leagueId/:teamId
          // routing on the coach profile history cards.
          seasonId: t.seasonId,
          teamName: t.teamName,
          teamAbbrev: t.teamAbbrev,
          teamColor: t.teamColor,
          logoPath: t.logoPath,
          seasonNumber: t.seasonNumber,
          finish,
        };
      })
      // Most recent season first.
      .sort((a, b) => b.seasonNumber - a.seasonNumber);

    const stats = computeLifetimeStats(row.id);

    return {
      username: row.username,
      displayName: row.displayName,
      bio: row.bio,
      statusMessage: row.statusMessage,
      bannerUrl: row.bannerUrl,
      lastSeenAt: row.lastSeenAt,
      avatarPath: row.avatarPath,
      primaryColor: row.primaryColor,
      secondaryColor: row.secondaryColor,
      tertiaryColor: row.tertiaryColor,
      createdAt: row.createdAt,
      // Surface role so the identity strip can show an ADMIN chip without
      // a second auth round-trip. Only dev/admin → chip on the frontend.
      role: row.role,
      currentTeams,
      pastTeams,
      careerSummary: {
        seasonsPlayed: stats.seasonsPlayed,
        careerWins: stats.totalRecord.wins,
        careerLosses: stats.totalRecord.losses,
        careerKills: stats.careerKills,
        careerDeaths: stats.careerDeaths,
        championships: stats.championships,
      },
    };
  });

// ─── Helpers ──────────────────────────────────────────────────────────────

export function computeLifetimeStats(userId: number) {
  const userTeams = db.select({
    teamId: schema.teams.id,
    leagueId: schema.teams.leagueId,
    teamName: schema.teams.teamName,
  }).from(schema.teams).where(eq(schema.teams.userId, userId)).all();

  if (userTeams.length === 0) {
    return {
      seasonsPlayed: 0,
      totalRecord: { wins: 0, losses: 0 },
      careerKills: 0,
      careerDeaths: 0,
      totalTrades: 0,
      championships: 0,
      leagueBreakdown: [],
    };
  }

  const teamIds = userTeams.map(t => t.teamId);
  const leagueIds = Array.from(new Set(userTeams.map(t => t.leagueId)));

  // Results-reveal gate: resolve each contributing league's reveal high-water
  // mark. A league with NULL counts fully (archived S9/S10 are unaffected);
  // only a gated league's unpublished weeks (week > N) are excluded. Multi-league
  // by design, so the gate is resolved per league.
  const gateRows = db.select({ id: schema.leagues.id, gate: schema.leagues.resultsRevealedThrough })
    .from(schema.leagues)
    .where(sql`${schema.leagues.id} IN (${sql.join(leagueIds.map(id => sql`${id}`), sql`, `)})`)
    .all();
  const gateByLeague = new Map<string, number | null>(gateRows.map(r => [r.id, r.gate ?? null]));
  /** True when a match's week is published under its league's gate. */
  const weekAllowed = (leagueId: string, week: number | null): boolean => {
    const gate = gateByLeague.get(leagueId) ?? null;
    if (gate == null) return true;
    return (week ?? 0) <= gate;
  };
  // SQL form of the gate for the bulk K/D aggregate: exclude matchPokemon whose
  // match is in a gated league AND beyond the revealed week. Leagues with NULL
  // gate contribute no exclusion clause.
  const gatedLeagues = gateRows.filter(r => r.gate != null) as Array<{ id: string; gate: number }>;
  const kdGateClause = gatedLeagues.length > 0
    ? and(...gatedLeagues.map(g =>
        sql`NOT (${schema.matches.leagueId} = ${g.id} AND ${schema.matches.week} > ${g.gate})`))
    : undefined;

  // Aggregate K/D across all match_pokemon for owned teams (gated per league)
  const kdRow = db.select({
    kills: sql<number>`COALESCE(SUM(${schema.matchPokemon.kills}), 0)`,
    deaths: sql<number>`COALESCE(SUM(${schema.matchPokemon.deaths}), 0)`,
  }).from(schema.matchPokemon)
    .innerJoin(schema.matches, eq(schema.matchPokemon.matchId, schema.matches.id))
    .where(and(
      sql`${schema.matchPokemon.teamId} IN (${sql.join(teamIds.map(id => sql`${id}`), sql`, `)})`,
      kdGateClause,
    ))
    .get();

  const careerKills = kdRow?.kills ?? 0;
  const careerDeaths = kdRow?.deaths ?? 0;

  // League-by-league record + championships
  let totalWins = 0;
  let totalLosses = 0;
  let championships = 0;
  const leagueBreakdown: Array<{
    leagueId: string;
    teamId: string;
    teamName: string;
    record: { wins: number; losses: number };
    finish: string | null;
    isChampion: boolean;
  }> = [];

  for (const ut of userTeams) {
    const matches = db.select({
      id: schema.matches.id,
      week: schema.matches.week,
      homeTeamId: schema.matches.homeTeamId,
      awayTeamId: schema.matches.awayTeamId,
      homeScore: schema.matches.homeScore,
      awayScore: schema.matches.awayScore,
      phase: schema.matches.phase,
      playoffRound: schema.matches.playoffRound,
      status: schema.matches.status,
    }).from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, ut.leagueId),
        sql`(${schema.matches.homeTeamId} = ${ut.teamId} OR ${schema.matches.awayTeamId} = ${ut.teamId})`,
      ))
      .all();

    let wins = 0, losses = 0;
    for (const m of matches) {
      if (m.status !== 'completed') continue;
      if (m.homeScore == null || m.awayScore == null) continue;
      // Results-reveal gate: skip matches whose week is unpublished for this
      // league (NULL gate counts everything).
      if (!weekAllowed(ut.leagueId, m.week)) continue;
      const isHome = m.homeTeamId === ut.teamId;
      const myScore = isHome ? m.homeScore : m.awayScore;
      const oppScore = isHome ? m.awayScore : m.homeScore;
      if (myScore > oppScore) wins++; else if (oppScore > myScore) losses++;
    }
    totalWins += wins;
    totalLosses += losses;

    const final = matches.find(m => m.phase === 'playoffs' && m.playoffRound === 'f' && m.status === 'completed');
    let finish: string | null = null;
    let isChampion = false;
    if (final && final.homeScore != null && final.awayScore != null) {
      const isHome = final.homeTeamId === ut.teamId;
      const myScore = isHome ? final.homeScore : final.awayScore;
      const oppScore = isHome ? final.awayScore : final.homeScore;
      if (myScore > oppScore) { finish = 'champion'; isChampion = true; championships++; }
      else { finish = 'finalist'; }
    }

    leagueBreakdown.push({
      leagueId: ut.leagueId,
      teamId: ut.teamId,
      teamName: ut.teamName,
      record: { wins, losses },
      finish,
      isChampion,
    });
  }

  // Trade count (proposer or recipient was an owned team)
  const tradeRow = db.select({ count: sql<number>`COUNT(*)` })
    .from(schema.trades)
    .where(and(
      eq(schema.trades.status, 'accepted'),
      sql`(${schema.trades.proposerId} IN (${sql.join(teamIds.map(id => sql`${id}`), sql`, `)}) OR ${schema.trades.recipientId} IN (${sql.join(teamIds.map(id => sql`${id}`), sql`, `)}))`,
    ))
    .get();

  return {
    seasonsPlayed: leagueIds.length,
    totalRecord: { wins: totalWins, losses: totalLosses },
    careerKills,
    careerDeaths,
    totalTrades: tradeRow?.count ?? 0,
    championships,
    leagueBreakdown,
  };
}
