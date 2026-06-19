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
import { eq, and, sql } from 'drizzle-orm';
import { parseSessionToken, validateSession } from '../lib/auth';
import { createBattle, cancelBattle, isBotConnected, onBotConnectionChange } from '../lib/ps-bot';
import { getLeague } from '../lib/queries';
import { logServerFault } from '../lib/request-log';
import { registerBroadcastServer, publishWs, hasBroadcastServer } from '../lib/ws-broadcast';
import {
  getUserTeam as _getUserTeam,
  getPlayableMatches as _getPlayableMatches,
  getCurrentMatch as _getCurrentMatch,
  createBattleForReadyMatch,
  findResumableReadyMatches,
} from '../lib/arena-state';

// Re-export so external callers can import from this module if needed.
export { getCurrentMatchReminder } from '../lib/arena-state';

/**
 * Stable identity for an Elysia WS handler arg. Elysia 1.4 hands a fresh
 * `ElysiaWS` wrapper to each lifecycle callback (open/message/close); the
 * underlying `ws.raw` is stable for the connection's lifetime. Key all
 * per-connection collections on `wsKey(ws)` so `.get()` in `message`/`close`
 * finds the entry `open` set. Falls back to the wrapper for test mocks.
 */
function wsKey(ws: any): object {
  return ws && ws.raw ? ws.raw : ws;
}

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

const arenaClients = new Map</* wsKey */ object, ArenaClient>();
const scrimLobbies = new Map<string, ScrimLobby>();
let nextScrimId = 1;

/**
 * Per-match spectator subscriptions. Tracks which WS clients are currently
 * subscribed to `arena:match:{matchId}`. Elysia's pub/sub layer doesn't
 * expose subscriber counts, so we maintain it ourselves to broadcast
 * `spectator_count` updates whenever it changes.
 */
const matchSpectators = new Map<string, Set<object>>();

function broadcastSpectatorCount(matchId: string) {
  const count = matchSpectators.get(matchId)?.size ?? 0;
  publishWs(`arena:match:${matchId}`, JSON.stringify({
    type: 'spectator_count',
    matchId,
    count,
  }));
}

function addSpectator(matchId: string, ws: object) {
  const key = wsKey(ws);
  let set = matchSpectators.get(matchId);
  if (!set) {
    set = new Set();
    matchSpectators.set(matchId, set);
  }
  if (set.has(key)) return;
  set.add(key);
  broadcastSpectatorCount(matchId);
}

function removeSpectator(matchId: string, ws: object) {
  const key = wsKey(ws);
  const set = matchSpectators.get(matchId);
  if (!set?.has(key)) return;
  set.delete(key);
  if (set.size === 0) matchSpectators.delete(matchId);
  broadcastSpectatorCount(matchId);
}

/** Drop a ws from every match's spectator set (called on close). */
function removeSpectatorFromAll(ws: object) {
  const key = wsKey(ws);
  for (const [matchId, set] of matchSpectators) {
    if (set.delete(key)) {
      if (set.size === 0) matchSpectators.delete(matchId);
      broadcastSpectatorCount(matchId);
    }
  }
}

/**
 * Per-match ready-up / team-selection timeout. Both teams ready up, the bot
 * sends a /cannoli-battle INVITE, and the PS plugin creates a room with both
 * player slots empty + invited — each player then picks a team in their native
 * Showdown team-picker and accepts. The battle only STARTS once both accept, at
 * which point the bot flips the match to in_progress and clears this timer.
 *
 * If the battle hasn't started within INVITE_TIMEOUT_MS (a player never picked
 * a team), revert to scheduled, cancel the orphaned invite room, and notify.
 * This window is longer than the old battle-create window because it now spans
 * human team selection.
 *
 * READY_TIMEOUT_MS is retained for backward compatibility / any external
 * reference, but the ready→start window uses INVITE_TIMEOUT_MS.
 */
