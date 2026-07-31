/**
 * Admin league-membership control API.
 *
 * Lets staff sort coaches into the season's leagues *before the draft starts*:
 * add a late signup, drop a coach, or move a coach from one league to another.
 * Everything is gated by `isMembershipEditable` (predraft, or draft-not-started)
 * so we can never strand rosters / matches / standings.
 *
 * A coach's career record (W/L, K/D, championships) is keyed on `users.id`
 * across all of their teams — see `computeLifetimeStats`. So a MOVE just
 * relocates the team row (same `teams.id`, same `userId`) and the coach's
 * lifetime stats follow automatically; no stat migration is needed.
 */
import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, and, desc } from 'drizzle-orm';
import { requireStaff } from '../../lib/auth-guards';
import { tx } from '../../lib/tx';
import { isMembershipEditable, getLeague } from '../../lib/queries';
import { deleteTeamCascade, appendToDraftOrder, removeFromDraftOrder } from '../../lib/team-cascade';
import { checkTeamArchived } from '../../lib/archive-guard';
import { notifyUser } from '../../lib/notifications/notify';
import { computeLifetimeStats } from '../users';

/** True if `userId` already owns a team in `leagueId` (the one-team-per-user-
 *  per-league invariant the membership ops must preserve). */
function userHasTeamInLeague(userId: number, leagueId: string, exceptTeamId?: string): boolean {
  const row = db.select({ id: schema.teams.id })
    .from(schema.teams)
    .where(and(eq(schema.teams.leagueId, leagueId), eq(schema.teams.userId, userId)))
    .all()
    .find(t => t.id !== exceptTeamId);
  return !!row;
}

