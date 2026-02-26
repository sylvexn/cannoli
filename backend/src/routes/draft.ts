import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import { getDraftSnapshot, startDraft, executePick, handleTimerExpiry, executeAutoPick, skipPick } from '../lib/draft-engine';
import { isStaff } from '../lib/auth';

// ─── Presence tracking per league ──────────────────────────────────────────

interface DraftPresence {
  teamId: string | null; // null = spectator/admin
  username: string;
  role: 'dev' | 'admin' | 'user' | 'spectator';
}

const leaguePresence = new Map<string, Map</* ws id */ object, DraftPresence>>();

// Store a reference to a ws instance for server-side broadcasting from HTTP endpoints
let broadcastWs: { publish: (topic: string, data: string) => void } | null = null;

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

export const draftRoutes = new Elysia()

  .get('/api/leagues/:leagueId/draft/state', ({ params }) => {
    const snapshot = getDraftSnapshot(params.leagueId);
    if (!snapshot) return { status: 'not_started' as const, leagueId: params.leagueId };
    return snapshot;
  })

  .post('/api/leagues/:leagueId/draft/start', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const { timerDuration } = (body as { timerDuration?: number }) ?? {};
    const result = startDraft(params.leagueId, timerDuration ?? 120);
    if (!result.success) { set.status = 400; return { error: result.error }; }
    return getDraftSnapshot(params.leagueId);
  })

  .post('/api/leagues/:leagueId/draft/pick', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const { pokemonName } = body as { pokemonName: string };
    if (!pokemonName) { set.status = 400; return { error: 'pokemonName required' }; }

    const team = db.select().from(schema.teams)
      .where(and(eq(schema.teams.leagueId, params.leagueId), eq(schema.teams.userId, parseInt(user.id))))
      .get();

    const teamId = (user.role === 'dev' && (body as any).teamId) ? (body as any).teamId : team?.id;
    if (!teamId) { set.status = 403; return { error: 'You don\'t have a team in this league' }; }

    const result = executePick(params.leagueId, pokemonName, teamId);
    if (!result.success) { set.status = 400; return { error: result.error }; }

    return result;
  })

  .post('/api/leagues/:leagueId/draft/pause', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const state = db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, params.leagueId)).get();
    if (!state || state.status !== 'in_progress') { set.status = 400; return { error: 'Draft is not in progress' }; }
    db.update(schema.draftState).set({ status: 'paused', timerStartedAt: null }).where(eq(schema.draftState.leagueId, params.leagueId)).run();
    return { success: true };
  })

  .post('/api/leagues/:leagueId/draft/resume', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const state = db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, params.leagueId)).get();
    if (!state || state.status !== 'paused') { set.status = 400; return { error: 'Draft is not paused' }; }
    db.update(schema.draftState).set({ status: 'in_progress', timerStartedAt: new Date().toISOString() }).where(eq(schema.draftState.leagueId, params.leagueId)).run();
    return getDraftSnapshot(params.leagueId);
  })

  .post('/api/leagues/:leagueId/draft/auto-pick', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const result = executeAutoPick(params.leagueId);
    if (!result) { set.status = 400; return { error: 'Cannot auto-pick' }; }

    // Broadcast updated state to all WS subscribers
    const snapshot = getDraftSnapshot(params.leagueId);
    if (broadcastWs && snapshot) {
      broadcastWs.publish(`draft:${params.leagueId}`, JSON.stringify({ type: 'draft_state', data: snapshot }));
    }

    return result;
  })

  .post('/api/leagues/:leagueId/draft/skip', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const result = skipPick(params.leagueId);
    if (!result.success) { set.status = 400; return { error: (result as any).error }; }

    // Broadcast updated state to all WS subscribers
    const snapshot = getDraftSnapshot(params.leagueId);
    if (broadcastWs && snapshot) {
      broadcastWs.publish(`draft:${params.leagueId}`, JSON.stringify({ type: 'draft_state', data: snapshot }));
    }

    return result;
  })

  // ─── Draft WebSocket ──────────────────────────────────────────────

  .ws('/ws/draft/:leagueId', {
    open(ws) {
      broadcastWs = ws; // Keep a ws ref for HTTP endpoint broadcasting
      const leagueId = (ws.data as any).params.leagueId;
      ws.subscribe(`draft:${leagueId}`);
      const snapshot = getDraftSnapshot(leagueId);
      ws.send(JSON.stringify({ type: 'draft_state', data: snapshot ?? { status: 'not_started', leagueId } }));
      // Send current presence
      ws.send(JSON.stringify({ type: 'presence', data: getPresenceList(leagueId) }));
    },
    message(ws, message) {
      try {
        const msg = typeof message === 'string' ? JSON.parse(message) : message;
        const leagueId = (ws.data as any).params.leagueId;

        if (msg.type === 'identify') {
          // Client identifies themselves: { type: 'identify', teamId?, username, role }
          const { teamId, username, role } = msg;
          if (!username) return;

          if (!leaguePresence.has(leagueId)) leaguePresence.set(leagueId, new Map());
          leaguePresence.get(leagueId)!.set(ws, {
            teamId: teamId || null,
            username,
            role: role || 'spectator',
          });

          // Broadcast updated presence to all
          const presenceMsg = JSON.stringify({ type: 'presence', data: getPresenceList(leagueId) });
          ws.publish(`draft:${leagueId}`, presenceMsg);
          ws.send(presenceMsg);
          return;
        }

        if (msg.type === 'pick') {
          const { pokemonName, teamId } = msg;
          if (!pokemonName || !teamId) {
            ws.send(JSON.stringify({ type: 'error', error: 'pokemonName and teamId required' }));
            return;
          }

          const result = executePick(leagueId, pokemonName, teamId);
          if (!result.success) {
            ws.send(JSON.stringify({ type: 'error', error: result.error }));
            return;
          }

          const snapshot = getDraftSnapshot(leagueId);
          ws.publish(`draft:${leagueId}`, JSON.stringify({
            type: 'pick_made',
            data: { pick: result.pick, snapshot },
          }));
          ws.send(JSON.stringify({
            type: 'pick_made',
            data: { pick: result.pick, snapshot },
          }));
        }

        if (msg.type === 'chat') {
          const { username, message: rawMessage } = msg;
          if (!username || !rawMessage) return;

          // Server-side rate limit: max 3 messages per second
          const now = Date.now();
          if (!chatRateLimit.has(ws)) chatRateLimit.set(ws, []);
          const timestamps = chatRateLimit.get(ws)!;
          // Remove timestamps older than 1 second
          while (timestamps.length > 0 && now - timestamps[0] > 1000) timestamps.shift();
          if (timestamps.length >= 3) {
            ws.send(JSON.stringify({ type: 'error', error: 'Rate limited — max 3 messages per second' }));
            return;
          }
          timestamps.push(now);

          // Sanitize: strip HTML tags, trim, max 200 chars
          const sanitized = String(rawMessage).replace(/<[^>]*>/g, '').trim().slice(0, 200);
          if (!sanitized) return;

          const chatMsg = JSON.stringify({
            type: 'chat',
            data: { username: String(username).replace(/<[^>]*>/g, '').trim(), message: sanitized, timestamp: new Date().toISOString() },
          });
          ws.publish(`draft:${leagueId}`, chatMsg);
          ws.send(chatMsg); // also send back to sender
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
      }
    },
    close(ws) {
      const leagueId = (ws.data as any).params.leagueId;
      ws.unsubscribe(`draft:${leagueId}`);

      // Remove from presence and broadcast
      const presence = leaguePresence.get(leagueId);
      if (presence) {
        presence.delete(ws);
        const presenceMsg = JSON.stringify({ type: 'presence', data: getPresenceList(leagueId) });
        ws.publish(`draft:${leagueId}`, presenceMsg);
        if (presence.size === 0) leaguePresence.delete(leagueId);
      }
    },
  });
