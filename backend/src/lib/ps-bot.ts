/**
 * Pokemon Showdown Monitor Bot.
 *
 * In-process WebSocket client that connects to the PS game server as CannoliBot.
 * Responsibilities:
 *   1. Authenticate via the login protocol
 *   2. Detect [Gen 9] NatDex Draft battles between league players
 *   3. Join as spectator, stream protocol lines to the replay parser
 *   4. Capture match results (|win|, |tie|) and write to DB
 *   5. Send /cannoli-battle to create matches when both players ready
 */

import { ReplayParser } from './replay-parser';
import { validateMatchResult } from './replay-parser';
import { toUserid, signAssertion } from './ps-login';
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import { getArenaBroadcaster, clearReadyTimerForMatch } from '../routes/arena';

// ─── Config ─────────────────────────────────────────────────────────────────

const PS_SERVER_URL = process.env.PS_SERVER_WS_URL || 'ws://localhost:8000/showdown/websocket';
const BOT_USERNAME = process.env.BOT_USERNAME || 'CannoliBot';
const BOT_PASSWORD = process.env.BOT_PASSWORD || 'cannolibot';

// ─── State ──────────────────────────────────────────────────────────────────

interface MonitoredBattle {
  roomId: string;
  matchId: string | null; // null for scrims / unmatched battles
  p1: string; // userid
  p2: string; // userid
  format: string;
  parser: ReplayParser;
  lines: string[]; // full log accumulator
  isOfficial: boolean;
}

let ws: WebSocket | null = null;
let connected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let challstr: string | null = null;

const monitoredBattles = new Map<string, MonitoredBattle>();

interface BotState {
  connected: boolean;
  authedAs: string | null;
  reconnectAttempts: number;
  lastEventAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

const botState: BotState = {
  connected: false,
  authedAs: null,
  reconnectAttempts: 0,
  lastEventAt: null,
  lastError: null,
  lastErrorAt: null,
};

function bump() { botState.lastEventAt = new Date().toISOString(); }
function recordError(msg: string) {
  botState.lastError = msg;
  botState.lastErrorAt = new Date().toISOString();
  console.error(`[PS Bot] ${msg}`);
}

export function getBotStatus(): {
  connected: boolean;
  authedAs: string | null;
  reconnectAttempts: number;
  lastEventAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  monitoredBattles: { roomId: string; matchId: string | null; p1: string; p2: string }[];
  health: 'green' | 'yellow' | 'red';
} {
  let health: 'green' | 'yellow' | 'red' = 'red';
  if (botState.connected) {
    const idleMs = botState.lastEventAt
      ? Date.now() - new Date(botState.lastEventAt).getTime()
      : Infinity;
    health = idleMs < 60_000 ? 'green' : 'yellow';
  }
  return {
    connected: botState.connected,
    authedAs: botState.authedAs,
    reconnectAttempts: botState.reconnectAttempts,
    lastEventAt: botState.lastEventAt,
    lastError: botState.lastError,
    lastErrorAt: botState.lastErrorAt,
    monitoredBattles: Array.from(monitoredBattles.values()).map(b => ({
      roomId: b.roomId,
      matchId: b.matchId,
      p1: b.p1,
      p2: b.p2,
    })),
    health,
  };
}

// Map showdown userids → team IDs for match lookup
const useridToTeam = new Map<string, { teamId: string; leagueId: string }>();

// ─── Public API ─────────────────────────────────────────────────────────────

export function startBot() {
  refreshUserMap();
  connect();
}

export function stopBot() {
  clearTimeout(reconnectTimer);
  ws?.close();
  ws = null;
  connected = false;
}

export function isBotConnected(): boolean {
  return connected;
}

/**
 * Send a command to the PS server (e.g., to create a battle).
 */
export function sendToPs(message: string) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(message);
  }
}

/**
 * Create a battle between two players via the /cannoli-battle command.
 */
export function createBattle(p1Username: string, p2Username: string, format: string = 'gen9natdexdraft') {
  sendToPs(`|/cannoli-battle ${p1Username}, ${p2Username}, ${format}`);
}

