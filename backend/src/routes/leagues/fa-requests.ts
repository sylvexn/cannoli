/**
 * Free-agency approval queue endpoints (feedback #42).
 *
 * Non-staff FA pickups are parked as `pending` fa_requests rows (see the
 * pickup endpoint in teams.ts). Staff list the queue and approve (apply) or
 * reject each request here. Approval re-runs the full pickup logic via
 * applyFaPickup, so a request that became illegal since submission (mon taken,
 * cap changed, deadline passed) fails cleanly instead of applying a bad roster.
 */
import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, and, desc } from 'drizzle-orm';
import { isStaff } from '../../lib/auth';
import { applyFaPickup, applyTeraCaptains, type TeraCaptainInput } from '../../lib/free-agency';
import { refreshUserMap } from '../../lib/ps-bot';
import { notifyUser } from '../../lib/notifications/notify';
import { resolveEffectiveWeek } from '../../lib/scheduled-transactions';

interface FaRequestRow {
  id: number;
  leagueId: string;
  week: number;
  teamId: string;
  status: string;
  requestType: string;
  pickups: string;
  drops: string;
  teraChanges: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  rejectReason: string | null;
  effectiveWeek: number | null;
  appliedAt: string | null;
}

const parseList = (json: string): string[] => {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
};

const parseTera = (json: string | null): TeraCaptainInput[] => {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
};

const shape = (r: FaRequestRow) => ({
  id: r.id,
  leagueId: r.leagueId,
  week: r.week,
  teamId: r.teamId,
  status: r.status,
  requestType: (r.requestType ?? 'pickup') as 'pickup' | 'tera_change',
  pickups: parseList(r.pickups),
  drops: parseList(r.drops),
  teraChanges: r.teraChanges ? parseTera(r.teraChanges) : null,
  requestedBy: r.requestedBy,
  requestedAt: r.requestedAt,
  resolvedBy: r.resolvedBy,
  resolvedAt: r.resolvedAt,
  rejectReason: r.rejectReason,
  effectiveWeek: r.effectiveWeek,
  appliedAt: r.appliedAt,
});

/** Notify the requesting team's owner that their FA was approved/rejected. */
function notifyRequester(teamId: string, leagueId: string, msg: { title: string; body: string }) {
  try {
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    if (team?.userId == null) return;
    notifyUser(team.userId, {
      type: 'system',
      title: msg.title,
      body: msg.body,
      link: `/league/${leagueId}/market/free-agents`,
    });
  } catch { /* best-effort */ }
}

