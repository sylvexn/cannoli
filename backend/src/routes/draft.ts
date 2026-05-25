import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import {
  getDraftSnapshot, startDraft, executePick, executeAutoPick, skipPick,
  undoLastPick, generateSnakeOrder, handleTimerExpiry,
  getDraftQueue, setDraftQueue,
} from '../lib/draft-engine';
import type { PickErrorCode } from '../lib/draft-engine';
import { isStaff } from '../lib/auth';
import { getLeague } from '../lib/queries';
import { checkLeagueArchived } from '../lib/archive-guard';
import { registerBroadcastServer, publishWs } from '../lib/ws-broadcast';

/**
 * Stable identity for an Elysia WS handler arg. Elysia 1.4 builds a NEW
 * `ElysiaWS` wrapper around the underlying Bun ServerWebSocket on every handler
 * invocation (open / message / close), so keying maps on the wrapper produces a
 * fresh key each call — `.get(ws)` in `message` misses the entry `open` set.
 * `ws.raw` (the underlying ServerWebSocket) is stable for the connection's
 * lifetime; fall back to the wrapper itself for test mocks lacking `.raw`.
 */
function wsKey(ws: any): object {
  return ws && ws.raw ? ws.raw : ws;
}

// ─── Presence tracking per league ──────────────────────────────────────────

interface DraftPresence {
  teamId: string | null; // null = spectator/admin
  username: string;
  role: 'dev' | 'admin' | 'user' | 'spectator';
  /** User ID from session — used for league-isolation auth on WS messages. */
  userId: number | null;
}

/**
 * Shape of `ws.data` for the draft WebSocket. Elysia derives `params` + `user`
 * from the route/auth context; `draftAuth` is stamped on `open` after the
 * league-isolation check. Typed here so handlers stop reaching through `any`.
 */
interface DraftSocketData {
  params: { leagueId: string };
  user: { id: string; role: string; username?: string } | null;
  draftAuth?: { teamId: string | null; userId: number | null };
}

const leaguePresence = new Map<string, Map</* wsKey */ object, DraftPresence>>();

// ─── Idempotency cache ─────────────────────────────────────────────────────
// Per-league ring buffer of recent (clientRequestId → result) pairs. Lets a
// flaky client safely re-send a pick after a disconnect without double-picking.
// Bounded so a misbehaving client can't OOM us.
export const IDEMPOTENCY_LIMIT = 64;
export type IdempotentResult = {
  ok: true;
  pick: { teamId: string; pokemonName: string; tier: number; pickNumber: number };
} | {
  ok: false;
  error: string;
  code?: PickErrorCode;
};
const idempotencyByLeague = new Map<string, Map<string, IdempotentResult>>();