export const membershipRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })

  // Membership overview
  // The current (latest) season's leagues, each with its coaches, an editable
  // flag (+ reason when locked), and each coach's career record so the UI can
  // make plain that stats are coach-tied, not team-tied.

  .get('/api/admin/membership', () => {
    const season = db.select().from(schema.seasons)
      .orderBy(desc(schema.seasons.seasonNumber)).get();
    if (!season) return { seasonNumber: null, leagues: [] };

    const leagues = db.select().from(schema.leagues)
      .where(eq(schema.leagues.seasonId, season.id)).all();

    // Cache career lookups so a coach in (hypothetically) two leagues is only
    // computed once.
    const careerCache = new Map<number, ReturnType<typeof computeLifetimeStats>>();
    const careerFor = (userId: number) => {
      let c = careerCache.get(userId);
      if (!c) { c = computeLifetimeStats(userId); careerCache.set(userId, c); }
      return c;
    };

    const out = leagues
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(l => {
        const gate = isMembershipEditable(l.id);
        const teams = db.select().from(schema.teams)
          .where(eq(schema.teams.leagueId, l.id)).all();
        return {
          id: l.id,
          name: l.name,
          color: l.color,
          phase: l.phase,
          editable: gate.ok,
          lockReason: gate.ok ? null : gate.reason,
          teams: teams
            .sort((a, b) => a.teamName.localeCompare(b.teamName))
            .map(t => {
              const manager = t.userId != null
                ? db.select({ username: schema.users.username, displayName: schema.users.displayName })
                    .from(schema.users).where(eq(schema.users.id, t.userId)).get()
                : null;
              const career = t.userId != null ? careerFor(t.userId) : null;
              return {
                id: t.id,
                teamName: t.teamName,
                teamAbbrev: t.teamAbbrev,
                teamColor: t.teamColor,
                logoPath: t.logoPath,
                coachName: t.coachName,
                userId: t.userId,
                manager: manager
                  ? { username: manager.username, displayName: manager.displayName }
                  : null,
                career: career
                  ? {
                      seasonsPlayed: career.seasonsPlayed,
                      wins: career.totalRecord.wins,
                      losses: career.totalRecord.losses,
                      kills: career.careerKills,
                      deaths: career.careerDeaths,
                      championships: career.championships,
                    }
                  : null,
              };
            }),
        };
      });

    return { seasonNumber: season.seasonNumber, leagues: out };
  })

  // Add a coach to a league
  // Binds an EXISTING user to a new team in the league (never auto-creates a
  // user — that would fork a coach's identity and split their career stats).

  .post('/api/admin/membership/add', ({ body, user, set }) => {
    const { leagueId, userId, teamName, teamAbbrev, teamColor, coachName } = body as {
      leagueId?: string; userId?: number;
      teamName?: string; teamAbbrev?: string; teamColor?: string; coachName?: string;
    };
    if (!leagueId || typeof userId !== 'number' || !teamName?.trim() || !teamAbbrev?.trim()) {
      set.status = 400;
      return { error: 'leagueId, userId, teamName and teamAbbrev are required' };
    }

    const gate = isMembershipEditable(leagueId);
    if (!gate.ok) { set.status = 409; return { error: gate.reason, code: gate.code }; }

    const account = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!account) { set.status = 404; return { error: `User ${userId} not found` }; }
    if (!account.active) { set.status = 400; return { error: `User ${account.username} is deactivated` }; }

    if (userHasTeamInLeague(userId, leagueId)) {
      set.status = 409;
      return { error: `${account.username} already has a team in this league`, code: 'already_in_league' };
    }

    const teamId = `${leagueId}-${teamAbbrev.trim().toLowerCase()}`;
    if (db.select({ id: schema.teams.id }).from(schema.teams).where(eq(schema.teams.id, teamId)).get()) {
      set.status = 409;
      return { error: `Team ${teamId} already exists`, code: 'team_id_taken' };
    }

    const resolvedCoach = coachName?.trim() || account.displayName || account.username;

    tx(() => {
      db.insert(schema.teams).values({
        id: teamId,
        leagueId,
        userId,
        coachName: resolvedCoach,
        teamName: teamName.trim(),
        teamAbbrev: teamAbbrev.trim().toUpperCase(),
        teamColor: teamColor ?? '#888888',
      }).run();
      // Keep the draft order consistent if one's already been set for the league.
      appendToDraftOrder(leagueId, teamId);
      db.insert(schema.activityLog).values({
        type: 'coach_added',
        category: 'admin',
        actor: user.username,
        leagueId,
        description: `Added coach ${account.username} (${teamName.trim()}) to league`,
        metadata: JSON.stringify({ teamId, userId, leagueId }),
      }).run();
    });

    return { id: teamId };
  })

  // Move a coach between leagues
  // Relocates the team row in place (same id / userId / cosmetics) so career
  // stats follow the coach. Reconciles draft order on both leagues and clears
  // the team's draft queue (the destination's pool/format may differ).

  .post('/api/admin/membership/move', ({ body, user, set }) => {
    const { teamId, toLeagueId } = body as { teamId?: string; toLeagueId?: string };
    if (!teamId || !toLeagueId) {
      set.status = 400; return { error: 'teamId and toLeagueId are required' };
    }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    const fromLeagueId = team.leagueId;
    if (fromLeagueId === toLeagueId) {
      set.status = 400; return { error: 'Team is already in that league' };
    }
    if (!getLeague(toLeagueId)) { set.status = 404; return { error: 'Destination league not found' }; }

    const fromGate = isMembershipEditable(fromLeagueId);
    if (!fromGate.ok) { set.status = 409; return { error: `Source league: ${fromGate.reason}`, code: fromGate.code }; }
    const toGate = isMembershipEditable(toLeagueId);
    if (!toGate.ok) { set.status = 409; return { error: `Destination league: ${toGate.reason}`, code: toGate.code }; }

    if (team.userId != null && userHasTeamInLeague(team.userId, toLeagueId)) {
      set.status = 409;
      return { error: 'That coach already has a team in the destination league', code: 'already_in_league' };
    }

    tx(() => {
      removeFromDraftOrder(fromLeagueId, teamId);
      appendToDraftOrder(toLeagueId, teamId);
      db.delete(schema.draftQueue).where(eq(schema.draftQueue.teamId, teamId)).run();
      db.update(schema.teams)
        .set({ leagueId: toLeagueId, captainsLocked: false })
        .where(eq(schema.teams.id, teamId)).run();
      db.insert(schema.activityLog).values({
        type: 'coach_moved',
        category: 'admin',
        actor: user.username,
        leagueId: toLeagueId,
        description: `Moved ${team.teamName} (${team.coachName}) from ${fromLeagueId} to ${toLeagueId}`,
        metadata: JSON.stringify({ teamId, userId: team.userId, fromLeagueId, toLeagueId }),
      }).run();
    });

    return { success: true };
  })

  // Replace a team's coach
  // Swaps the human (teams.userId + coachName) while keeping the SAME team row,
  // so rosters, draft picks, completed results, standings and trades all stay
  // intact (everything competitive is keyed on teams.id, not userId). This is a
  // deliberate override of the membership lock — safe because the teamId never
  // changes — so it works mid-season too. Only an archived (finalized) season is
  // off-limits. NOTE: career stats are coach-tied, so the new coach inherits this
  // season's already-played W/L + K/D for this team (intended; the UI says so).

  .post('/api/admin/membership/replace-coach', ({ body, user, set }) => {
    const { teamId, newUserId, coachName } = body as {
      teamId?: string; newUserId?: number; coachName?: string;
    };
    if (!teamId || typeof newUserId !== 'number') {
      set.status = 400;
      return { error: 'teamId and newUserId are required' };
    }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

    // Never reshuffle a finalized/archived season.
    const archived = checkTeamArchived(teamId);
    if (archived) { set.status = 409; return archived; }

    const account = db.select().from(schema.users).where(eq(schema.users.id, newUserId)).get();
    if (!account) { set.status = 404; return { error: `User ${newUserId} not found` }; }
    if (!account.active) { set.status = 400; return { error: `User ${account.username} is deactivated` }; }

    if (userHasTeamInLeague(newUserId, team.leagueId, team.id)) {
      set.status = 409;
      return { error: `${account.username} already has a team in this league`, code: 'already_in_league' };
    }

    const fromUserId = team.userId;
    const resolvedCoach = coachName?.trim() || account.displayName || account.username;
    // draftQueue only exists while a league is still drafting; in regular/playoffs
    // there's nothing to clear.
    const inDraftWindow = team.leagueId
      ? (() => { const l = getLeague(team.leagueId); return l?.phase === 'predraft' || l?.phase === 'draft'; })()
      : false;

    tx(() => {
      db.update(schema.teams)
        .set({ userId: newUserId, coachName: resolvedCoach })
        .where(eq(schema.teams.id, teamId)).run();
      if (inDraftWindow) {
        // The previous coach's auto-pick prefs shouldn't carry over.
        db.delete(schema.draftQueue).where(eq(schema.draftQueue.teamId, teamId)).run();
      }
      db.insert(schema.activityLog).values({
        type: 'coach_replaced',
        category: 'admin',
        actor: user.username,
        leagueId: team.leagueId,
        description: `Replaced coach of ${team.teamName} with ${account.username}`,
        metadata: JSON.stringify({ teamId, fromUserId, toUserId: newUserId, leagueId: team.leagueId }),
      }).run();
    });

    // Best-effort notifications — never block the swap on these.
    notifyUser(newUserId, {
      type: 'system',
      title: `You're now the coach of ${team.teamName}`,
      metadata: { teamId, leagueId: team.leagueId },
    });
    if (fromUserId != null && fromUserId !== newUserId) {
      notifyUser(fromUserId, {
        type: 'system',
        title: `You've been removed as coach of ${team.teamName}`,
        metadata: { teamId, leagueId: team.leagueId },
      });
    }

    return { success: true };
  })

  // Remove a coach from a league
  // Deletes the team (in-window there is no competitive data to lose). The
  // user account is untouched — only their participation in this league.

  .delete('/api/admin/membership/team/:teamId', ({ params, user, set }) => {
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

    const gate = isMembershipEditable(team.leagueId);
    if (!gate.ok) { set.status = 409; return { error: gate.reason, code: gate.code }; }

    tx(() => {
      deleteTeamCascade(params.teamId, team.leagueId);
      db.insert(schema.activityLog).values({
        type: 'coach_removed',
        category: 'admin',
        actor: user.username,
        leagueId: team.leagueId,
        description: `Removed coach ${team.coachName} (${team.teamName}) from league`,
        metadata: JSON.stringify({ teamId: params.teamId, userId: team.userId, leagueId: team.leagueId }),
      }).run();
    });

    return { success: true };
  })

;