const READY_TIMEOUT_MS = parseInt(process.env.READY_TIMEOUT_MS || '120000');
const INVITE_TIMEOUT_MS = parseInt(process.env.INVITE_TIMEOUT_MS || '300000');
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
    // Only revert if still ready (the battle never started — i.e. at least one
    // player never picked a team / accepted the invite).
    if (!m || m.status !== 'ready') return;
    // A readied match always has both teams resolved (not a NULL bracket slot).
    if (m.homeTeamId == null || m.awayTeamId == null) return;

    db.update(schema.matches)
      .set({ status: 'scheduled', readyHome: false, readyAway: false, startedAt: null })
      .where(eq(schema.matches.id, matchId))
      .run();

    // Tear down the orphaned PS invite room (created at /cannoli-battle but never
    // started). Without this the empty invite room lingers until the bot's idle
    // sweep evicts it 30 min later.
    if (m.psRoomId) {
      try { cancelBattle(m.psRoomId); }
      catch (err) { console.error(`[arena] cancelBattle failed for ${m.psRoomId}:`, err); }
    }

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
      description: `Team selection timed out for ${matchId} — a player did not pick a team within ${INVITE_TIMEOUT_MS / 1000}s`,
      metadata: JSON.stringify({ matchId }),
    }).run();

    publishWs(`arena:match:${matchId}`, JSON.stringify({
      type: 'match_timeout',
      matchId,
      message: 'Team selection timed out — try again',
    }));
    broadcastMatchState(matchId);

    console.log(`[arena] team-selection timeout: ${matchId}`);
  }, INVITE_TIMEOUT_MS);
  readyTimers.set(matchId, handle);
}

/** Called by ps-bot when it picks up a battle for a match (transitions to in_progress). */
export function clearReadyTimerForMatch(matchId: string) {
  clearReadyTimer(matchId);
}

/**
 * Broadcaster handle for external callers (PS bot result writer, auto-forfeit
 * job). Publishes through the shared server pub/sub — returns null only when no
 * server is registered yet (boot/test before `.onStart`), so callers keep their
 * existing `if (broadcaster)` guards.
 */
export function getArenaBroadcaster(): { publish: (topic: string, data: string) => void } | null {
  if (!hasBroadcastServer()) return null;
  return { publish: (topic, data) => { publishWs(topic, data); } };
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
// Core helpers are now in lib/arena-state.ts and imported above.
// Local aliases preserve the original call sites unchanged.

const getUserTeam = _getUserTeam;
const getPlayableMatches = _getPlayableMatches;
const getCurrentMatch = _getCurrentMatch;

/**
 * Resolve which match a ready/unready action targets. When the client names
 * a specific `matchId` (coach picked a week from the selector) we honor it —
 * but only if it's one of THIS team's playable matches, so a client can't
 * touch a row it doesn't own. With no `matchId` we fall back to the
 * current-week fixture (legacy clients / default behavior).
 */
function resolveTargetMatch(teamId: string, leagueId: string, matchId?: string) {
  if (matchId) {
    return getPlayableMatches(teamId, leagueId).find(m => m.id === matchId) ?? null;
  }
  return getCurrentMatch(teamId, leagueId);
}

/** Shape a match row into the Arena client payload (adds team info + isHome). */
function buildMatchPayload(matchId: string, teamId: string, currentWeek: number) {
  const data = getMatchWithTeams(matchId);
  if (!data) return null;
  const { match, homeTeam, awayTeam } = data;
  const isPlayoff = match.phase === 'playoffs';
  return {
    matchId: match.id,
    leagueId: match.leagueId,
    week: match.week,
    // Playoffs have no "current week"; a surfaced bracket fixture is always the
    // one to play now, so mark it current for the MatchBanner / footer.
    isCurrentWeek: isPlayoff ? true : match.week === currentWeek,
    phase: match.phase,
    playoffRound: match.playoffRound,
    status: match.status,
    readyHome: match.readyHome,
    readyAway: match.readyAway,
    homeTeam: homeTeam ? { id: homeTeam.id, name: homeTeam.teamName, abbrev: homeTeam.teamAbbrev, color: homeTeam.teamColor } : null,
    awayTeam: awayTeam ? { id: awayTeam.id, name: awayTeam.teamName, abbrev: awayTeam.teamAbbrev, color: awayTeam.teamColor } : null,
    isHome: match.homeTeamId === teamId,
    psRoomId: match.psRoomId,
  };
}

function getMatchWithTeams(matchId: string) {
  const match = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get();
  if (!match) return null;

  const homeTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.homeTeamId ?? '')).get();
  const awayTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.awayTeamId ?? '')).get();

  return { match, homeTeam, awayTeam };
}

