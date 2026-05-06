/**
 * Arena WebSocket endpoint — match ready-up, scrim lobbies, live match broadcasting.
 *
 * Topics:
 *   arena:global          — lobby updates (live matches list, scrim lobby changes)
 *   arena:match:{matchId} — match-specific ready state + live stats
 *   arena:scrim:{lobbyId} — scrim lobby state
 */
import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import { parseSessionToken, validateSession } from '../lib/auth';
import { createBattle, isBotConnected } from '../lib/ps-bot';
import { getLeague } from '../lib/queries';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ArenaClient {
  userId: number;
  username: string;
  teamId: string | null; // null if admin/spectator with no team
  leagueId: string | null;
}

interface ScrimLobby {
  id: string;
  format: string;
  creatorUsername: string;
  creatorTeamId: string | null;
  invitee: string | null; // null = open lobby
  players: string[]; // usernames
  ready: boolean[];
  status: 'waiting' | 'ready' | 'in_progress';
  psRoomId: string | null;
}

// ─── State ──────────────────────────────────────────────────────────────────

const arenaClients = new Map</* ws */ object, ArenaClient>();
const scrimLobbies = new Map<string, ScrimLobby>();
let nextScrimId = 1;

/**
 * Per-match ready-up timeout. If both teams ready up but the bot doesn't transition
 * the match to in_progress within READY_TIMEOUT_MS, revert to scheduled and notify.
 */
const READY_TIMEOUT_MS = parseInt(process.env.READY_TIMEOUT_MS || '120000');
const readyTimers = new Map<string, NodeJS.Timeout>();

function clearReadyTimer(matchId: string) {
  const t = readyTimers.get(matchId);
  if (t) {
    clearTimeout(t);
    readyTimers.delete(matchId);
  }
}

function scheduleReadyTimeout(matchId: string) {
  clearReadyTimer(matchId);
  const handle = setTimeout(() => {
    readyTimers.delete(matchId);
    const m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get();
    // Only revert if still ready (bot hasn't picked it up)
    if (!m || m.status !== 'ready') return;

    db.update(schema.matches)
      .set({ status: 'scheduled', readyHome: false, readyAway: false, startedAt: null })
      .where(eq(schema.matches.id, matchId))
      .run();

    db.insert(schema.matchReadyLog).values({
      matchId,
      teamId: m.homeTeamId,
      event: 'timeout',
    }).run();
    db.insert(schema.matchReadyLog).values({
      matchId,
      teamId: m.awayTeamId,
      event: 'timeout',
    }).run();
    db.insert(schema.activityLog).values({
      type: 'match_ready_timeout',
      category: 'match',
      actor: 'system',
      leagueId: m.leagueId,
      description: `Ready-up timed out for ${matchId} — battle was not created within ${READY_TIMEOUT_MS / 1000}s`,
      metadata: JSON.stringify({ matchId }),
    }).run();

    if (broadcastWs) {
      broadcastWs.publish(`arena:match:${matchId}`, JSON.stringify({
        type: 'match_timeout',
        matchId,
        message: 'Ready-up timed out — try again',
      }));
      broadcastMatchState(matchId);
    }

    console.log(`[arena] ready-up timeout: ${matchId}`);
  }, READY_TIMEOUT_MS);
  readyTimers.set(matchId, handle);
}

/** Called by ps-bot when it picks up a battle for a match (transitions to in_progress). */
export function clearReadyTimerForMatch(matchId: string) {
  clearReadyTimer(matchId);
}

// Reference for broadcasting from external code (e.g., bot result handler).
// Captured once on the first WS connection — Elysia's `ws` instance is shared
// across connections, so reassigning per-open would race in flight.
let broadcastWs: { publish: (topic: string, data: string) => void } | null = null;

export function getArenaBroadcaster() {
  return broadcastWs;
}

/**
 * Pending unready actions, keyed by client `userId|teamId`. When a player's
 * WS disconnects we DON'T immediately mark them unready — frontend page
 * navigations tear down the WS for a few seconds. Hold the action and only
 * commit if they don't reconnect inside the grace window.
 */
const UNREADY_GRACE_MS = parseInt(process.env.UNREADY_GRACE_MS || '8000');
const pendingUnready = new Map<string, NodeJS.Timeout>();
function clientKey(userId: number, teamId: string) { return `${userId}|${teamId}`; }

// ─── Helpers ────────────────────────────────────────────────────────────────