export function recordIdempotent(leagueId: string, requestId: string, result: IdempotentResult) {
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

export function lookupIdempotent(leagueId: string, requestId: string): IdempotentResult | undefined {
  return idempotencyByLeague.get(leagueId)?.get(requestId);
}

/**
 * Push the current draft snapshot to every subscriber on this league's WS topic.
 */
function broadcastDraftState(leagueId: string) {
  const snapshot = getDraftSnapshot(leagueId);
  if (!snapshot) return;
  publishWs(`draft:${leagueId}`, JSON.stringify({ type: 'draft_state', data: snapshot }));
}

// ─── Server-side timer scheduler ───────────────────────────────────────────
// One global tick at 1Hz; checks every active draft's deadline and fires
// auto-pick when the timer hits zero. Cheaper than per-league setTimeouts and
// survives pick/pause/resume transitions without leaks.

let timerInterval: ReturnType<typeof setInterval> | null = null;

function tickTimers() {
  let states: typeof schema.draftState.$inferSelect[];
  try {
    states = db.select().from(schema.draftState).all();
  } catch (err) {
    // Table can vanish briefly during a `seed:fresh` wipe; the next tick
    // (1s later) will succeed once migrations recreate it. Log once per
    // tick, don't crash the process.
    console.warn('[draft tick] skipping tick — DB query failed:', err instanceof Error ? err.message : err);
    return;
  }
  const now = Date.now();
  for (const s of states) {
    if (s.status !== 'in_progress' || !s.timerStartedAt) continue;
    const deadline = new Date(s.timerStartedAt).getTime() + s.timerDuration * 1000;
    if (now < deadline) continue;

    // Timer expired — pause the draft and flag the team whose timer expired.
    // Admins have explicit /auto-pick + /skip endpoints to resolve the pause
    // (the `timerExpiredForTeam` flag is what gates POST /draft/auto-pick).
    // Previously the scheduler called executePick directly, which made the
    // admin auto-pick endpoint unreachable (paused-with-flag state never
    // existed); see also lib/draft-engine.handleTimerExpiry.
    const league = getLeague(s.leagueId);
    if (!league?.draftOrder) continue;
    const teamOrder: string[] = JSON.parse(league.draftOrder);
    const snakeOrder = generateSnakeOrder(teamOrder, league.rosterSize);
    const slot = snakeOrder[s.currentPickIndex];
    if (!slot) continue;

    const result = handleTimerExpiry(s.leagueId);
    if (result?.paused) {
      broadcastDraftState(s.leagueId);
      publishWs(`draft:${s.leagueId}`, JSON.stringify({
        type: 'timer_expired',
        data: { teamId: result.teamId },
      }));
    }
  }
}

function ensureTimerInterval() {
  if (timerInterval) return;
  timerInterval = setInterval(tickTimers, 1000);
}

// Chat rate limiting: track last 3 message timestamps per connection. Keyed on
// the stable wsKey (ws.raw) — a WeakMap keyed on the per-call wrapper would miss
// across handler invocations under Elysia 1.4.
const chatRateLimit = new Map<object, number[]>();

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
  .onStart((app) => { ensureTimerInterval(); registerBroadcastServer((app as any).server); })

  // HTTP mirror of the WS `presence` broadcast. Useful for staff tooling +
  // tests that need a synchronous "is everyone connected" check before
  // calling /draft/start, without standing up a WS subscriber.
  .get('/api/leagues/:leagueId/draft/presence', ({ params }) => {
    return getPresenceList(params.leagueId);
  })

  .get('/api/leagues/:leagueId/draft/state', ({ params }) => {
    const snapshot = getDraftSnapshot(params.leagueId);
    if (!snapshot) return { status: 'not_started' as const, leagueId: params.leagueId };
    return snapshot;
  })

  // ─── Per-team draft queue (auto-pick preference list) ───────────────
  // A coach pre-sets an ordered list; on timer-expiry auto-pick the engine
  // walks it top-down for the first eligible mon (see getAutoPick).
  .get('/api/leagues/:leagueId/draft/queue', ({ params, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const team = db.select({ id: schema.teams.id }).from(schema.teams)
      .where(and(eq(schema.teams.leagueId, params.leagueId), eq(schema.teams.userId, parseInt(user.id))))
      .get();
    const teamId = (isStaff(user) && (params as any).teamId) || team?.id;
    if (!teamId) { set.status = 403; return { error: "You don't have a team in this league" }; }
    return { queue: getDraftQueue(params.leagueId, teamId) };
  })

  .put('/api/leagues/:leagueId/draft/queue', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const { names, teamId: bodyTeamId } = (body as { names?: string[]; teamId?: string }) ?? {};
    if (!Array.isArray(names)) { set.status = 400; return { error: 'names[] required' }; }

    const team = db.select({ id: schema.teams.id }).from(schema.teams)
      .where(and(eq(schema.teams.leagueId, params.leagueId), eq(schema.teams.userId, parseInt(user.id))))
      .get();
    // Staff may set any team's queue (admin tooling); a coach only their own.
    const teamId = (isStaff(user) && bodyTeamId) ? bodyTeamId : team?.id;
    if (!teamId) { set.status = 403; return { error: "You don't have a team in this league" }; }

    const saved = setDraftQueue(params.leagueId, teamId, names);
    return { queue: saved };
  })

  .post('/api/leagues/:leagueId/draft/start', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }
    const { timerDuration, force } = (body as { timerDuration?: number; force?: boolean }) ?? {};
    const result = startDraft(params.leagueId, timerDuration ?? 120, user.username, { force: !!force });
    if (!result.success) {
      // Re-running a completed/paused draft requires explicit force=true so
      // an accidental call doesn't silently wipe rosters. Surface 409 with a
      // structured code so the UI can prompt for confirmation.
      const isConflict = result.code === 'completed_draft_requires_force' || result.code === 'paused_draft_requires_force';
      set.status = isConflict ? 409 : 400;
      return { error: result.error, code: result.code };
    }
    broadcastDraftState(params.leagueId);
    return getDraftSnapshot(params.leagueId);
  })

  .post('/api/leagues/:leagueId/draft/pick', ({ params, query, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }
    const { pokemonName, clientRequestId, teamId: bodyTeamId } =
      body as { pokemonName: string; clientRequestId?: string; teamId?: string };
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

    const overrideTeamId = (isStaff(user) && bodyTeamId) ? bodyTeamId : null;
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
    publishWs(`draft:${params.leagueId}`, JSON.stringify({
      type: 'pick_made',
      data: { pick: { ...result.pick, playerId: result.pick.teamId }, snapshot: getDraftSnapshot(params.leagueId) },
    }));

    return result;
  })

  // ─── Staff override: force a pick on behalf of any team ─────────────
  .post('/api/leagues/:leagueId/draft/force-pick', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }
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
  .post('/api/leagues/:leagueId/draft/undo', ({ params, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }
    const result = undoLastPick(params.leagueId, user.username);
    if (!result.success) { set.status = 400; return { error: result.error }; }
    broadcastDraftState(params.leagueId);
    return result;
  })

  .post('/api/leagues/:leagueId/draft/pause', ({ params, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }
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

  .post('/api/leagues/:leagueId/draft/resume', ({ params, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }
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

  .post('/api/leagues/:leagueId/draft/auto-pick', ({ params, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }
    let result;
    try {
      result = executeAutoPick(params.leagueId, user.username);
    } catch (e) {
      set.status = 400;
      return { error: (e as Error).message };
    }
    if (!result) { set.status = 400; return { error: 'Cannot auto-pick' }; }

    broadcastDraftState(params.leagueId);
    if (result.success) {
      // Include the post-pick snapshot so clients can apply it via LIVE_SYNC
      // without waiting for the separately-broadcast draft_state. Reason
      // distinguishes admin-triggered auto-pick from a future automatic flow.
      publishWs(`draft:${params.leagueId}`, JSON.stringify({
        type: 'auto_pick',
        data: {
          pick: { ...result.pick, playerId: result.pick.teamId },
          reason: 'admin_auto_pick',
          snapshot: getDraftSnapshot(params.leagueId),
        },
      }));
    }
    return result;
  })

  .post('/api/leagues/:leagueId/draft/skip', ({ params, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }
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
      const data = ws.data as unknown as DraftSocketData;
      const leagueId = data.params.leagueId;
      const user = data.user;

      // League isolation: must be staff or have a team in this league.
      // Anonymous connections are rejected outright.
      const auth = canSubscribeToLeague(user, leagueId);
      if (!auth.allow) {
        ws.send(JSON.stringify({ type: 'error', error: auth.reason ?? 'forbidden' }));
        ws.close();
        return;
      }
      data.draftAuth = { teamId: auth.teamId, userId: user ? parseInt(user.id) : null };

      ws.subscribe(`draft:${leagueId}`);
      const snapshot = getDraftSnapshot(leagueId);
      ws.send(JSON.stringify({ type: 'draft_state', data: snapshot ?? { status: 'not_started', leagueId } }));
      ws.send(JSON.stringify({ type: 'presence', data: getPresenceList(leagueId) }));
    },
    message(ws, message) {
      try {
        const msg = typeof message === 'string' ? JSON.parse(message) : message;
        const data = ws.data as unknown as DraftSocketData;
        const leagueId = data.params.leagueId;
        const sessionUser = data.user;
        const auth = data.draftAuth;

        if (msg.type === 'identify') {
          const { teamId, username, role } = msg;
          if (!username) return;

          // Reject claimed teamIds that don't match the authed session's team
          // (staff can spectate as themselves; their teamId is always null).
          if (teamId && !isStaff(sessionUser) && auth?.teamId !== teamId) {
            ws.send(JSON.stringify({ type: 'error', error: 'team_mismatch' }));
            return;
          }

          // When the client identifies without a teamId (live draft hasn't
          // surfaced its picker yet, or the user just hasn't selected one),
          // fall back to the auth-derived team so coaches still appear as
          // players in the presence map. Staff never have an auth.teamId
          // so they remain spectators.
          const presenceTeamId = teamId || auth?.teamId || null;

          if (!leaguePresence.has(leagueId)) leaguePresence.set(leagueId, new Map());
          leaguePresence.get(leagueId)!.set(wsKey(ws), {
            teamId: presenceTeamId,
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
          const rlKey = wsKey(ws);
          if (!chatRateLimit.has(rlKey)) chatRateLimit.set(rlKey, []);
          const timestamps = chatRateLimit.get(rlKey)!;
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
      } catch (err) {
        // Surface at debug so a parse/handler failure isn't fully silent
        // (this swallow once hid the WS-IDENTITY bug).
        console.debug('[draft] failed to handle WS message:', err);
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
      }
    },
    close(ws) {
      const leagueId = (ws.data as unknown as DraftSocketData).params.leagueId;
      ws.unsubscribe(`draft:${leagueId}`);
      chatRateLimit.delete(wsKey(ws));

      const presence = leaguePresence.get(leagueId);
      if (presence) {
        presence.delete(wsKey(ws));
        const presenceMsg = JSON.stringify({ type: 'presence', data: getPresenceList(leagueId) });
        ws.publish(`draft:${leagueId}`, presenceMsg);
        if (presence.size === 0) leaguePresence.delete(leagueId);
      }
    },
  });

// Make sure the timer runs even if onStart isn't fired (e.g. test harness).
ensureTimerInterval();
