import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import {
  getDraftSnapshot, startDraft, executePick, executeAutoPick, skipPick,
  undoLastPick, getAutoPick, generateSnakeOrder,
} from '../lib/draft-engine';
import type { PickErrorCode } from '../lib/draft-engine';
import { isStaff } from '../lib/auth';

// ─── Presence tracking per league ──────────────────────────────────────────

interface DraftPresence {
  teamId: string | null; // null = spectator/admin
  username: string;
  role: 'dev' | 'admin' | 'user' | 'spectator';
  /** User ID from session — used for league-isolation auth on WS messages. */
  userId: number | null;
}

const leaguePresence = new Map<string, Map</* ws id */ object, DraftPresence>>();

// ─── Idempotency cache ─────────────────────────────────────────────────────
// Per-league ring buffer of recent (clientRequestId → result) pairs. Lets a
// flaky client safely re-send a pick after a disconnect without double-picking.
// Bounded so a misbehaving client can't OOM us.
const IDEMPOTENCY_LIMIT = 64;
type IdempotentResult = {
  ok: true;
  pick: { teamId: string; pokemonName: string; tier: number; pickNumber: number };
} | {
  ok: false;
  error: string;
  code?: PickErrorCode;
};
const idempotencyByLeague = new Map<string, Map<string, IdempotentResult>>();

function recordIdempotent(leagueId: string, requestId: string, result: IdempotentResult) {
  let map = idempotencyByLeague.get(leagueId);
  if (!map) { map = new Map(); idempotencyByLeague.set(leagueId, map); }
  map.set(requestId, result);
  // Trim oldest entries (Map preserves insertion order).
  while (map.size > IDEMPOTENCY_LIMIT) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

function lookupIdempotent(leagueId: string, requestId: string): IdempotentResult | undefined {
  return idempotencyByLeague.get(leagueId)?.get(requestId);
}

// Store a reference to a ws instance for server-side broadcasting from HTTP endpoints
let broadcastWs: { publish: (topic: string, data: string) => void } | null = null;

/**
 * Push the current draft snapshot to every subscriber on this league's WS topic.
 */
function broadcastDraftState(leagueId: string) {
  if (!broadcastWs) return;
  const snapshot = getDraftSnapshot(leagueId);
  if (!snapshot) return;
  broadcastWs.publish(`draft:${leagueId}`, JSON.stringify({ type: 'draft_state', data: snapshot }));
}

// ─── Server-side timer scheduler ───────────────────────────────────────────
// One global tick at 1Hz; checks every active draft's deadline and fires
// auto-pick when the timer hits zero. Cheaper than per-league setTimeouts and
// survives pick/pause/resume transitions without leaks.

let timerInterval: ReturnType<typeof setInterval> | null = null;

function tickTimers() {
  const states = db.select().from(schema.draftState).all();
  const now = Date.now();
  for (const s of states) {
    if (s.status !== 'in_progress' || !s.timerStartedAt) continue;
    const deadline = new Date(s.timerStartedAt).getTime() + s.timerDuration * 1000;
    if (now < deadline) continue;

    // Timer expired — fire auto-pick. If no valid pick exists, skip.
    const league = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, s.leagueId)).get();
    if (!league?.draftOrder) continue;
    const teamOrder: string[] = JSON.parse(league.draftOrder);
    const snakeOrder = generateSnakeOrder(teamOrder, 10);
    const slot = snakeOrder[s.currentPickIndex];
    if (!slot) continue;

    const season = db.select().from(schema.seasons)
      .where(eq(schema.seasons.id, league.seasonId)).get();
    if (!season) continue;

    const auto = getAutoPick(slot.teamId, s.leagueId, season.pointCap);
    if (auto) {
      const result = executePick(s.leagueId, auto.name, slot.teamId, 'auto-pick (timer)');
      if (result.success) {
        broadcastDraftState(s.leagueId);
        broadcastWs?.publish(`draft:${s.leagueId}`, JSON.stringify({
          type: 'auto_pick',
          data: { pick: { ...result.pick, playerId: result.pick.teamId }, reason: 'timer_expired' },
        }));
      } else {
        skipPick(s.leagueId, 'auto-skip (timer)', { force: true });
        broadcastDraftState(s.leagueId);
      }
    } else {
      skipPick(s.leagueId, 'auto-skip (no valid pick)', { force: true });
      broadcastDraftState(s.leagueId);
    }
  }
}

function ensureTimerInterval() {
  if (timerInterval) return;
  timerInterval = setInterval(tickTimers, 1000);
}

// Chat rate limiting: track last 3 message timestamps per ws
const chatRateLimit = new WeakMap<object, number[]>();

