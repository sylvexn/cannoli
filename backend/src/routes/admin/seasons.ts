import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, sql, desc } from 'drizzle-orm';
import { isStaff } from '../../lib/auth';
import { tx } from '../../lib/tx';
import { runAutoAwards } from '../../lib/pins/auto-award';
import { mintArchivePins, type ArchiveMintSummary } from '../../lib/pins/archive-mint';

export const seasonRoutes = new Elysia()

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

  // ─── Season archive toggle ──────────────────────────────────────────

  .put('/api/seasons/:seasonId/archived', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const seasonId = parseInt(params.seasonId);
    if (!Number.isFinite(seasonId)) { set.status = 400; return { error: 'Invalid seasonId' }; }
    const { archived } = body as { archived?: boolean };
    if (typeof archived !== 'boolean') {
      set.status = 400; return { error: 'archived (boolean) required' };
    }
    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).get();
    if (!season) { set.status = 404; return { error: 'Season not found' }; }

    tx(() => {
      db.update(schema.seasons).set({ archived }).where(eq(schema.seasons.id, seasonId)).run();
      db.insert(schema.activityLog).values({
        type: archived ? 'season_archived' : 'season_unarchived',
        category: 'config',
        actor: user.username,
        leagueId: null,
        description: archived
          ? `Archived Season ${season.seasonNumber} (writes now require force)`
          : `Un-archived Season ${season.seasonNumber}`,
        metadata: JSON.stringify({ seasonId, seasonNumber: season.seasonNumber, archived }),
      }).run();
    });

    return { success: true };
  })

  // ─── Archive ceremony ───────────────────────────────────────────────
  // The "Archive Season" admin button. Wraps three things into one
  // transactional action:
  //   1. Set seasons.archived = 1 (writes now require ?force=1).
  //   2. Force every league in the season to phase=offseason. Once a season
  //      is archived no league should still report itself as in-progress.
  //   3. Mint the season-end auto-award pins (existing garchomp/cannoli/cynthia
  //      via runAutoAwards, plus the four new pins via mintArchivePins).
  //
  // Idempotent: re-running on an already-archived season simply re-runs the
  // pin minters (which themselves are INSERT OR IGNORE + scoped DELETE),
  // useful when stats are corrected post-archive and you want to recompute.
  .post('/api/admin/seasons/:seasonId/archive', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const seasonId = parseInt(params.seasonId);
    if (!Number.isFinite(seasonId)) { set.status = 400; return { error: 'Invalid seasonId' }; }
    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).get();
    if (!season) { set.status = 404; return { error: 'Season not found' }; }

    const leagues = db.select().from(schema.leagues).where(eq(schema.leagues.seasonId, seasonId)).all();
    const awardedBy = user?.id ? parseInt(user.id) : null;

    const existingAwards: { leagueId: string; awarded: number; skipped: number }[] = [];
    const newAwards: ArchiveMintSummary[] = [];

    tx(() => {
      db.update(schema.seasons).set({ archived: true }).where(eq(schema.seasons.id, seasonId)).run();
      for (const l of leagues) {
        if (l.phase !== 'offseason') {
          db.update(schema.leagues).set({ phase: 'offseason' }).where(eq(schema.leagues.id, l.id)).run();
        }
        const existing = runAutoAwards(l.id, { trigger: 'season-end', awardedBy });
        existingAwards.push({ leagueId: l.id, awarded: existing.awarded.length, skipped: existing.skipped });
        const archive = mintArchivePins(l.id, { awardedBy });
        newAwards.push(archive);
      }
      db.insert(schema.activityLog).values({
        type: 'season_archived',
        category: 'config',
        actor: user.username,
        leagueId: null,
        description: `Archived Season ${season.seasonNumber} (${leagues.length} league${leagues.length === 1 ? '' : 's'})`,
        metadata: JSON.stringify({
          seasonId,
          seasonNumber: season.seasonNumber,
          existingAwards,
          newAwards: newAwards.map(a => ({
            leagueId: a.leagueId,
            awarded: a.awarded.length,
            skipped: a.skipped,
          })),
        }),
      }).run();
    });

    return {
      success: true,
      seasonId,
      seasonNumber: season.seasonNumber,
      leagues: leagues.length,
      existingAwards,
      newAwards: newAwards.map(a => ({
        leagueId: a.leagueId,
        awarded: a.awarded,
        skipped: a.skipped,
      })),
    };
  })

;
