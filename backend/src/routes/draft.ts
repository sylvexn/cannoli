import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import { getDraftSnapshot, startDraft, executePick, handleTimerExpiry } from '../lib/draft-engine';

// ─── Presence tracking per league ──────────────────────────────────────────

interface DraftPresence {
  teamId: string | null; // null = spectator/admin
  username: string;
  role: 'dev' | 'admin' | 'user' | 'spectator';
}

const leaguePresence = new Map<string, Map</* ws id */ object, DraftPresence>>();

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
    if (!user || user.role !== 'dev') { set.status = 403; return { error: 'Forbidden' }; }
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
    if (!user || user.role !== 'dev') { set.status = 403; return { error: 'Forbidden' }; }
    const state = db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, params.leagueId)).get();
    if (!state || state.status !== 'in_progress') { set.status = 400; return { error: 'Draft is not in progress' }; }
    db.update(schema.draftState).set({ status: 'paused', timerStartedAt: null }).where(eq(schema.draftState.leagueId, params.leagueId)).run();
    return { success: true };
  })

  .post('/api/leagues/:leagueId/draft/resume', ({ params, user, set }) => {
    if (!user || user.role !== 'dev') { set.status = 403; return { error: 'Forbidden' }; }
    const state = db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, params.leagueId)).get();
    if (!state || state.status !== 'paused') { set.status = 400; return { error: 'Draft is not paused' }; }
    db.update(schema.draftState).set({ status: 'in_progress', timerStartedAt: new Date().toISOString() }).where(eq(schema.draftState.leagueId, params.leagueId)).run();
    return getDraftSnapshot(params.leagueId);
  })

  .post('/api/leagues/:leagueId/draft/auto-pick', ({ params, user, set }) => {
    if (!user || user.role !== 'dev') { set.status = 403; return { error: 'Forbidden' }; }
    const result = handleTimerExpiry(params.leagueId);
    if (!result) { set.status = 400; return { error: 'Cannot auto-pick' }; }
    return result;
  })

  // ─── Draft WebSocket ──────────────────────────────────────────────

  .ws('/ws/draft/:leagueId', {
    open(ws) {
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
