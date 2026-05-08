import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, desc } from 'drizzle-orm';
import { standingsRoutes } from './standings';
import { teamRoutes } from './teams';
import { pokemonRoutes } from './pokemon';
import { archiveRoutes } from './archive';
import { speedTierRoutes } from './speed-tiers';

export const leagueRoutes = new Elysia()

  // ─── Leagues ─────────────────────────────────────────────────────────

  .get('/api/leagues', () => {
    const season = db.select().from(schema.seasons)
      .orderBy(desc(schema.seasons.seasonNumber))
      .get();
    if (!season) return [];
    const leagues = db.select().from(schema.leagues)
      .where(eq(schema.leagues.seasonId, season.id))
      .all();
    return leagues.map(l => ({
      id: l.id,
      name: l.name,
      color: l.color,
      draftDate: l.draftDate,
      draftOrder: l.draftOrder ? JSON.parse(l.draftOrder) : null,
      playoffTeamCount: l.playoffTeamCount,
      format: l.format,
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
        archived: !!season.archived,
      } : null,
    }));
  })

  // ─── Season ──────────────────────────────────────────────────────────

  .get('/api/season', () => {
    const season = db.select().from(schema.seasons).get();
    return season || null;
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
      announcement: null,
      announcementType: 'info',
      draftDemoVisible: isMock,
    };
    return {
      announcement: row.announcement,
      announcementType: row.announcementType,
      defaultUserPassword: row.defaultUserPassword,
      draftTimerEnabled: row.draftTimerEnabled ?? true,
      draftDemoVisible: row.draftDemoVisible ?? isMock,
      faDeadlineWeek: row.faDeadlineWeek ?? 7,
      defaultPlayoffTeamCount: row.defaultPlayoffTeamCount ?? 6,
    };
  })

  .use(standingsRoutes)
  .use(teamRoutes)
  .use(pokemonRoutes)
  .use(archiveRoutes)
  .use(speedTierRoutes);
