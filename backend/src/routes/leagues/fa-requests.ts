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
import { applyFaPickup } from '../../lib/free-agency';
import { refreshUserMap } from '../../lib/ps-bot';
import { notifyUser } from '../../lib/notifications/notify';

interface FaRequestRow {
  id: number;
  leagueId: string;
  week: number;
  teamId: string;
  status: string;
  pickups: string;
  drops: string;
  requestedBy: string | null;
  requestedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  rejectReason: string | null;
}

const parseList = (json: string): string[] => {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
};

const shape = (r: FaRequestRow) => ({
  id: r.id,
  leagueId: r.leagueId,
  week: r.week,
  teamId: r.teamId,
  status: r.status,
  pickups: parseList(r.pickups),
  drops: parseList(r.drops),
  requestedBy: r.requestedBy,
  requestedAt: r.requestedAt,
  resolvedBy: r.resolvedBy,
  resolvedAt: r.resolvedAt,
  rejectReason: r.rejectReason,
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

  // ─── List FA requests for a league ───────────────────────────────────────
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

  // ─── Approve a pending request → apply it ────────────────────────────────
  .post('/api/fa-requests/:id/approve', ({ params, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Staff only' }; }

    const id = parseInt(params.id);
    const req = db.select().from(schema.faRequests).where(eq(schema.faRequests.id, id)).get() as FaRequestRow | undefined;
    if (!req) { set.status = 404; return { error: 'FA request not found' }; }
    if (req.status !== 'pending') { set.status = 409; return { error: `Request already ${req.status}`, code: 'fa_request_resolved' }; }

    const result = applyFaPickup({
      leagueId: req.leagueId,
      teamId: req.teamId,
      pickupNames: parseList(req.pickups),
      dropNames: parseList(req.drops),
      actorUsername: req.requestedBy ?? user.username,
      dryRun: false,
    });
    if (!result.ok) {
      // Leave the request pending so the admin can see why and reject/retry.
      set.status = result.status;
      return { error: result.error, code: result.code };
    }

    db.update(schema.faRequests).set({
      status: 'approved',
      resolvedBy: user.username,
      resolvedAt: new Date().toISOString(),
    }).where(eq(schema.faRequests.id, id)).run();

    try { refreshUserMap(); } catch { /* best-effort */ }

    const picks = parseList(req.pickups).join(', ');
    notifyRequester(req.teamId, req.leagueId, {
      title: 'Free agent pickup approved',
      body: `Your pickup of ${picks} was approved.`,
    });

    return { success: true, ...result };
  })

  // ─── Reject a pending request ────────────────────────────────────────────
  .post('/api/fa-requests/:id/reject', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Staff only' }; }

    const id = parseInt(params.id);
    const req = db.select().from(schema.faRequests).where(eq(schema.faRequests.id, id)).get() as FaRequestRow | undefined;
    if (!req) { set.status = 404; return { error: 'FA request not found' }; }
    if (req.status !== 'pending') { set.status = 409; return { error: `Request already ${req.status}`, code: 'fa_request_resolved' }; }

    const reason = ((body as { reason?: string } | null)?.reason ?? '').trim() || null;

    db.update(schema.faRequests).set({
      status: 'rejected',
      resolvedBy: user.username,
      resolvedAt: new Date().toISOString(),
      rejectReason: reason,
    }).where(eq(schema.faRequests.id, id)).run();

    db.insert(schema.activityLog).values({
      type: 'fa_rejected', category: 'fa', actor: user.username, leagueId: req.leagueId,
      description: `FA request rejected for team ${req.teamId}${reason ? `: ${reason}` : ''}`,
      metadata: JSON.stringify({ requestId: id, teamId: req.teamId }),
    }).run();

    const picks = parseList(req.pickups).join(', ');
    notifyRequester(req.teamId, req.leagueId, {
      title: 'Free agent pickup rejected',
      body: `Your pickup of ${picks} was rejected${reason ? `: ${reason}` : '.'}`,
    });

    return { success: true };
  });