function broadcastMatchState(matchId: string, senderWs?: { send: (data: string) => void }) {
  const data = getMatchWithTeams(matchId);
  if (!data) return;

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

  publishWs(`arena:match:${matchId}`, msg);
  publishWs('arena:global', msg);
  senderWs?.send(msg);
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
  publishWs('arena:global', payload);
  // publish() excludes the sender — send directly so their UI updates too
  senderWs?.send(payload);
}

// ─── Route ──────────────────────────────────────────────────────────────────

export const arenaRoutes = new Elysia()
  .onStart((app) => { registerBroadcastServer((app as any).server); registerBotConnectionListener(); })

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

    // myMatches  — every playable fixture (any week) for the coach's team, so
    //              the Arena can offer a week picker for early/make-up battles.
    // myMatch    — the current-week fixture only (kept for the sticky
    //              MatchBanner, which nudges about the week's match).
    let myMatch = null;
    let myMatches: NonNullable<ReturnType<typeof buildMatchPayload>>[] = [];
    if (user) {
      const team = getUserTeam(parseInt(user.id));
      if (team) {
        const league = getLeague(team.leagueId);
        const currentWeek = league?.currentWeek ?? -1;
        myMatches = getPlayableMatches(team.teamId, team.leagueId)
          .map(m => buildMatchPayload(m.id, team.teamId, currentWeek))
          .filter((m): m is NonNullable<typeof m> => m !== null);
        myMatch = myMatches.find(m => m.isCurrentWeek) ?? null;
      }
    }

    const liveMatches = db.select().from(schema.matches)
      .where(eq(schema.matches.status, 'in_progress'))
      .all()
      .map(m => {
        const ht = db.select().from(schema.teams).where(eq(schema.teams.id, m.homeTeamId ?? '')).get();
        const at = db.select().from(schema.teams).where(eq(schema.teams.id, m.awayTeamId ?? '')).get();
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

    return { myMatch, myMatches, liveMatches, scrimLobbies: lobbies, botConnected: isBotConnected() };
  })

  // ─── Arena WebSocket ────────────────────────────────────────────────

  .ws('/ws/arena', {
    open(ws) {
      ws.subscribe('arena:global');

      // Initial bot-connectivity sync — sent to every connecting socket
      // (identified or not) so the Arena UI can render the bot badge and
      // gate the ready-up affordance immediately.
      ws.send(JSON.stringify({ type: 'bot_status', connected: isBotConnected() }));

      // Auto-authenticate from cookie on the upgrade request.
      // ws.data carries the upgrade Request; only `request.headers` is needed.
      const request = (ws.data as { request?: Request } | undefined)?.request;
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
        arenaClients.set(wsKey(ws), client);

        // Cancel any pending unready (player navigated, didn't drop)
        if (team) {
          const key = clientKey(client.userId, team.teamId);
          const pending = pendingUnready.get(key);
          if (pending) {
            clearTimeout(pending);
            pendingUnready.delete(key);
          }
        }

        // Subscribe to all of their playable matches (any week) so ready-state
        // updates reach them whichever week they choose to battle.
        if (team) {
          for (const match of getPlayableMatches(team.teamId, team.leagueId)) {
            ws.subscribe(`arena:match:${match.id}`);
            addSpectator(match.id, ws);
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
            arenaClients.set(wsKey(ws), client);

            if (team) {
              for (const match of getPlayableMatches(team.teamId, team.leagueId)) {
                ws.subscribe(`arena:match:${match.id}`);
                addSpectator(match.id, ws);
              }
            }

            ws.send(JSON.stringify({ type: 'identified', username: user.username, teamId: team?.teamId }));
            break;
          }

          case 'match_ready': {
            const client = arenaClients.get(wsKey(ws));
            if (!client?.teamId || !client.leagueId) {
              ws.send(JSON.stringify({ type: 'error', message: 'No team assigned' }));
              return;
            }

            const match = resolveTargetMatch(client.teamId, client.leagueId, msg.matchId);
            if (!match) {
              ws.send(JSON.stringify({ type: 'error', message: 'No match found' }));
              return;
            }

            const isHome = match.homeTeamId === client.teamId;
            const updateField = isHome ? { readyHome: true } : { readyAway: true };

            // Atomic guard: only flip ready flags if the match hasn't been
            // finalized between getCurrentMatch and now. Without this, a
            // late ready click could re-touch a completed/disputed row.
            db.update(schema.matches).set(updateField).where(and(
              eq(schema.matches.id, match.id),
              sql`status IN ('scheduled', 'ready', 'in_progress')`,
            )).run();

            // Log ready event
            db.insert(schema.matchReadyLog).values({
              matchId: match.id,
              teamId: client.teamId,
              event: 'ready',
            }).run();

            // Check if both are now ready
            const updated = db.select().from(schema.matches).where(eq(schema.matches.id, match.id)).get()!;
            if (updated.readyHome && updated.readyAway) {
              if (isBotConnected()) {
                // Bot online — flip to 'ready', stamp start, arm the timeout,
                // and instruct the bot to create the PS battle. All of this is
                // gated on connectivity so we never strand the match in 'ready'
                // with no battle behind it.
                db.update(schema.matches)
                  .set({ status: 'ready', startedAt: new Date().toISOString() })
                  .where(and(
                    eq(schema.matches.id, match.id),
                    sql`status = 'scheduled'`,
                  )).run();

                scheduleReadyTimeout(match.id);

                db.insert(schema.activityLog).values({
                  type: 'match_ready',
                  category: 'match',
                  actor: 'system',
                  leagueId: client.leagueId,
                  description: `Both teams ready for ${match.id}`,
                  metadata: JSON.stringify({ matchId: match.id }),
                }).run();

                createBattleForReadyMatch(match);
              } else {
                // Bot offline — KEEP status 'scheduled' and KEEP the ready
                // flags so the reconnect auto-resume path can pick this up.
                // Don't arm the ready-timeout (nothing is going to create the
                // battle yet). Just tell the players we're waiting on the bot.
                ws.send(JSON.stringify({
                  type: 'match_error',
                  matchId: match.id,
                  message: 'Showdown bot is offline — your match will start automatically when it reconnects.',
                }));
              }
            }

            broadcastMatchState(match.id, ws);
            break;
          }

          case 'match_unready': {
            const client = arenaClients.get(wsKey(ws));
            if (!client?.teamId || !client.leagueId) return;

            const match = resolveTargetMatch(client.teamId, client.leagueId, msg.matchId);
            if (!match || match.status === 'in_progress' || match.status === 'completed') return;

            const isHome = match.homeTeamId === client.teamId;
            const updateField = isHome ? { readyHome: false } : { readyAway: false };

            db.update(schema.matches)
              .set({ ...updateField, status: 'scheduled' })
              .where(eq(schema.matches.id, match.id)).run();
            clearReadyTimer(match.id);

            // If an invite room was already created for this not-yet-started
            // match (player unreadies mid team-selection), tear it down so we
            // don't leave an orphaned PS room behind. Clear psRoomId so a later
            // re-ready mints a fresh invite.
            if (match.psRoomId) {
              try { cancelBattle(match.psRoomId); }
              catch (err) { console.error(`[arena] cancelBattle failed for ${match.psRoomId}:`, err); }
              db.update(schema.matches)
                .set({ psRoomId: null })
                .where(eq(schema.matches.id, match.id)).run();
            }

            db.insert(schema.matchReadyLog).values({
              matchId: match.id,
              teamId: client.teamId,
              event: 'unready',
            }).run();

            broadcastMatchState(match.id, ws);
            break;
          }

          case 'scrim_create': {
            const client = arenaClients.get(wsKey(ws));
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
            const client = arenaClients.get(wsKey(ws));
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
            publishWs(`arena:scrim:${msg.lobbyId}`, JSON.stringify({
              type: 'scrim_state', lobbyId: msg.lobbyId,
              players: lobby.players, ready: lobby.ready, status: lobby.status,
            }));
            break;
          }

          case 'scrim_leave': {
            const client = arenaClients.get(wsKey(ws));
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
            const client = arenaClients.get(wsKey(ws));
            if (!client) return;

            const lobby = scrimLobbies.get(msg.lobbyId);
            if (!lobby) return;
            // Re-entry guard: once a lobby leaves 'waiting' (already firing a
            // battle), ignore further ready toggles so we never double-create
            // the scrim battle on a duplicate/late message.
            if (lobby.status !== 'waiting') return;

            const idx = lobby.players.indexOf(client.username);
            if (idx === -1) return;

            lobby.ready[idx] = true;

            // Check if both ready
            if (lobby.players.length === 2 && lobby.ready[0] && lobby.ready[1]) {
              lobby.status = 'ready';
              // Create scrim battle via bot. Scrims go through the same INVITE/
              // team-pick flow as official matches now: createBattle sends an
              // invite (both players pick a team in their native team-picker and
              // accept; the battle starts once both accept). Scrims have no DB
              // match lifecycle, so there's no in_progress transition to defer —
              // the lobby stays 'ready' and the live battle is observed once it
              // starts.
              if (isBotConnected()) {
                createBattle(lobby.players[0], lobby.players[1]);
              }
            }

            publishWs(`arena:scrim:${msg.lobbyId}`, JSON.stringify({
              type: 'scrim_state', lobbyId: msg.lobbyId,
              players: lobby.players, ready: lobby.ready, status: lobby.status,
            }));
            broadcastScrimList(ws);
            break;
          }

          case 'arena_subscribe': {
            // Subscribe to live stats for a specific match
            if (msg.matchId) {
              ws.subscribe(`arena:match:${msg.matchId}`);
              addSpectator(msg.matchId, ws);
              // Send the current count back to the new subscriber so they see
              // themselves in the count immediately (publish excludes sender).
              ws.send(JSON.stringify({
                type: 'spectator_count',
                matchId: msg.matchId,
                count: matchSpectators.get(msg.matchId)?.size ?? 0,
              }));
            }
            break;
          }

          case 'arena_unsubscribe': {
            if (msg.matchId) {
              ws.unsubscribe(`arena:match:${msg.matchId}`);
              removeSpectator(msg.matchId, ws);
            }
            break;
          }
        }
      } catch (err) {
        // Malformed message — don't crash the socket, but log at debug so the
        // failure isn't silently swallowed (this once hid the WS-IDENTITY bug).
        // Also funnel into observability — a WS throw never hits Elysia onError.
        console.debug('[arena] failed to handle WS message:', err);
        logServerFault({
          kind: 'ws',
          name: err instanceof Error ? err.name : 'WsError',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack ?? null : null,
          path: '/ws/arena',
        });
      }
    },

    close(ws) {
      removeSpectatorFromAll(ws);
      const client = arenaClients.get(wsKey(ws));
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
          // The coach may have readied any week's match — clear their ready
          // flag on every pre-battle fixture they're still marked ready on.
          for (const match of getPlayableMatches(teamId, leagueId)) {
            if (match.status !== 'scheduled' && match.status !== 'ready') continue;

            const isHome = match.homeTeamId === teamId;
            const wasReady = isHome ? match.readyHome : match.readyAway;
            if (!wasReady) continue;

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
          }
        }, UNREADY_GRACE_MS);
        pendingUnready.set(key, handle);
      }

      // Scrim-lobby cleanup runs for EVERY disconnecting client, not just
      // team owners — a teamless spectator who joined a scrim lobby would
      // otherwise leak their slot (the cleanup used to live inside the
      // `if (client?.teamId)` branch above).
      if (client) {
        let scrimChanged = false;
        for (const [lobbyId, lobby] of scrimLobbies) {
          const idx = lobby.players.indexOf(client.username);
          if (idx !== -1) {
            lobby.players.splice(idx, 1);
            lobby.ready.splice(idx, 1);
            scrimChanged = true;
            if (lobby.players.length === 0) {
              scrimLobbies.delete(lobbyId);
            }
          }
        }
        if (scrimChanged) broadcastScrimList(ws);
      }

      arenaClients.delete(wsKey(ws));
    },
  });