// ─── Connection ─────────────────────────────────────────────────────────────

function connect() {
  if (ws?.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(PS_SERVER_URL);
  } catch (err) {
    console.error('[PS Bot] Failed to create WebSocket:', err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[PS Bot] Connected to PS server');
    connected = true;
    botState.connected = true;
    botState.reconnectAttempts = 0;
    bump();
  };

  ws.onmessage = (event) => {
    const data = typeof event.data === 'string' ? event.data : '';
    bump();
    handleMessage(data);
  };

  ws.onclose = () => {
    console.log('[PS Bot] Disconnected');
    connected = false;
    botState.connected = false;
    botState.authedAs = null;
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    recordError('WebSocket error');
    ws?.close();
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  // Exponential backoff capped at 60s
  const delay = Math.min(60_000, 5000 * Math.pow(1.5, botState.reconnectAttempts));
  botState.reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    console.log(`[PS Bot] Reconnecting (attempt ${botState.reconnectAttempts})...`);
    connect();
  }, delay);
}

// ─── Message Handling ───────────────────────────────────────────────────────

function handleMessage(raw: string) {
  const lines = raw.split('\n');

  // Determine room context
  let room = '';
  if (lines[0]?.startsWith('>')) {
    room = lines[0].slice(1);
    lines.shift();
  }

  for (const line of lines) {
    if (!line) continue;

    // Global messages (no room context)
    if (!room) {
      handleGlobalLine(line);
      continue;
    }

    // Room-specific messages
    if (room.startsWith('battle-')) {
      handleBattleLine(room, line);
    }
  }
}

function handleGlobalLine(line: string) {
  const parts = line.split('|');
  const cmd = parts[1];

  switch (cmd) {
    case 'challstr': {
      // |challstr|KEYID|CHALLENGE
      challstr = parts.slice(2).join('|');
      authenticate();
      break;
    }

    case 'updateuser': {
      // |updateuser|USERNAME|NAMED|AVATAR
      const named = parts[3] === '1';
      if (named) {
        botState.authedAs = parts[2];
        console.log(`[PS Bot] Authenticated as ${parts[2]}`);
      }
      break;
    }

    case 'formats': {
      // Formats list received — bot is ready
      console.log('[PS Bot] Received formats, bot is ready');
      break;
    }

    case 'updatesearch':
    case 'queryresponse':
      break;

    default:
      // Check for battle init in rooms we need to monitor
      break;
  }
}

function handleBattleLine(room: string, line: string) {
  const parts = line.split('|');
  const cmd = parts[1];

  // Check if this is a new battle we should monitor
  if (cmd === 'init' && parts[2] === 'battle') {
    // We'll get player info shortly, start tracking
    if (!monitoredBattles.has(room)) {
      // Don't monitor yet — wait for |player| lines to determine if it's a league match
      monitoredBattles.set(room, {
        roomId: room,
        matchId: null,
        p1: '',
        p2: '',
        format: '',
        parser: new ReplayParser(),
        lines: [],
        isOfficial: false,
      });
    }
    return;
  }

  const battle = monitoredBattles.get(room);

  // If we're not monitoring this room yet, check if we should join
  if (!battle) {
    // We get notified about battles we're not in via |init| after joining
    // For rooms we haven't joined, we won't get messages — the bot must
    // actively join rooms it wants to monitor
    return;
  }

  // Accumulate log
  battle.lines.push(line);
  battle.parser.feedLine(line);

  switch (cmd) {
    case 'player': {
      // |player|p1|USERNAME|AVATAR|RATING
      const side = parts[2]; // p1 or p2
      const username = parts[3];
      if (side === 'p1') battle.p1 = toUserid(username);
      if (side === 'p2') battle.p2 = toUserid(username);

      // Once we have both players, check if this is a league match
      if (battle.p1 && battle.p2 && !battle.matchId) {
        checkForOfficialMatch(battle);
      }
      break;
    }

    case 'tier': {
      battle.format = parts[2] || '';
      break;
    }

    case 'win': {
      const winner = parts[2];
      handleMatchEnd(battle, winner);
      break;
    }

    case 'tie': {
      handleMatchEnd(battle, null);
      break;
    }
  }

  // Broadcast live stats to Arena clients
  if (battle.matchId || battle.isOfficial) {
    broadcastLiveStats(battle);
  }
}