function getPresenceList(leagueId: string) {
  const presence = leaguePresence.get(leagueId);
  if (!presence) return { players: [] as { teamId: string; username: string }[], spectators: [] as { username: string; role: string }[] };

  const players: { teamId: string; username: string }[] = [];
  const spectators: { username: string; role: string }[] = [];

  for (const [, p] of presence) {
    if (p.teamId) {
      players.push({ teamId: p.teamId, username: p.username });
    } else {
      spectators.push({ username: p.username, role: p.role });
    }
  }
  return { players, spectators };
}

/**
 * Verify the connecting user is authorized to subscribe to this league's draft.
 * Returns the team id they manage in this league (null for staff/spectators).
 * Anonymous users get rejected; authed users with no team in this league are
 * allowed in as read-only spectators.
 */
function canSubscribeToLeague(
  user: { id: string; role: string } | null,
  leagueId: string,
): { allow: boolean; teamId: string | null; reason?: string } {
  if (!user) return { allow: false, teamId: null, reason: 'not_authenticated' };
  if (isStaff(user)) return { allow: true, teamId: null };
  const team = db.select({ id: schema.teams.id })
    .from(schema.teams)
    .where(and(
      eq(schema.teams.leagueId, leagueId),
      eq(schema.teams.userId, parseInt(user.id)),
    ))
    .get();
  if (team) return { allow: true, teamId: team.id };
  return { allow: true, teamId: null };
}

