import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, desc, sql, and, isNull, inArray } from 'drizzle-orm';
import { standingsRoutes } from './standings';
import { teamRoutes } from './teams';
import { pokemonRoutes } from './pokemon';
import { archiveRoutes } from './archive';
import { speedTierRoutes } from './speed-tiers';

export const leagueRoutes = new Elysia()

  // ─── Leagues ─────────────────────────────────────────────────────────

  .get('/api/leagues', ({ query }) => {
    // `?all=1` returns leagues across EVERY season (incl. archived) — used by
    // the Replay Gallery to browse historical replays. Default (no param)
    // keeps the legacy behaviour: just the latest season's leagues.
    const includeAll = query?.all === '1' || query?.all === 'true';

    const allSeasons = db.select().from(schema.seasons)
      .orderBy(desc(schema.seasons.seasonNumber))
      .all();
    if (allSeasons.length === 0) return [];
    const seasonsById = new Map(allSeasons.map(s => [s.id, s]));
    const seasonScope = includeAll ? allSeasons : [allSeasons[0]!];
    const seasonIds = new Set(seasonScope.map(s => s.id));

    const leagues = db.select().from(schema.leagues)
      .all()
      .filter(l => seasonIds.has(l.seasonId));
    // Per-league registered-team count. A coach == a team (teams.userId), so
    // the team count is the player count. The admin Leagues tab reads this;
    // previously it had no count source and rendered "0 players".
    const teamCounts = new Map(
      db.select({
        leagueId: schema.teams.leagueId,
        count: sql<number>`COUNT(*)`,
      })
        .from(schema.teams)
        .groupBy(schema.teams.leagueId)
        .all()
        .map(r => [r.leagueId, r.count]),
    );
    return leagues.map(l => {
      const season = seasonsById.get(l.seasonId) ?? null;
      return ({
      id: l.id,
      name: l.name,
      color: l.color,
      draftDate: l.draftDate,
      draftOrder: l.draftOrder ? JSON.parse(l.draftOrder) : null,
      playoffTeamCount: l.playoffTeamCount,
      format: l.format,
      // Cost format ('natdex' | 'natdexplus') — which per-league price sheet this
      // league's pool is drafted/valued against. Drives the frontend's cost
      // display + the backend draft/FA/trade cost math (see lib/league-costs.ts).
      costFormat: l.costFormat,
      // Canonical deadline-cutoff timezone for this league. The auto-forfeit
      // job anchors end-of-day to this zone; the frontend (sweep 3c) labels
      // each user's local rendering against it.
      timezone: l.timezone,
      playerCount: teamCounts.get(l.id) ?? 0,
      // Lifecycle fields are per-league (3 leagues run independently per
      // season). Surfaced under `season` for backwards-compat with all
      // existing frontend readers; the underlying source of truth is the
      // league row.
      season: season ? {
        id: `s${season.seasonNumber}`,
        seasonNumber: season.seasonNumber,
        phase: l.phase,
        currentWeek: l.currentWeek,
        totalWeeks: l.totalWeeks,
        pointCap: season.pointCap,
        teraCaptainSlots: season.teraCaptainSlots,
        tradeDeadlineWeek: l.tradeDeadlineWeek,
        rosterSize: l.rosterSize,
        forfeitPolicy: l.forfeitPolicy,
        paused: l.paused,
        weekDates: l.weekDates ? JSON.parse(l.weekDates) : null,
        weekDatesAutoFilled: !!l.weekDatesAutoFilled,
        archived: !!season.archived,
      } : null,
    });
    });
  })

  // ─── Season ──────────────────────────────────────────────────────────

  .get('/api/season', () => {
    const season = db.select().from(schema.seasons).get();
    return season || null;
  })

  // ─── News (PS client compatibility) ─────────────────────────────────
  //
  // Pokemon Showdown's "Latest News" pseudo-PM expects an array of
  // `{ id, title, summaryHTML, author, date }` (date in unix seconds) at
  // `https://<routes.root>/news.json`. We surface the most recent active
  // banner-or-both, global (no league/role targeting) announcement here so
  // sim.cannoli.live shows the same message admins post in the Cannoli admin
  // panel instead of stale upstream PS news.
  //
  // Public + unauthenticated — the PS client has no Cannoli session.
  // The id is hashed over category|title|body so changing content marks the
  // entry unread again in PS's read-tracker.
  .get('/news.json', () => {
    const ann = db.select().from(schema.announcements)
      .where(and(
        sql`${schema.announcements.active} = 1`,
        sql`${schema.announcements.surface} IN ('banner', 'both')`,
        isNull(schema.announcements.leagueId),
        isNull(schema.announcements.targetRole),
      ))
      .orderBy(desc(schema.announcements.createdAt))
      .limit(1)
      .get();

    if (!ann) return [];

    const category = ann.category as string;
    const typeLabel = category === 'maintenance' ? 'Warning'
      : category === 'feature' ? 'Update'
      : category === 'event' ? 'Event'
      : 'Announcement';

    // Bump id when the message content changes so PS marks it unread again.
    // Storage.prefs('readnews') compares this id as a string.
    let hash = 0;
    const src = `${category}|${ann.title}|${ann.body}`;
    for (let i = 0; i < src.length; i++) {
      hash = ((hash << 5) - hash + src.charCodeAt(i)) | 0;
    }
    const id = Math.abs(hash);

    // PS escapes nothing in summaryHTML, so we hand back HTML — escape the
    // raw text first to be safe (admins type plain strings).
    const escapeHtml = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const isGenericTitle = ann.title === 'Announcement';
    const summaryHTML = isGenericTitle
      ? escapeHtml(ann.body)
      : `<strong>${escapeHtml(ann.title)}</strong> — ${escapeHtml(ann.body)}`;

    return [{
      id,
      title: typeLabel,
      summaryHTML,
      author: 'Cannoli',
      date: Math.floor(Date.now() / 1000),
    }];
  })

  // ─── Site Settings ──────────────────────────────────────────────────

  .get('/api/site-settings', () => {
    // Practice draft visibility defaults to true on mock (so the simulator is
    // discoverable in dev) and false on live (so it's hidden until the admin
    // explicitly opts in via /admin/site-settings). The DB column itself
    // defaults to true in the schema; this fallback only applies when the
    // value is genuinely missing (NULL / no row).
    const isMock = (process.env.CANNOLI_MODE || 'mock') === 'mock';
    const row = db.select().from(schema.siteSettings).get();
    if (!row) return {
      draftDemoVisible: isMock,
      faPickupsPerSeason: 6,
    };
    return {
      defaultUserPassword: row.defaultUserPassword,
      draftTimerEnabled: row.draftTimerEnabled ?? true,
      draftDemoVisible: row.draftDemoVisible ?? isMock,
      faDeadlineWeek: row.faDeadlineWeek ?? 7,
      defaultPlayoffTeamCount: row.defaultPlayoffTeamCount ?? 6,
      faPickupsPerSeason: row.faPickupsPerSeason ?? 6,
    };
  })

  .use(standingsRoutes)
  .use(teamRoutes)
  .use(pokemonRoutes)
  .use(archiveRoutes)
  .use(speedTierRoutes);