// ─── Match Detection ────────────────────────────────────────────────────────

function checkForOfficialMatch(battle: MonitoredBattle) {
  const team1 = useridToTeam.get(battle.p1);
  const team2 = useridToTeam.get(battle.p2);

  if (!team1 || !team2) return;

  // Look for a 'ready' match between these two teams
  const match = db.select().from(schema.matches)
    .where(eq(schema.matches.status, 'ready'))
    .all()
    .find(m =>
      (m.homeTeamId === team1.teamId && m.awayTeamId === team2.teamId) ||
      (m.homeTeamId === team2.teamId && m.awayTeamId === team1.teamId),
    );

  if (match) {
    battle.matchId = match.id;
    battle.isOfficial = true;

    // Update match with PS room ID and status
    db.update(schema.matches)
      .set({
        status: 'in_progress',
        psRoomId: battle.roomId,
        startedAt: new Date().toISOString(),
      })
      .where(eq(schema.matches.id, match.id))
      .run();

    // Log to activity
    db.insert(schema.activityLog).values({
      type: 'match_started',
      category: 'match',
      actor: BOT_USERNAME,
      leagueId: match.leagueId,
      description: `Match started: ${battle.roomId}`,
      metadata: JSON.stringify({ matchId: match.id, psRoomId: battle.roomId, p1: battle.p1, p2: battle.p2 }),
    }).run();

    console.log(`[PS Bot] Official match detected: ${match.id} → ${battle.roomId}`);
    clearReadyTimerForMatch(match.id);
  }
}

// ─── Match Result ───────────────────────────────────────────────────────────