// ─── Bot connectivity → Arena WS + auto-resume ────────────────────────────────

/**
 * Drive every both-ready-but-never-started match forward. Called when the PS
 * bot transitions to connected so matches stranded while it was offline (kept
 * 'scheduled' with both ready flags by the match_ready handler) resume on their
 * own. Idempotent: the atomic UPDATE only flips rows still 'scheduled', so a
 * match already 'ready'/'in_progress' is left alone and never double-created.
 */
function resumeReadyMatchesOnBotReconnect() {
  const matches = findResumableReadyMatches();
  if (matches.length === 0) return;

  console.log(`[arena] bot reconnected — resuming ${matches.length} ready match(es)`);

  for (const match of matches) {
    // Atomic flip: only transition rows still 'scheduled'. `.changes` tells us
    // whether THIS call won the flip, so we don't re-create a battle for a row
    // another path already advanced.
    const res = db.update(schema.matches)
      .set({ status: 'ready', startedAt: new Date().toISOString() })
      .where(and(
        eq(schema.matches.id, match.id),
        sql`status = 'scheduled'`,
      )).run();
    if (res.changes === 0) continue;

    scheduleReadyTimeout(match.id);

    db.insert(schema.activityLog).values({
      type: 'match_ready',
      category: 'match',
      actor: 'system',
      leagueId: match.leagueId,
      description: `Auto-resumed ready match ${match.id} after bot reconnect`,
      metadata: JSON.stringify({ matchId: match.id, reason: 'bot_reconnect' }),
    }).run();

    createBattleForReadyMatch(match);
    broadcastMatchState(match.id);
  }
}

/**
 * Mirror PS-bot connectivity onto Arena clients and auto-resume stranded
 * ready matches. The listener only fires on actual connected↔disconnected
 * transitions (see ps-bot.ts). Registered from the route's `.onStart` hook
 * (not at module load) to avoid a circular-import TDZ — ps-bot.ts imports
 * from this module, so its `connectionListeners` set isn't initialized yet
 * while this module's top-level body is still evaluating.
 */
let botListenerRegistered = false;
function registerBotConnectionListener() {
  if (botListenerRegistered) return;
  botListenerRegistered = true;
  onBotConnectionChange((connected) => {
    publishWs('arena:global', JSON.stringify({ type: 'bot_status', connected }));
    if (connected) {
      try {
        resumeReadyMatchesOnBotReconnect();
      } catch (err) {
        console.error('[arena] auto-resume after bot reconnect failed:', err);
        logServerFault({
          kind: 'process',
          name: 'ArenaAutoResumeError',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack ?? null : null,
          path: '/arena/auto-resume',
        });
      }
    }
  });
}
