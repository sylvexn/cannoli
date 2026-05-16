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
import { db, schema } from '../db';
import { eq, and, sql } from 'drizzle-orm';

const MAX_DISPLAY_NAME = 32;
const MAX_BIO = 280;
const MAX_STATUS = 80;
const MAX_BANNER_URL = 255;
const MAX_TITLE = 40;
const MAX_AVATAR_BYTES = 512 * 1024;

/** Canonical 18-type list — kept in sync with frontend POKEMON_TYPES. */
const VALID_TYPES = new Set([
  'normal', 'fire', 'water', 'electric', 'grass', 'ice',
  'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
  'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
]);

export const userRoutes = new Elysia()

  // ─── PATCH /api/users/me ──────────────────────────────────────────────
  // Self-only edit endpoint. Accepts any subset of:
  //   displayName        — overrides username in UI (≤ 32)
  //   bio                — markdown-light, ≤ 280
  //   statusMessage      — one-liner, ≤ 80
  //   bannerUrl          — relative or absolute URL, ≤ 255 (null clears)
  //   signaturePokemonId — pokemon.id of the coach's signature mon (null clears)
  //   title              — short flair string, ≤ 40 (null clears)
  //   signatureType      — canonical Pokemon type (null clears)
  // Banner uploads should go through POST /api/users/me/banner (multipart);
  // this PATCH is for clearing the banner or pasting an external image URL.
  .patch('/api/users/me', ({ body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const {
      displayName, bio, statusMessage, bannerUrl,
      signaturePokemonId, title, signatureType,
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
    if (signaturePokemonId !== undefined) {
      if (signaturePokemonId === null) {
        updates.signaturePokemonId = null;
      } else if (typeof signaturePokemonId !== 'number' || !Number.isInteger(signaturePokemonId)) {
        set.status = 400;
        return { error: 'signaturePokemonId must be an integer or null' };
      } else {
        const exists = db.select({ id: schema.pokemon.id }).from(schema.pokemon)
          .where(eq(schema.pokemon.id, signaturePokemonId)).get();
        if (!exists) { set.status = 400; return { error: `Pokemon ${signaturePokemonId} not found` }; }
        updates.signaturePokemonId = signaturePokemonId;
      }
    }
    if (title !== undefined) {
      if (title === null || title === '') {
        updates.title = null;
      } else if (typeof title !== 'string' || title.length > MAX_TITLE) {
        set.status = 400;
        return { error: `title must be a string ≤ ${MAX_TITLE} chars` };
      } else {
        updates.title = title.trim();
      }
    }
    if (signatureType !== undefined) {
      if (signatureType === null || signatureType === '') {
        updates.signatureType = null;
      } else if (typeof signatureType !== 'string' || !VALID_TYPES.has(signatureType.toLowerCase())) {
        set.status = 400;
        return { error: 'signatureType must be one of the 18 canonical Pokemon types' };
      } else {
        updates.signatureType = signatureType.toLowerCase();
      }
    }
    if (Object.keys(updates).length === 0) {
      set.status = 400;
      return { error: 'No fields to update' };
    }

    db.update(schema.users).set(updates).where(eq(schema.users.id, parseInt(user.id))).run();
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
    const absPath = `${process.cwd()}/uploads/${relativePath}`;

    await Bun.write(absPath, file);

    db.update(schema.users).set({ avatarPath: relativePath }).where(eq(schema.users.id, parseInt(user.id))).run();
    db.insert(schema.activityLog).values({
      type: 'user_avatar_uploaded',
      category: 'auth',
      actor: user.username,
      leagueId: null,
      description: `Updated avatar`,
      metadata: JSON.stringify({ path: relativePath, size: file.size }),
    }).run();

    return { success: true, path: `/uploads/${relativePath}` };
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
    const absPath = `${process.cwd()}/uploads/${relativePath}`;

    await Bun.write(absPath, file);

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

    return { success: true, path: publicPath };
  })

  // ─── GET /api/users/me/preferences ────────────────────────────────────
  .get('/api/users/me/preferences', ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const row = db.select().from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, parseInt(user.id)))
      .get();
    if (row) {
      return {
        theme: row.theme,
        density: row.density,
        defaultLandingPath: row.defaultLandingPath,
        notifyTrades: row.notifyTrades,
        notifyMatches: row.notifyMatches,
        notifyAnnouncements: row.notifyAnnouncements,
        updatedAt: row.updatedAt,
      };
    }
    // Lazy defaults — do not write until PUT
    return {
      theme: 'dark',
      density: 'comfortable',
      defaultLandingPath: '/',
      notifyTrades: true,
      notifyMatches: true,
      notifyAnnouncements: true,
      updatedAt: null,
    };
  })

  // ─── PUT /api/users/me/preferences ────────────────────────────────────
  .put('/api/users/me/preferences', ({ body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const { theme, density, defaultLandingPath, notifyTrades, notifyMatches, notifyAnnouncements } =
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
    for (const [k, v] of [
      ['notifyTrades', notifyTrades],
      ['notifyMatches', notifyMatches],
      ['notifyAnnouncements', notifyAnnouncements],
    ] as const) {
      if (v !== undefined) {
        if (typeof v !== 'boolean') { set.status = 400; return { error: `${k} must be boolean` }; }
        updates[k] = v;
      }
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

    const currentTeams = db.select({
      teamId: schema.teams.id,
      leagueId: schema.teams.leagueId,
      teamName: schema.teams.teamName,
      teamAbbrev: schema.teams.teamAbbrev,
      teamColor: schema.teams.teamColor,
      logoPath: schema.teams.logoPath,
    }).from(schema.teams).where(eq(schema.teams.userId, row.id)).all();

    // Resolve signature pokemon's display name once so callers don't have to
    // round-trip a second lookup just to render the sprite (sprite filename
    // derives from name, not id).
    let signaturePokemonName: string | null = null;
    if (row.signaturePokemonId != null) {
      const sp = db.select({ name: schema.pokemon.name }).from(schema.pokemon)
        .where(eq(schema.pokemon.id, row.signaturePokemonId)).get();
      signaturePokemonName = sp?.name ?? null;
    }

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
      // ─── Coach flair ─────────────────────────────────────────────────
      signaturePokemonId: row.signaturePokemonId,
      signaturePokemonName,
      title: row.title,
      signatureType: row.signatureType,
      currentTeams,
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

function computeLifetimeStats(userId: number) {
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

  // Aggregate K/D across all match_pokemon for owned teams
  const kdRow = db.select({
    kills: sql<number>`COALESCE(SUM(${schema.matchPokemon.kills}), 0)`,
    deaths: sql<number>`COALESCE(SUM(${schema.matchPokemon.deaths}), 0)`,
  }).from(schema.matchPokemon)
    .where(sql`${schema.matchPokemon.teamId} IN (${sql.join(teamIds.map(id => sql`${id}`), sql`, `)})`)
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