function handleMatchEnd(battle: MonitoredBattle, winnerUsername: string | null) {
  const result = battle.parser.getResult();

  console.log(`[PS Bot] Battle ended: ${battle.roomId} — winner: ${winnerUsername ?? 'tie'}`);

  if (battle.matchId) {
    // Official match — save to DB
    const match = db.select().from(schema.matches)
      .where(eq(schema.matches.id, battle.matchId))
      .get();

    if (match) {
      const homeTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.homeTeamId)).get();
      const awayTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.awayTeamId)).get();

      // Determine scores
      let homeScore = 0;
      let awayScore = 0;
      if (winnerUsername) {
        const winnerUserid = toUserid(winnerUsername);
        const homeUserid = homeTeam?.showdownUsername ? toUserid(homeTeam.showdownUsername) : null;
        if (winnerUserid === homeUserid || winnerUserid === battle.p1 && match.homeTeamId === (useridToTeam.get(battle.p1)?.teamId)) {
          homeScore = result.winnerScore;
          awayScore = result.loserScore;
        } else {
          homeScore = result.loserScore;
          awayScore = result.winnerScore;
        }
      }

      // Update match record
      db.update(schema.matches)
        .set({
          status: 'completed',
          homeScore,
          awayScore,
          completedAt: new Date().toISOString(),
          replayLog: battle.lines.join('\n'),
          replayUrl: `/replay/${battle.roomId.replace('battle-', '')}`,
        })
        .where(eq(schema.matches.id, battle.matchId))
        .run();

      // Write per-Pokemon K/D stats
      for (const mon of result.pokemon) {
        const side = mon.player;
        const teamId = side === 'p1'
          ? (useridToTeam.get(battle.p1)?.teamId || match.homeTeamId)
          : (useridToTeam.get(battle.p2)?.teamId || match.awayTeamId);

        if (mon.appeared) {
          db.insert(schema.matchPokemon).values({
            matchId: battle.matchId,
            teamId,
            pokemonName: mon.species,
            kills: mon.kills,
            deaths: mon.deaths,
            teraUsed: mon.teraUsed,
            teraType: mon.teraType,
          }).run();
        }
      }

      // Run validation
      if (homeTeam && awayTeam) {
        const homeRoster = db.select().from(schema.rosters).where(eq(schema.rosters.teamId, homeTeam.id)).all();
        const awayRoster = db.select().from(schema.rosters).where(eq(schema.rosters.teamId, awayTeam.id)).all();

        const warnings = validateMatchResult(
          result,
          homeRoster.map(r => ({ pokemonName: r.pokemonName, isTeraCaptain: r.isTeraCaptain })),
          awayRoster.map(r => ({ pokemonName: r.pokemonName, isTeraCaptain: r.isTeraCaptain })),
          homeTeam.teamAbbrev,
          awayTeam.teamAbbrev,
        );

        if (warnings.length > 0) {
          db.update(schema.matches)
            .set({ warnings: JSON.stringify(warnings) })
            .where(eq(schema.matches.id, battle.matchId))
            .run();
        }
      }

      // Activity log
      db.insert(schema.activityLog).values({
        type: 'match_completed',
        category: 'match',
        actor: BOT_USERNAME,
        leagueId: match.leagueId,
        description: `Match completed: ${homeTeam?.teamAbbrev ?? '?'} ${homeScore}-${awayScore} ${awayTeam?.teamAbbrev ?? '?'}`,
        metadata: JSON.stringify({ matchId: battle.matchId, homeScore, awayScore, winner: winnerUsername }),
      }).run();

      // Broadcast result to Arena
      const broadcaster = getArenaBroadcaster();
      if (broadcaster) {
        broadcaster.publish(`arena:match:${battle.matchId}`, JSON.stringify({
          type: 'match_result',
          matchId: battle.matchId,
          winner: winnerUsername,
          score: [homeScore, awayScore],
        }));
      }
    }
  }

  // Cleanup
  monitoredBattles.delete(battle.roomId);
}

// ─── Live Stats Broadcasting ────────────────────────────────────────────────

function broadcastLiveStats(battle: MonitoredBattle) {
  const broadcaster = getArenaBroadcaster();
  if (!broadcaster) return;

  const stats = battle.parser.getLiveStats();
  const matchId = battle.matchId || battle.roomId;

  broadcaster.publish(`arena:match:${matchId}`, JSON.stringify({
    type: 'arena_stats',
    matchId,
    stats,
  }));
}

// ─── Auth ───────────────────────────────────────────────────────────────────

function authenticate() {
  if (!challstr) return;

  const userid = toUserid(BOT_USERNAME);
  const assertion = signAssertion(challstr, userid);

  if (assertion) {
    sendToPs(`|/trn ${BOT_USERNAME},0,${assertion}`);
  } else {
    recordError('Failed to sign assertion — check PS_RSA_PRIVATE_KEY');
  }
}

// ─── User Map ───────────────────────────────────────────────────────────────

/**
 * Build a map from showdown userids → team IDs.
 * Called on startup and can be refreshed when rosters change.
 */
export function refreshUserMap() {
  useridToTeam.clear();

  const teams = db.select({
    id: schema.teams.id,
    leagueId: schema.teams.leagueId,
    showdownUsername: schema.teams.showdownUsername,
    userId: schema.teams.userId,
  }).from(schema.teams).all();

  for (const team of teams) {
    if (team.showdownUsername) {
      useridToTeam.set(toUserid(team.showdownUsername), { teamId: team.id, leagueId: team.leagueId });
    }
    // Also map by user account username
    if (team.userId) {
      const user = db.select().from(schema.users).where(eq(schema.users.id, team.userId)).get();
      if (user) {
        useridToTeam.set(toUserid(user.username), { teamId: team.id, leagueId: team.leagueId });
      }
    }
  }

  console.log(`[PS Bot] User map loaded: ${useridToTeam.size} players`);
}