function getUserTeam(userId: number): { teamId: string; leagueId: string } | null {
  const team = db.select().from(schema.teams)
    .where(eq(schema.teams.userId, userId))
    .get();
  return team ? { teamId: team.id, leagueId: team.leagueId } : null;
}

function getCurrentMatch(teamId: string, leagueId: string) {
  const league = getLeague(leagueId);
  if (!league) return null;
  if (league.phase !== 'regular') return null;

  // Find the match for this team in the current week
  const match = db.select().from(schema.matches).where(
    and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.week, league.currentWeek),
    ),
  ).all().find(m =>
    (m.homeTeamId === teamId || m.awayTeamId === teamId) &&
    (m.status === 'scheduled' || m.status === 'ready' || m.status === 'in_progress'),
  );
  return match ?? null;
}

function getMatchWithTeams(matchId: string) {
  const match = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get();
  if (!match) return null;

  const homeTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.homeTeamId)).get();
  const awayTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.awayTeamId)).get();

  return { match, homeTeam, awayTeam };
}

function broadcastMatchState(matchId: string, senderWs?: { send: (data: string) => void }) {
  const data = getMatchWithTeams(matchId);
  if (!data || !broadcastWs) return;

  const msg = JSON.stringify({
    type: 'match_state',
    matchId,
    status: data.match.status,
    readyHome: data.match.readyHome,
    readyAway: data.match.readyAway,
    homeTeam: data.homeTeam ? { id: data.homeTeam.id, name: data.homeTeam.teamName, abbrev: data.homeTeam.teamAbbrev, color: data.homeTeam.teamColor } : null,
    awayTeam: data.awayTeam ? { id: data.awayTeam.id, name: data.awayTeam.teamName, abbrev: data.awayTeam.teamAbbrev, color: data.awayTeam.teamColor } : null,
    psRoomId: data.match.psRoomId,
  });

  broadcastWs.publish(`arena:match:${matchId}`, msg);
  broadcastWs.publish('arena:global', msg);
  senderWs?.send(msg);
}

function broadcastLiveMatches() {
  if (!broadcastWs) return;

  // Get all in-progress matches
  const liveMatches = db.select().from(schema.matches)
    .where(eq(schema.matches.status, 'in_progress'))
    .all()
    .map(m => {
      const homeTeam = db.select().from(schema.teams).where(eq(schema.teams.id, m.homeTeamId)).get();
      const awayTeam = db.select().from(schema.teams).where(eq(schema.teams.id, m.awayTeamId)).get();
      return {
        matchId: m.id,
        leagueId: m.leagueId,
        week: m.week,
        homeTeam: homeTeam ? { name: homeTeam.teamName, abbrev: homeTeam.teamAbbrev } : null,
        awayTeam: awayTeam ? { name: awayTeam.teamName, abbrev: awayTeam.teamAbbrev } : null,
        psRoomId: m.psRoomId,
      };
    });

  broadcastWs.publish('arena:global', JSON.stringify({
    type: 'live_matches',
    matches: liveMatches,
  }));
}

function getScrimListPayload() {
  return JSON.stringify({
    type: 'lobby_list',
    lobbies: Array.from(scrimLobbies.values()).map(l => ({
      id: l.id, format: l.format, creator: l.creatorUsername,
      invitee: l.invitee, players: l.players, ready: l.ready, status: l.status,
    })),
  });
}

/** Broadcast scrim list to all arena clients. Also sends directly to `senderWs` since publish excludes sender. */
function broadcastScrimList(senderWs?: { send: (data: string) => void }) {
  const payload = getScrimListPayload();
  broadcastWs?.publish('arena:global', payload);
  // publish() excludes the sender — send directly so their UI updates too
  senderWs?.send(payload);
}

// ─── Route ──────────────────────────────────────────────────────────────────