export const faRequestRoutes = new Elysia()

  // List FA requests for a league
  // Auth'd league members can read the queue (transparency); the admin UI
  // filters to pending, the user's FA page to their own team.
  .get('/api/leagues/:leagueId/fa-requests', ({ params, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const rows = db.select().from(schema.faRequests)
      .where(eq(schema.faRequests.leagueId, params.leagueId))
      .orderBy(desc(schema.faRequests.id))
      .all() as FaRequestRow[];
    return rows.map(shape);
  })

  // Approve a pending request → apply it
  .post('/api/fa-requests/:id/approve', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Staff only' }; }

    const id = parseInt(params.id);
    const req = db.select().from(schema.faRequests).where(eq(schema.faRequests.id, id)).get() as FaRequestRow | undefined;
    if (!req) { set.status = 404; return { error: 'FA request not found' }; }
    if (req.status !== 'pending') { set.status = 409; return { error: `Request already ${req.status}`, code: 'fa_request_resolved' }; }

    // Which league week this request takes effect in. Default = NEXT week, so
    // approving mid-week never changes the roster a team is already playing
    // with. Clamped to [currentWeek, totalWeeks] — the UI enforces this, but a
    // direct API caller could otherwise stamp a negative / fractional / past week.
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, req.leagueId)).get();
    const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;
    const { effectiveWeek: bodyEffectiveWeek } = (body || {}) as { effectiveWeek?: number };
    const effectiveWeek = resolveEffectiveWeek({
      requested: bodyEffectiveWeek, league, fallbackWeek: req.week,
    });
    // A future effective week means this is SCHEDULED — approved now, applied by
    // applyDueTransactions() once the league reaches that week. Pickups are
    // still dry-run validated up front so the admin gets an immediate answer;
    // tera changes are validated when they actually apply.
    const deferred = (league?.currentWeek ?? 0) < effectiveWeek;
    const stamp = new Date().toISOString();

    // Tera-change request (feedback #51)
    // Re-validate + apply via the shared tera applier. A request that became
    // illegal since submission (tier-list edit, cap change) fails cleanly and is
    // left pending so the admin can reject/retry.
    if (req.requestType === 'tera_change') {
      if (deferred) {
        db.update(schema.faRequests).set({
          status: 'approved', resolvedBy: user.username, resolvedAt: stamp, effectiveWeek, appliedAt: null,
        }).where(eq(schema.faRequests.id, id)).run();
        notifyRequester(req.teamId, req.leagueId, {
          title: 'Tera change approved — scheduled',
          body: `Your tera captain change was approved and takes effect at the start of Week ${effectiveWeek}.`,
        });
        return { success: true, effectiveWeek, scheduled: true };
      }

      const captains = parseTera(req.teraChanges);
      const teraResult = applyTeraCaptains(req.teamId, captains, req.requestedBy ?? user.username, effectiveWeek);
      if (!teraResult.ok) {
        set.status = teraResult.status;
        return { error: teraResult.error, code: teraResult.code };
      }

      db.update(schema.faRequests).set({
        status: 'approved',
        resolvedBy: user.username,
        resolvedAt: stamp,
        effectiveWeek,
        appliedAt: stamp,
      }).where(eq(schema.faRequests.id, id)).run();

      try { refreshUserMap(); } catch { /* best-effort */ }

      const names = captains.map(c => c.pokemonName).join(', ');
      notifyRequester(req.teamId, req.leagueId, {
        title: 'Tera change approved',
        body: `Your tera captain change (${names}) was approved.`,
      });

      return { success: true };
    }

    // Deferred approvals dry-run so the admin still learns immediately if the
    // pickup is illegal; the real mutation happens in the sweep. It is
    // re-validated then too, since rosters can shift before the week arrives.
    const result = applyFaPickup({
      leagueId: req.leagueId,
      teamId: req.teamId,
      pickupNames: parseList(req.pickups),
      dropNames: parseList(req.drops),
      actorUsername: req.requestedBy ?? user.username,
      dryRun: deferred,
      effectiveWeek,
    });
    if (!result.ok) {
      // Leave the request pending so the admin can see why and reject/retry.
      set.status = result.status;
      return { error: result.error, code: result.code };
    }

    db.update(schema.faRequests).set({
      status: 'approved',
      resolvedBy: user.username,
      resolvedAt: stamp,
      effectiveWeek,
      appliedAt: deferred ? null : stamp,
    }).where(eq(schema.faRequests.id, id)).run();

    try { refreshUserMap(); } catch { /* best-effort */ }

    const picks = parseList(req.pickups).join(', ');
    notifyRequester(req.teamId, req.leagueId, deferred ? {
      title: 'Free agent pickup approved — scheduled',
      body: `Your pickup of ${picks} was approved and takes effect at the start of Week ${effectiveWeek}. Your roster is unchanged until then.`,
    } : {
      title: 'Free agent pickup approved',
      body: `Your pickup of ${picks} was approved.`,
    });

    return { success: true, effectiveWeek, scheduled: deferred, ...result };
  })

  // Reject a pending request
  .post('/api/fa-requests/:id/reject', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Staff only' }; }

    const id = parseInt(params.id);
    const req = db.select().from(schema.faRequests).where(eq(schema.faRequests.id, id)).get() as FaRequestRow | undefined;
    if (!req) { set.status = 404; return { error: 'FA request not found' }; }
    if (req.status !== 'pending') { set.status = 409; return { error: `Request already ${req.status}`, code: 'fa_request_resolved' }; }

    const reason = ((body as { reason?: string } | null)?.reason ?? '').trim() || null;
    const isTera = req.requestType === 'tera_change';

    db.update(schema.faRequests).set({
      status: 'rejected',
      resolvedBy: user.username,
      resolvedAt: new Date().toISOString(),
      rejectReason: reason,
    }).where(eq(schema.faRequests.id, id)).run();

    db.insert(schema.activityLog).values({
      type: isTera ? 'tera_change_rejected' : 'fa_rejected',
      category: isTera ? 'team' : 'fa', actor: user.username, leagueId: req.leagueId,
      description: `${isTera ? 'Tera change' : 'FA'} request rejected for team ${req.teamId}${reason ? `: ${reason}` : ''}`,
      metadata: JSON.stringify({ requestId: id, teamId: req.teamId }),
    }).run();

    if (isTera) {
      const names = parseTera(req.teraChanges).map(c => c.pokemonName).join(', ');
      notifyRequester(req.teamId, req.leagueId, {
        title: 'Tera change rejected',
        body: `Your tera captain change (${names}) was rejected${reason ? `: ${reason}` : '.'}`,
      });
      return { success: true };
    }

    const picks = parseList(req.pickups).join(', ');
    notifyRequester(req.teamId, req.leagueId, {
      title: 'Free agent pickup rejected',
      body: `Your pickup of ${picks} was rejected${reason ? `: ${reason}` : '.'}`,
    });

    return { success: true };
  });