export const draftRoutes = new Elysia()
  .onStart(() => { ensureTimerInterval(); })

  .get('/api/leagues/:leagueId/draft/state', ({ params }) => {
    const snapshot = getDraftSnapshot(params.leagueId);
    if (!snapshot) return { status: 'not_started' as const, leagueId: params.leagueId };
    return snapshot;
  })

  .post('/api/leagues/:leagueId/draft/start', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { timerDuration } = (body as { timerDuration?: number }) ?? {};
    const result = startDraft(params.leagueId, timerDuration ?? 120, user.username);
    if (!result.success) { set.status = 400; return { error: result.error }; }
    broadcastDraftState(params.leagueId);
    return getDraftSnapshot(params.leagueId);
  })

  .post('/api/leagues/:leagueId/draft/pick', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const { pokemonName, clientRequestId } = body as { pokemonName: string; clientRequestId?: string };
    if (!pokemonName) { set.status = 400; return { error: 'pokemonName required' }; }

    // Idempotency replay — return cached result without re-executing.
    if (clientRequestId) {
      const cached = lookupIdempotent(params.leagueId, clientRequestId);
      if (cached) {
        if (!cached.ok) { set.status = 422; return { error: cached.error, code: cached.code, idempotent: true }; }
        return { success: true, pick: cached.pick, idempotent: true };
      }
    }

    const team = db.select().from(schema.teams)
      .where(and(eq(schema.teams.leagueId, params.leagueId), eq(schema.teams.userId, parseInt(user.id))))
      .get();

    const overrideTeamId = (isStaff(user) && (body as any).teamId) ? (body as any).teamId : null;
    const teamId = overrideTeamId ?? team?.id;
    if (!teamId) { set.status = 403; return { error: "You don't have a team in this league" }; }

    const actor = overrideTeamId ? `${user.username} (override → ${overrideTeamId})` : user.username;
    const result = executePick(
      params.leagueId, pokemonName, teamId, actor,
      overrideTeamId ? { skipTurnCheck: true } : undefined,
    );
    if (!result.success) {
      if (clientRequestId) recordIdempotent(params.leagueId, clientRequestId, { ok: false, error: result.error, code: result.code });
      set.status = 422;
      return { error: result.error, code: result.code };
    }

    if (clientRequestId) recordIdempotent(params.leagueId, clientRequestId, { ok: true, pick: result.pick });

    if (overrideTeamId) {
      db.insert(schema.activityLog).values({
        type: 'draft_pick_override',
        category: 'admin',
        actor: user.username,
        leagueId: params.leagueId,
        description: `Staff override: ${user.username} picked ${pokemonName} on behalf of ${overrideTeamId}`,
        metadata: JSON.stringify({ teamId: overrideTeamId, pokemonName }),
      }).run();
    }

    broadcastDraftState(params.leagueId);
    broadcastWs?.publish(`draft:${params.leagueId}`, JSON.stringify({
      type: 'pick_made',
      data: { pick: { ...result.pick, playerId: result.pick.teamId }, snapshot: getDraftSnapshot(params.leagueId) },
    }));

    return result;
  })

  // ─── Staff override: force a pick on behalf of any team ─────────────
  .post('/api/leagues/:leagueId/draft/force-pick', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { teamId, pokemonName } = body as { teamId: string; pokemonName: string };
    if (!teamId || !pokemonName) { set.status = 400; return { error: 'teamId and pokemonName required' }; }

    const result = executePick(
      params.leagueId, pokemonName, teamId,
      `${user.username} (force-pick)`,
      { skipTurnCheck: true },
    );
    if (!result.success) { set.status = 422; return { error: result.error, code: result.code }; }

    db.insert(schema.activityLog).values({
      type: 'draft_force_pick',
      category: 'admin',
      actor: user.username,
      leagueId: params.leagueId,
      description: `Force-picked ${pokemonName} for ${teamId}`,
      metadata: JSON.stringify({ teamId, pokemonName }),
    }).run();

    broadcastDraftState(params.leagueId);
    return result;
  })

  // ─── Staff override: undo last pick ─────────────────────────────────
  .post('/api/leagues/:leagueId/draft/undo', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const result = undoLastPick(params.leagueId, user.username);
    if (!result.success) { set.status = 400; return { error: result.error }; }
    broadcastDraftState(params.leagueId);
    return result;
  })

  .post('/api/leagues/:leagueId/draft/pause', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const state = db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, params.leagueId)).get();
    if (!state || state.status !== 'in_progress') { set.status = 400; return { error: 'Draft is not in progress' }; }
    db.update(schema.draftState).set({ status: 'paused', timerStartedAt: null }).where(eq(schema.draftState.leagueId, params.leagueId)).run();

    db.insert(schema.activityLog).values({
      type: 'draft_paused',
      category: 'draft',
      actor: user.username,
      leagueId: params.leagueId,
      description: `Draft paused`,
      metadata: JSON.stringify({}),
    }).run();

    broadcastDraftState(params.leagueId);
    return { success: true };
  })

  .post('/api/leagues/:leagueId/draft/resume', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const state = db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, params.leagueId)).get();
    if (!state || state.status !== 'paused') { set.status = 400; return { error: 'Draft is not paused' }; }
    db.update(schema.draftState).set({ status: 'in_progress', timerStartedAt: new Date().toISOString() }).where(eq(schema.draftState.leagueId, params.leagueId)).run();

    db.insert(schema.activityLog).values({
      type: 'draft_resumed',
      category: 'draft',
      actor: user.username,
      leagueId: params.leagueId,
      description: `Draft resumed`,
      metadata: JSON.stringify({}),
    }).run();

    broadcastDraftState(params.leagueId);
    return getDraftSnapshot(params.leagueId);
  })

  .post('/api/leagues/:leagueId/draft/auto-pick', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    let result;
    try {
      result = executeAutoPick(params.leagueId, user.username);
    } catch (e) {
      set.status = 400;
      return { error: (e as Error).message };
    }
    if (!result) { set.status = 400; return { error: 'Cannot auto-pick' }; }

    broadcastDraftState(params.leagueId);
    return result;
  })

  .post('/api/leagues/:leagueId/draft/skip', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    // Force-skip the current turn even if we're not in the post-expiry paused state.
    const result = skipPick(params.leagueId, user.username, { force: true });
    if (!result.success) { set.status = 400; return { error: (result as any).error }; }

    db.insert(schema.activityLog).values({
      type: 'draft_skip_override',
      category: 'admin',
      actor: user.username,
      leagueId: params.leagueId,
      description: `Staff skipped current pick`,
      metadata: JSON.stringify({}),
    }).run();

    broadcastDraftState(params.leagueId);
    return result;
  })

  // ─── Draft WebSocket ──────────────────────────────────────────────

  .ws('/ws/draft/:leagueId', {
    open(ws) {
      broadcastWs = ws; // Keep a ws ref for HTTP endpoint broadcasting
      const leagueId = (ws.data as any).params.leagueId;
      const user = (ws.data as any).user as { id: string; role: string } | null;

      // League isolation: must be staff or have a team in this league.
      // Anonymous connections are rejected outright.
      const auth = canSubscribeToLeague(user, leagueId);
      if (!auth.allow) {
        ws.send(JSON.stringify({ type: 'error', error: auth.reason ?? 'forbidden' }));
        ws.close();
        return;
      }
      (ws.data as any).draftAuth = { teamId: auth.teamId, userId: user ? parseInt(user.id) : null };

      ws.subscribe(`draft:${leagueId}`);
      const snapshot = getDraftSnapshot(leagueId);
      ws.send(JSON.stringify({ type: 'draft_state', data: snapshot ?? { status: 'not_started', leagueId } }));
      ws.send(JSON.stringify({ type: 'presence', data: getPresenceList(leagueId) }));
    },
    message(ws, message) {
      try {
        const msg = typeof message === 'string' ? JSON.parse(message) : message;
        const leagueId = (ws.data as any).params.leagueId;
        const sessionUser = (ws.data as any).user as { id: string; role: string; username?: string } | null;
        const auth = (ws.data as any).draftAuth as { teamId: string | null; userId: number | null } | undefined;

        if (msg.type === 'identify') {
          const { teamId, username, role } = msg;
          if (!username) return;

          // Reject claimed teamIds that don't match the authed session's team
          // (staff can spectate as themselves; their teamId is always null).
          if (teamId && !isStaff(sessionUser) && auth?.teamId !== teamId) {
            ws.send(JSON.stringify({ type: 'error', error: 'team_mismatch' }));
            return;
          }

          if (!leaguePresence.has(leagueId)) leaguePresence.set(leagueId, new Map());
          leaguePresence.get(leagueId)!.set(ws, {
            teamId: teamId || null,
            username,
            role: role || 'spectator',
            userId: auth?.userId ?? null,
          });

          const presenceMsg = JSON.stringify({ type: 'presence', data: getPresenceList(leagueId) });
          ws.publish(`draft:${leagueId}`, presenceMsg);
          ws.send(presenceMsg);
          return;
        }

        if (msg.type === 'pick') {
          const { pokemonName, teamId, username, clientRequestId } = msg;
          if (!pokemonName || !teamId) {
            ws.send(JSON.stringify({ type: 'error', error: 'pokemonName and teamId required', clientRequestId }));
            return;
          }

          // League-isolation auth: a non-staff user can only pick on their own team.
          if (!isStaff(sessionUser) && auth?.teamId !== teamId) {
            ws.send(JSON.stringify({ type: 'error', error: 'team_mismatch', clientRequestId }));
            return;
          }

          // Idempotency replay
          if (clientRequestId) {
            const cached = lookupIdempotent(leagueId, clientRequestId);
            if (cached) {
              if (cached.ok) {
                ws.send(JSON.stringify({
                  type: 'pick_made',
                  data: { pick: { ...cached.pick, playerId: cached.pick.teamId }, snapshot: getDraftSnapshot(leagueId) },
                  clientRequestId,
                  idempotent: true,
                }));
              } else {
                ws.send(JSON.stringify({ type: 'error', error: cached.error, code: cached.code, clientRequestId, idempotent: true }));
              }
              return;
            }
          }

          const result = executePick(leagueId, pokemonName, teamId, username || teamId);
          if (!result.success) {
            if (clientRequestId) recordIdempotent(leagueId, clientRequestId, { ok: false, error: result.error, code: result.code });
            ws.send(JSON.stringify({ type: 'error', error: result.error, code: result.code, clientRequestId }));
            return;
          }
          if (clientRequestId) recordIdempotent(leagueId, clientRequestId, { ok: true, pick: result.pick });

          const snapshot = getDraftSnapshot(leagueId);
          const payload = JSON.stringify({
            type: 'pick_made',
            data: { pick: { ...result.pick, playerId: result.pick.teamId }, snapshot },
            clientRequestId,
          });
          ws.publish(`draft:${leagueId}`, payload);
          ws.send(payload);
        }

        if (msg.type === 'chat') {
          const { username, message: rawMessage } = msg;
          if (!username || !rawMessage) return;
          if (!sessionUser) {
            ws.send(JSON.stringify({ type: 'error', error: 'not_authenticated' }));
            return;
          }

          // Server-side rate limit: max 3 messages per second
          const now = Date.now();
          if (!chatRateLimit.has(ws)) chatRateLimit.set(ws, []);
          const timestamps = chatRateLimit.get(ws)!;
          while (timestamps.length > 0 && now - timestamps[0] > 1000) timestamps.shift();
          if (timestamps.length >= 3) {
            ws.send(JSON.stringify({ type: 'error', error: 'Rate limited — max 3 messages per second' }));
            return;
          }
          timestamps.push(now);

          const sanitized = String(rawMessage).replace(/<[^>]*>/g, '').trim().slice(0, 200);
          if (!sanitized) return;

          const chatMsg = JSON.stringify({
            type: 'chat',
            data: { username: String(username).replace(/<[^>]*>/g, '').trim(), message: sanitized, timestamp: new Date().toISOString() },
          });
          ws.publish(`draft:${leagueId}`, chatMsg);
          ws.send(chatMsg);
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
      }
    },
    close(ws) {
      const leagueId = (ws.data as any).params.leagueId;
      ws.unsubscribe(`draft:${leagueId}`);

      const presence = leaguePresence.get(leagueId);
      if (presence) {
        presence.delete(ws);
        const presenceMsg = JSON.stringify({ type: 'presence', data: getPresenceList(leagueId) });
        ws.publish(`draft:${leagueId}`, presenceMsg);
        if (presence.size === 0) leaguePresence.delete(leagueId);
      }
    },
  });

// Make sure the timer runs even if onStart isn't fired (e.g. test harness).
ensureTimerInterval();