export const arenaRoutes = new Elysia()

  // Active players for scrim invite picker (public, lightweight)
  .get('/api/arena/players', () => {
    // Return all users with a team assignment (active league players)
    const teamUsers = db.select({
      username: schema.users.username,
      teamName: schema.teams.teamName,
      teamAbbrev: schema.teams.teamAbbrev,
      leagueId: schema.teams.leagueId,
    }).from(schema.teams)
      .innerJoin(schema.users, eq(schema.teams.userId, schema.users.id))
      .all();

    return teamUsers;
  })

  // REST endpoint for initial Arena data load (match, live matches, scrims)
  .get('/api/arena/state', ({ request, set }) => {
    const cookieHeader = request.headers.get('cookie') ?? undefined;
    const token = cookieHeader ? parseSessionToken(cookieHeader) : null;
    const user = token ? validateSession(token) : null;

    let myMatch = null;
    if (user) {
      const team = getUserTeam(parseInt(user.id));
      if (team) {
        const match = getCurrentMatch(team.teamId, team.leagueId);
        if (match) {
          const data = getMatchWithTeams(match.id);
          if (data) {
            myMatch = {
              matchId: match.id,
              leagueId: match.leagueId,
              week: match.week,
              status: match.status,
              readyHome: match.readyHome,
              readyAway: match.readyAway,
              homeTeam: data.homeTeam ? { id: data.homeTeam.id, name: data.homeTeam.teamName, abbrev: data.homeTeam.teamAbbrev, color: data.homeTeam.teamColor } : null,
              awayTeam: data.awayTeam ? { id: data.awayTeam.id, name: data.awayTeam.teamName, abbrev: data.awayTeam.teamAbbrev, color: data.awayTeam.teamColor } : null,
              isHome: data.match.homeTeamId === team.teamId,
              psRoomId: match.psRoomId,
            };
          }
        }
      }
    }

    const liveMatches = db.select().from(schema.matches)
      .where(eq(schema.matches.status, 'in_progress'))
      .all()
      .map(m => {
        const ht = db.select().from(schema.teams).where(eq(schema.teams.id, m.homeTeamId)).get();
        const at = db.select().from(schema.teams).where(eq(schema.teams.id, m.awayTeamId)).get();
        return {
          matchId: m.id, leagueId: m.leagueId, week: m.week,
          homeTeam: ht ? { name: ht.teamName, abbrev: ht.teamAbbrev } : null,
          awayTeam: at ? { name: at.teamName, abbrev: at.teamAbbrev } : null,
          psRoomId: m.psRoomId,
        };
      });

    const lobbies = Array.from(scrimLobbies.values()).map(l => ({
      id: l.id, format: l.format, creator: l.creatorUsername,
      invitee: l.invitee, players: l.players, ready: l.ready, status: l.status,
    }));

    return { myMatch, liveMatches, scrimLobbies: lobbies };
  })

  // ─── Arena WebSocket ────────────────────────────────────────────────

  .ws('/ws/arena', {
    open(ws) {
      // Capture the broadcaster once. Elysia's `ws.publish` is bound to the
      // app's pub/sub instance, not the individual connection — overwriting
      // it on every open created an unnecessary reassignment race when a
      // result/timeout fired during a reconnect storm.
      if (!broadcastWs) broadcastWs = ws;
      ws.subscribe('arena:global');

      // Auto-authenticate from cookie on the upgrade request
      const request = (ws.data as any)?.request;
      const cookieHeader = request?.headers?.get?.('cookie') ?? undefined;
      const token = parseSessionToken(cookieHeader);
      const user = token ? validateSession(token) : null;

      if (user) {
        const team = getUserTeam(parseInt(user.id));
        const client: ArenaClient = {
          userId: parseInt(user.id),
          username: user.username,
          teamId: team?.teamId ?? null,
          leagueId: team?.leagueId ?? null,
        };
        arenaClients.set(ws, client);

        // Cancel any pending unready (player navigated, didn't drop)
        if (team) {
          const key = clientKey(client.userId, team.teamId);
          const pending = pendingUnready.get(key);
          if (pending) {
            clearTimeout(pending);
            pendingUnready.delete(key);
          }
        }

        // Subscribe to their match if they have one
        if (team) {
          const match = getCurrentMatch(team.teamId, team.leagueId);
          if (match) {
            ws.subscribe(`arena:match:${match.id}`);
          }
        }

        ws.send(JSON.stringify({ type: 'identified', username: user.username, teamId: team?.teamId }));
      }
    },

    message(ws, message) {
      try {
        const msg = typeof message === 'string' ? JSON.parse(message) : message;

        switch (msg.type) {
          case 'identify': {
            // Fallback: authenticate from explicit token if cookie auth didn't work
            const { token } = msg;
            if (!token) return;
            const user = validateSession(token);
            if (!user) {
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid session' }));
              return;
            }

            const team = getUserTeam(parseInt(user.id));
            const client: ArenaClient = {
              userId: parseInt(user.id),
              username: user.username,
              teamId: team?.teamId ?? null,
              leagueId: team?.leagueId ?? null,
            };
            arenaClients.set(ws, client);

            if (team) {
              const match = getCurrentMatch(team.teamId, team.leagueId);
              if (match) {
                ws.subscribe(`arena:match:${match.id}`);
              }
            }

            ws.send(JSON.stringify({ type: 'identified', username: user.username, teamId: team?.teamId }));
            break;
          }

          case 'match_ready': {
            const client = arenaClients.get(ws);
            if (!client?.teamId || !client.leagueId) {
              ws.send(JSON.stringify({ type: 'error', message: 'No team assigned' }));
              return;
            }

            const match = getCurrentMatch(client.teamId, client.leagueId);
            if (!match) {
              ws.send(JSON.stringify({ type: 'error', message: 'No match found' }));
              return;
            }

            const isHome = match.homeTeamId === client.teamId;
            const updateField = isHome ? { readyHome: true } : { readyAway: true };

            db.update(schema.matches).set(updateField).where(eq(schema.matches.id, match.id)).run();

            // Log ready event
            db.insert(schema.matchReadyLog).values({
              matchId: match.id,
              teamId: client.teamId,
              event: 'ready',
            }).run();

            // Check if both are now ready
            const updated = db.select().from(schema.matches).where(eq(schema.matches.id, match.id)).get()!;
            if (updated.readyHome && updated.readyAway) {
              db.update(schema.matches)
                .set({ status: 'ready', startedAt: new Date().toISOString() })
                .where(eq(schema.matches.id, match.id)).run();

              scheduleReadyTimeout(match.id);

              // Log to activity
              db.insert(schema.activityLog).values({
                type: 'match_ready',
                category: 'match',
                actor: 'system',
                leagueId: client.leagueId,
                description: `Both teams ready for ${match.id}`,
                metadata: JSON.stringify({ matchId: match.id }),
              }).run();

              // Instruct bot to create the PS battle
              if (isBotConnected()) {
                const homeTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.homeTeamId)).get();
                const awayTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.awayTeamId)).get();
                const p1Name = homeTeam?.showdownUsername || homeTeam?.coachName || match.homeTeamId;
                const p2Name = awayTeam?.showdownUsername || awayTeam?.coachName || match.awayTeamId;
                createBattle(p1Name, p2Name);
              } else {
                // Bot not connected — notify players
                ws.send(JSON.stringify({
                  type: 'match_error',
                  matchId: match.id,
                  message: 'Could not create battle — Showdown bot is not connected. Try again shortly.',
                }));
              }
            }

            broadcastMatchState(match.id, ws);
            break;
          }

          case 'match_unready': {
            const client = arenaClients.get(ws);
            if (!client?.teamId || !client.leagueId) return;

            const match = getCurrentMatch(client.teamId, client.leagueId);
            if (!match || match.status === 'in_progress' || match.status === 'completed') return;

            const isHome = match.homeTeamId === client.teamId;
            const updateField = isHome ? { readyHome: false } : { readyAway: false };

            db.update(schema.matches)
              .set({ ...updateField, status: 'scheduled' })
              .where(eq(schema.matches.id, match.id)).run();
            clearReadyTimer(match.id);

            db.insert(schema.matchReadyLog).values({
              matchId: match.id,
              teamId: client.teamId,
              event: 'unready',
            }).run();

            broadcastMatchState(match.id, ws);
            break;
          }

          case 'scrim_create': {
            const client = arenaClients.get(ws);
            if (!client) return;

            const lobbyId = `scrim-${nextScrimId++}`;
            const lobby: ScrimLobby = {
              id: lobbyId,
              format: msg.format || 'gen9natdexdraft',
              creatorUsername: client.username,
              creatorTeamId: client.teamId,
              invitee: msg.invitee || null,
              players: [client.username],
              ready: [false],
              status: 'waiting',
              psRoomId: null,
            };
            scrimLobbies.set(lobbyId, lobby);
            ws.subscribe(`arena:scrim:${lobbyId}`);

            broadcastScrimList(ws);
            ws.send(JSON.stringify({ type: 'scrim_joined', lobbyId }));
            break;
          }

          case 'scrim_join': {
            const client = arenaClients.get(ws);
            if (!client) return;

            const lobby = scrimLobbies.get(msg.lobbyId);
            if (!lobby || lobby.players.length >= 2) {
              ws.send(JSON.stringify({ type: 'error', message: 'Lobby full or not found' }));
              return;
            }
            if (lobby.invitee && lobby.invitee !== client.username) {
              ws.send(JSON.stringify({ type: 'error', message: 'This is a private lobby' }));
              return;
            }

            lobby.players.push(client.username);
            lobby.ready.push(false);
            ws.subscribe(`arena:scrim:${msg.lobbyId}`);

            broadcastScrimList(ws);
            if (broadcastWs) {
              broadcastWs.publish(`arena:scrim:${msg.lobbyId}`, JSON.stringify({
                type: 'scrim_state', lobbyId: msg.lobbyId,
                players: lobby.players, ready: lobby.ready, status: lobby.status,
              }));
            }
            break;
          }

          case 'scrim_leave': {
            const client = arenaClients.get(ws);
            if (!client) return;

            const lobby = scrimLobbies.get(msg.lobbyId);
            if (!lobby) return;

            const idx = lobby.players.indexOf(client.username);
            if (idx === -1) return;

            lobby.players.splice(idx, 1);
            lobby.ready.splice(idx, 1);

            if (lobby.players.length === 0) {
              scrimLobbies.delete(msg.lobbyId);
            }

            ws.unsubscribe(`arena:scrim:${msg.lobbyId}`);
            broadcastScrimList(ws);
            break;
          }

          case 'scrim_ready': {
            const client = arenaClients.get(ws);
            if (!client) return;

            const lobby = scrimLobbies.get(msg.lobbyId);
            if (!lobby) return;

            const idx = lobby.players.indexOf(client.username);
            if (idx === -1) return;

            lobby.ready[idx] = true;

            // Check if both ready
            if (lobby.players.length === 2 && lobby.ready[0] && lobby.ready[1]) {
              lobby.status = 'ready';
              // Create scrim battle via bot
              if (isBotConnected()) {
                createBattle(lobby.players[0], lobby.players[1]);
              }
            }

            if (broadcastWs) {
              broadcastWs.publish(`arena:scrim:${msg.lobbyId}`, JSON.stringify({
                type: 'scrim_state', lobbyId: msg.lobbyId,
                players: lobby.players, ready: lobby.ready, status: lobby.status,
              }));
            }
            broadcastScrimList(ws);
            break;
          }

          case 'arena_subscribe': {
            // Subscribe to live stats for a specific match
            if (msg.matchId) {
              ws.subscribe(`arena:match:${msg.matchId}`);
            }
            break;
          }

          case 'arena_unsubscribe': {
            if (msg.matchId) {
              ws.unsubscribe(`arena:match:${msg.matchId}`);
            }
            break;
          }
        }
      } catch {
        // Ignore malformed messages
      }
    },

    close(ws) {
      const client = arenaClients.get(ws);
      if (client?.teamId && client.leagueId) {
        // Don't unready immediately — frontend page navigation tears down the
        // WS for a few seconds. Hold the action; cancel it if they reconnect.
        const teamId = client.teamId;
        const leagueId = client.leagueId;
        const userId = client.userId;
        const key = clientKey(userId, teamId);

        // Replace any existing pending timer (e.g. flapping connection)
        const existing = pendingUnready.get(key);
        if (existing) clearTimeout(existing);

        const handle = setTimeout(() => {
          pendingUnready.delete(key);
          const match = getCurrentMatch(teamId, leagueId);
          if (!match) return;
          if (match.status !== 'scheduled' && match.status !== 'ready') return;

          const isHome = match.homeTeamId === teamId;
          const wasReady = isHome ? match.readyHome : match.readyAway;
          if (!wasReady) return;

          const updateField = isHome ? { readyHome: false } : { readyAway: false };
          db.update(schema.matches)
            .set({ ...updateField, status: 'scheduled' })
            .where(eq(schema.matches.id, match.id)).run();

          db.insert(schema.matchReadyLog).values({
            matchId: match.id,
            teamId,
            event: 'disconnect',
          }).run();

          broadcastMatchState(match.id);
        }, UNREADY_GRACE_MS);
        pendingUnready.set(key, handle);

        // Clean up scrim lobbies the player was in
        for (const [lobbyId, lobby] of scrimLobbies) {
          const idx = lobby.players.indexOf(client.username);
          if (idx !== -1) {
            lobby.players.splice(idx, 1);
            lobby.ready.splice(idx, 1);
            if (lobby.players.length === 0) {
              scrimLobbies.delete(lobbyId);
            }
          }
        }
        broadcastScrimList(ws);
      }

      arenaClients.delete(ws);
    },
  });
