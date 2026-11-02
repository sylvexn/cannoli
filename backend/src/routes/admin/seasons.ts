import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, sql, desc } from 'drizzle-orm';
import { requireStaff } from '../../lib/auth-guards';
import { tx } from '../../lib/tx';
import { createInstance, RulesetInputError, type RuleOverrides } from '../../lib/ruleset-instances';
import { getLeagueRuleset } from '../../lib/rulesets';
import { clearArchiveCache } from '../../lib/archive-cache';

/** `s11-ruby` -> `ruby`; names like "Ruby League" -> `ruby`. */
export const stripSeasonPrefix = (id: string) => id.replace(/^s\d+-/, '');
const slugify = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export function leagueSlug(slug?: string, id?: string, name?: string): string {
  return slugify(slug ?? '') || slugify(stripSeasonPrefix(id ?? '')) || slugify((name ?? '').trim().replace(/\s+league$/i, ''));
}

export const seasonRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })

  // Prefill data for the season-setup wizard: the latest season's leagues, rules and teams.
  .get('/api/admin/seasons/setup-defaults', () => {
    const latest = db.select().from(schema.seasons).orderBy(desc(schema.seasons.seasonNumber)).get();
    if (!latest) return { nextSeasonNumber: 1, source: null, leagues: [] };
    const leagues = db.select().from(schema.leagues).where(eq(schema.leagues.seasonId, latest.id)).all().map(l => {
      const rs = getLeagueRuleset(l.id);
      const teams = db.select({
        teamName: schema.teams.teamName, teamAbbrev: schema.teams.teamAbbrev, teamColor: schema.teams.teamColor,
        coachName: schema.teams.coachName, username: schema.users.username,
      }).from(schema.teams).leftJoin(schema.users, eq(schema.users.id, schema.teams.userId))
        .where(eq(schema.teams.leagueId, l.id)).all();
      return {
        sourceLeagueId: l.id,
        slug: stripSeasonPrefix(l.id),
        name: l.name,
        color: l.color,
        ruleset: { ...rs, id: l.rulesetId },
        totalWeeks: l.totalWeeks,
        tradeDeadlineWeek: l.tradeDeadlineWeek,
        playoffTeamCount: l.playoffTeamCount,
        forfeitPolicy: l.forfeitPolicy,
        format: l.format,
        teams,
      };
    });
    return {
      nextSeasonNumber: latest.seasonNumber + 1,
      source: { seasonId: latest.id, seasonNumber: latest.seasonNumber },
      leagues,
    };
  })

  // Seasons CRUD

  .post('/api/seasons', async ({ body, user, set }) => {
    const {
      seasonNumber,
      totalWeeks = 11,
      pointCap = 110,
      teraCaptainSlots = 2,
      rulesetId: seasonRulesetId = null,
      costFormat: seasonCostFormat,
      tradeDeadlineWeek = 7,
      rosterSize = 10,
      minRosterSize = null,
      maxRosterSize = null,
      forfeitPolicy = 'double_forfeit',
      format = 'gen9natdex',
      playoffTeamCount = 6,
      weekDates = null,
      leagues: rawLeagues = [],
      overlapOverride = false,
    } = body as {
      seasonNumber: number;
      totalWeeks?: number;
      pointCap?: number;
      teraCaptainSlots?: number;
      /** Season-level ruleset (template or instance); prefills every league without its own. */
      rulesetId?: number | null;
      /** Legacy path only (no rulesetId): cost format for the generated rulesets. */
      costFormat?: string;
      tradeDeadlineWeek?: number;
      rosterSize?: number;
      minRosterSize?: number | null;
      maxRosterSize?: number | null;
      forfeitPolicy?: 'double_forfeit' | 'admin_review';
      format?: string;
      playoffTeamCount?: number;
      weekDates?: Record<string, string> | null;
      leagues?: {
        /** Ignored as an id (server generates `s<N>-<slug>`); fallback slug source. */
        id?: string;
        slug?: string;
        name: string;
        color: string;
        draftDate?: string | null;
        /** Template or another league's instance (even frozen/archived) to copy. */
        sourceRulesetId?: number | null;
        /** Legacy alias of sourceRulesetId; overrides the season-level one. */
        rulesetId?: number | null;
        rules?: RuleOverrides;
        costFormat?: string;
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

    if (![2, 4, 6, 8].includes(playoffTeamCount)) {
      set.status = 400; return { error: 'playoffTeamCount must be one of 2, 4, 6, 8' };
    }

    // League ids are server-generated (`s<N>-<slug>`): never trust client ids.
    const leaguePayloads: (typeof rawLeagues[number] & { id: string })[] = [];
    const seenIds = new Set<string>();
    for (const l of rawLeagues) {
      const slug = leagueSlug(l.slug, l.id, l.name);
      if (!slug) { set.status = 400; return { error: 'League needs a name or slug' }; }
      const id = `s${seasonNumber}-${slug}`;
      if (seenIds.has(id) || db.select({ id: schema.leagues.id }).from(schema.leagues).where(eq(schema.leagues.id, id)).get()) {
        set.status = 409; return { error: `League id ${id} already exists` };
      }
      seenIds.add(id);
      leaguePayloads.push({ ...l, id });
    }

    // Reject duplicate abbrevs (per league, case-insensitive) and a coach on two teams
    // (a coach owns one team per season) up front, before the tx can hit a PK collision.
    const seenManagers = new Map<string, string>();
    for (const lg of leaguePayloads) {
      const abbrevs = new Set<string>();
      for (const t of lg.teams ?? []) {
        const a = (t.teamAbbrev ?? '').trim().toLowerCase();
        if (a) {
          if (abbrevs.has(a)) { set.status = 400; return { error: `Duplicate team abbreviation "${a.toUpperCase()}" in league ${lg.name}` }; }
          abbrevs.add(a);
        }
        const u = (t.managerUsername ?? '').trim().toLowerCase();
        if (!u) continue;
        const prior = seenManagers.get(u);
        if (prior) { set.status = 400; return { error: `User "${u}" is assigned to more than one team (${prior}, ${lg.name}); a coach owns one team per season` }; }
        seenManagers.set(u, lg.name);
      }
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
    const leagueResults: { id: string; rulesetId: number; costFormat: string }[] = [];
    try {
      const seasonId = tx(() => {
        // One private ruleset instance per league (copied from the chosen ruleset, or
        // built from the legacy wizard fields). The league's cost_format comes from it.
        const instances = leaguePayloads.map(lg => createInstance(`S${seasonNumber} ${lg.name}`, {
          sourceId: lg.sourceRulesetId ?? lg.rulesetId ?? seasonRulesetId,
          overrides: lg.rules,
          legacy: { costFormat: lg.costFormat ?? seasonCostFormat, pointCap, teraCaptainSlots, rosterSize, rosterMin: minRosterSize, rosterMax: maxRosterSize },
          userId: parseInt(user.id),
        }));
        // seasons.point_cap / tera_captain_slots are deprecated mirrors (first league's rules).
        const row = db.insert(schema.seasons).values({
          seasonNumber,
          pointCap: instances[0]?.pointCap ?? pointCap,
          teraCaptainSlots: instances[0]?.teraCaptainSlots ?? teraCaptainSlots,
        }).returning().get();

        for (const [i, lg] of leaguePayloads.entries()) {
          const inst = instances[i]!;
          leagueResults.push({ id: lg.id, rulesetId: inst.id, costFormat: inst.costFormat });
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
            rosterSize: inst.rosterSize,
            minRosterSize: inst.rosterMin,
            maxRosterSize: inst.rosterMax,
            rulesetId: inst.id,
            costFormat: inst.costFormat,
            forfeitPolicy,
            format,
            playoffTeamCount,
          }).run();

          for (const t of lg.teams ?? []) {
            const teamName = (t.teamName ?? '').trim();
            const teamAbbrev = (t.teamAbbrev ?? '').trim();
            if (!teamName || !teamAbbrev) {
              throw new RulesetInputError(`Team in league ${lg.id} missing name/abbrev`);
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
            rulesets: leagueResults,
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
        leagues: leagueResults,
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
      if (err instanceof RulesetInputError) { set.status = 400; return { error: err.message }; }
      set.status = 500;
      return {
        error: err?.message ?? String(err),
        code: 'partial_provision_failure',
        teamsCreated,
        hint: 'Transaction rolled back. Inspect server logs and retry.',
      };
    }
  })

  // Season archive toggle

  .put('/api/seasons/:seasonId/archived', ({ params, body, user, set }) => {
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
      clearArchiveCache();
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

  // Archive ceremony
  // The "Archive Season" admin button. Wraps three things into one
  // transactional action:
  //   1. Set seasons.archived = 1 (writes now require ?force=1).
  //   2. Force every league in the season to phase=offseason. Once a season
  //      is archived no league should still report itself as in-progress.
  //
  // Awards are NOT minted here: they are admin-curated through the Awards
  // Sheet (suggest -> save drafts -> publish). Idempotent.
  .post('/api/admin/seasons/:seasonId/archive', ({ params, user, set }) => {
    const seasonId = parseInt(params.seasonId);
    if (!Number.isFinite(seasonId)) { set.status = 400; return { error: 'Invalid seasonId' }; }
    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).get();
    if (!season) { set.status = 404; return { error: 'Season not found' }; }

    const leagues = db.select().from(schema.leagues).where(eq(schema.leagues.seasonId, seasonId)).all();

    tx(() => {
      db.update(schema.seasons).set({ archived: true }).where(eq(schema.seasons.id, seasonId)).run();
      clearArchiveCache();
      for (const l of leagues) {
        if (l.phase !== 'offseason') {
          db.update(schema.leagues).set({ phase: 'offseason' }).where(eq(schema.leagues.id, l.id)).run();
        }
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
        }),
      }).run();
    });

    return {
      success: true,
      seasonId,
      seasonNumber: season.seasonNumber,
      leagues: leagues.length,
    };
  })

;
