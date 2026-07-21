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
import { resolveRosterPokemonName } from './pokedex';
import { broughtSidesFromResult } from './brought-preview';
import { toUserid, signAssertion } from './ps-login';
import { getLeagueCostFormat } from './league-costs';
import { db, schema } from '../db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { getArenaBroadcaster, clearReadyTimerForMatch, handleScrimBattleFailed, broadcastMatchState } from '../routes/arena';
import { runAutoAwards } from './pins/auto-award';
import { tx } from './tx';
import { advancePlayoffWinner } from './playoff-advance';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

// ─── Config ─────────────────────────────────────────────────────────────────

const PS_SERVER_URL = process.env.PS_SERVER_WS_URL || 'ws://localhost:8000/showdown/websocket';
const BOT_USERNAME = process.env.BOT_USERNAME || 'CannoliBot';
const BOT_PASSWORD = process.env.BOT_PASSWORD || 'cannolibot';

/**
 * Public host for the PS sim/replay viewer (no scheme/path).
 * Used to build replay URLs that resolve to the actual Showdown viewer at
 * `https://{host}/{roomId}` instead of a Cannoli-relative `/replay/...` path
 * that would 404 against the wrong origin.
 */
const PS_PUBLIC_HOST =
  (process.env.PS_PUBLIC_URL || process.env.SHOWDOWN_URL || 'https://sim.cannoli.live')
    .replace(/\/+$/, '');

/**
 * Root directory PS writes autosaved replays to (relative paths resolved
 * against the backend cwd at boot). Used for the disk-replay fallback when a
 * match completes while the bot is offline. Default points at the in-repo
 * Showdown checkout for dev convenience; production should set PS_LOGS_DIR
 * to wherever the PS server volume is mounted (see deploy/README.md).
 */
const PS_LOGS_DIR = resolve(
  process.env.PS_LOGS_DIR || './showdown/server/logs',
);

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
  /**
   * Which PS side (p1 / p2) the Cannoli HOME team is playing as for this
   * match. PS picks p1/p2 by challenge order — independent of how Cannoli
   * recorded the matchup — so without this lookup ~half of all matches get
   * home/away swapped both in the Arena HUD and in match_pokemon.teamId.
   * `null` until both `|player|` lines arrive AND we map them to a known
   * matchup (or the bot rejoins an in-progress room with a known psRoomId).
   */
  homeSide: 'p1' | 'p2' | null;
  /** Epoch ms of the last protocol line appended. Used for idle eviction. */
  lastLineAt: number;
  /**
   * Which PS sides have actually JOINED the battle (a `|player|p{N}|USERNAME`
   * line with a NON-EMPTY username). For the invite flow the room is created
   * with both slots empty + invited; PS emits `|player|p1|` (empty) for an
   * unfilled slot and re-emits it with the username once a player picks a team
   * and accepts. Battle-start = both sides in this set. Distinct from p1/p2,
   * which are pre-seeded from the creation PM for orientation/display.
   */
  joinedSides: Set<'p1' | 'p2'>;
}

let ws: WebSocket | null = null;
let connected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let challstr: string | null = null;

// ─── Send queue ───────────────────────────────────────────────────────────────
// Messages that arrive while the socket is not OPEN are buffered here and flushed
// in order from the onopen handler. Prevents lost |/join and |/cannoli-battle
// commands across reconnect windows. Bounded at SEND_QUEUE_CAP (FIFO eviction).
const SEND_QUEUE_CAP = 100;
const sendQueue: string[] = [];

function flushSendQueue() {
  while (sendQueue.length > 0 && ws?.readyState === WebSocket.OPEN) {
    const msg = sendQueue.shift()!;
    ws.send(msg);
  }
}

// ─── Staleness reconnect ─────────────────────────────────────────────────────
// If the socket claims OPEN but no inbound line has arrived within this window,
// assume the connection is dead and force-reconnect. PS emits traffic
// continuously, so 90s of total silence is a reliable dead-connection signal.
// Set to 0 to disable (tests / offline dev).
const STALENESS_THRESHOLD_MS = 90_000;
let lastInboundAt: number = Date.now();
let stalenessTimer: ReturnType<typeof setInterval> | undefined;

// ─── Connection-change listeners ──────────────────────────────────────────────
// Decoupled hook so other modules (e.g. the Arena route) can react to the bot
// going connected↔disconnected WITHOUT this file importing arena/topic
// specifics. Listeners fire on each transition, after `connected` is updated.
type ConnectionListener = (connected: boolean) => void;
const connectionListeners = new Set<ConnectionListener>();

export function onBotConnectionChange(cb: ConnectionListener): () => void {
  connectionListeners.add(cb);
  return () => connectionListeners.delete(cb);
}

function notifyConnectionChange(next: boolean) {
  for (const cb of connectionListeners) {
    try {
      cb(next);
    } catch (err) {
      console.error('[PS Bot] connection-change listener threw:', err);
    }
  }
}

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

/**
 * Expose the internal monitoredBattles map for testing only.
 * Do not use in production code.
 */
export function getMonitoredBattlesForTest() {
  return monitoredBattles;
}

// ─── Idle-battle eviction ────────────────────────────────────────────────────

/**
 * Sweep `monitoredBattles` for entries whose last protocol line is older than
 * `maxIdleMs`. Exported as a pure function so tests can call it directly with
 * a synthetic `now` without relying on real time. The live process schedules
 * this on a background interval (see `startIdleSweep`).
 *
 * Targets:
 *   - Scrim battles (matchId:null) where the PS room was abandoned.
 *   - Official battles that connected while the bot was in a bad state and
 *     never received |win|/|tie|.
 *   - Any entry that simply stopped receiving lines.
 *
 * The normal completion path (|win|/|tie| → handleMatchEnd) deletes entries
 * synchronously, so this sweep only catches entries that never completed.
 */
export function sweepIdleBattles(
  now: number = Date.now(),
  maxIdleMs: number = 30 * 60 * 1000,
): number {
  let evicted = 0;
  for (const [roomId, battle] of monitoredBattles) {
    if (now - battle.lastLineAt > maxIdleMs) {
      console.log(
        `[PS Bot] Evicting idle battle ${roomId} (idle ${Math.round((now - battle.lastLineAt) / 60_000)}m, matchId=${battle.matchId ?? 'null'})`,
      );
      monitoredBattles.delete(roomId);
      evicted++;
    }
  }
  return evicted;
}

let idleSweepTimer: ReturnType<typeof setInterval> | undefined;

function startIdleSweep() {
  if (idleSweepTimer) return; // already running
  idleSweepTimer = setInterval(() => sweepIdleBattles(), 5 * 60 * 1000);
  // unref() so this timer never prevents the process from exiting cleanly
  // and doesn't keep the Bun test runner alive.
  idleSweepTimer.unref();
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function startBot() {
  refreshUserMap();
  connect();
  startIdleSweep();
  startStalenessTimer();
}

export function stopBot() {
  clearTimeout(reconnectTimer);
  stopStalenessTimer();
  ws?.close();
  ws = null;
  connected = false;
}

/**
 * Force-reconnect: tear down the existing socket, reset reconnect-attempt
 * counters, then reconnect. Used by the admin "force reconnect" button.
 */
export function restartBot() {
  stopBot();
  botState.reconnectAttempts = 0;
  botState.lastError = null;
  botState.lastErrorAt = null;
  startBot();
}

export function isBotConnected(): boolean {
  return connected;
}

/**
 * Send a command to the PS server (e.g., to create a battle).
 * When the socket is not OPEN, the message is buffered in sendQueue and flushed
 * automatically once the connection is re-established (onopen).
 */
export function sendToPs(message: string) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(message);
  } else {
    if (sendQueue.length >= SEND_QUEUE_CAP) {
      const dropped = sendQueue.shift();
      console.warn(`[PS Bot] Send-queue cap (${SEND_QUEUE_CAP}) reached — dropped oldest: ${dropped?.slice(0, 80)}`);
    }
    sendQueue.push(message);
  }
}

/**
 * Create a battle between two players via the /cannoli-battle command.
 * When matchId is provided, it is forwarded to the PS plugin so the resulting
 * PM carries a 6th field that lets handleBotPm link the room deterministically
 * without inference (backward-compatible — the 5-field form still works if the
 * PS fork hasn't been rebuilt yet).
 */
export function createBattle(p1Username: string, p2Username: string, format: string = 'gen9natdexdraft', matchId?: string) {
  const cmd = matchId
    ? `|/cannoli-battle ${p1Username}, ${p2Username}, ${format}, ${matchId}`
    : `|/cannoli-battle ${p1Username}, ${p2Username}, ${format}`;
  sendToPs(cmd);
}

/**
 * Cancel a pending invite battle that never started. With the invite flow the
 * PS plugin creates the room with both player slots empty + invited, so a room
 * can linger if a player never picks a team / accepts. This tells the plugin to
 * tear that room down (`/cannoli-cancel <roomId>`) and drops our local monitor
 * entry if present. Used by the Arena ready-timeout and unready paths to clean
 * up orphaned rooms. Safe to call for an unknown room (the command is a no-op
 * server-side and the map delete is a no-op).
 */
export function cancelBattle(roomId: string) {
  sendToPs(`|/cannoli-cancel ${roomId}`);
  monitoredBattles.delete(roomId);
}

/** Expose send queue for test assertions only. */
export function getSendQueueForTest() { return sendQueue; }

/**
 * Feed a raw inbound protocol chunk through the same dispatch the live
 * `ws.onmessage` uses (room-prefix strip → global/battle line routing). Test
 * ONLY — lets specs exercise the PM-link + battle-start lifecycle against the
 * DB without booting a socket. Do not use in production code.
 */
export function handleMessageForTest(raw: string) {
  handleMessage(raw);
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
    lastInboundAt = Date.now();
    const wasConnected = connected;
    connected = true;
    botState.connected = true;
    botState.reconnectAttempts = 0;
    bump();
    if (!wasConnected) notifyConnectionChange(true);
    // Flush messages queued while the socket was down.
    flushSendQueue();
  };

  ws.onmessage = (event) => {
    const data = typeof event.data === 'string' ? event.data : '';
    lastInboundAt = Date.now();
    bump();
    handleMessage(data);
  };

  ws.onclose = () => {
    console.log('[PS Bot] Disconnected');
    const wasConnected = connected;
    connected = false;
    botState.connected = false;
    botState.authedAs = null;
    ws = null;
    stopStalenessTimer();
    if (wasConnected) notifyConnectionChange(false);
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

function startStalenessTimer() {
  if (stalenessTimer) return;
  if (!STALENESS_THRESHOLD_MS) return; // disabled
  stalenessTimer = setInterval(() => {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
    const idleMs = Date.now() - lastInboundAt;
    if (idleMs > STALENESS_THRESHOLD_MS) {
      console.warn(`[PS Bot] No inbound traffic for ${Math.round(idleMs / 1000)}s — assuming dead connection, reconnecting`);
      recordError(`Staleness reconnect after ${Math.round(idleMs / 1000)}s of silence`);
      ws.close();
    }
  }, 15_000);
  stalenessTimer.unref();
}

function stopStalenessTimer() {
  if (stalenessTimer) { clearInterval(stalenessTimer); stalenessTimer = undefined; }
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
      // Re-attach to any in-progress battles whose results were lost when the
      // bot was offline. Without this, a mid-battle crash never sees |win|.
      rejoinInProgressBattles();
      break;
    }

    case 'pm': {
      // |pm|SENDER|RECEIVER|MESSAGE
      // The chat plugin signals new battles via:
      //   cannoli-battle-created|<roomid>|<p1>|<p2>|<format>
      // Sender will be `~Cannoli` (system identity from cannoli.ts).
      const sender = parts[2] || '';
      const message = parts.slice(4).join('|');
      handleBotPm(sender, message);
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

/**
 * Handle a PM directed at the bot. Currently only listens for the
 * `cannoli-battle-created` signal from our chat plugin.
 */
function handleBotPm(sender: string, message: string) {
  // Sender is in `±name` form (group prefix + identity). Strip the prefix.
  const senderId = toUserid(sender);
  // Only honour signals from the system identity injected by cannoli.ts.
  if (senderId !== 'cannoli') return;

  if (message.startsWith('cannoli-battle-failed|')) {
    // cannoli-battle-failed|<reason>|<p1userid>|<p2userid>
    // Sent by the PS plugin when it can't find a player or create the room.
    // Notify the Arena so the scrim lobby can be reverted and the players
    // see an error rather than being stuck in a permanent 'ready' hang.
    const parts = message.split('|');
    const reason = parts[1] || 'unknown error';
    const p1 = parts[2] ? toUserid(parts[2]) : '';
    const p2 = parts[3] ? toUserid(parts[3]) : '';
    console.warn(`[PS Bot] Battle creation failed — ${reason} (${p1} vs ${p2})`);
    try {
      handleScrimBattleFailed(p1, p2, reason);
    } catch (err) {
      console.error('[PS Bot] handleScrimBattleFailed threw:', err);
    }
    return;
  }

  if (!message.startsWith('cannoli-battle-created|')) return;

  // 5-field (old, no matchId): cannoli-battle-created|roomId|p1|p2|format
  // 6-field (new, with matchId): cannoli-battle-created|roomId|p1|p2|format|matchId
  // BACKWARD COMPATIBILITY: the old 5-field form must keep working — the PS
  // server fork is deployed independently and may still emit it until rebuilt.
  const parts = message.split('|');
  const [, roomId, p1, p2, format, pmMatchId] = parts;
  if (!roomId) return;

  if (!monitoredBattles.has(roomId)) {
    const p1uid = toUserid(p1 || '');
    const p2uid = toUserid(p2 || '');
    const entry: MonitoredBattle = {
      roomId,
      matchId: null,
      p1: p1uid,
      p2: p2uid,
      format: format || '',
      parser: new ReplayParser(),
      lines: [],
      isOfficial: false,
      homeSide: null,
      lastLineAt: Date.now(),
      joinedSides: new Set(),
    };
    monitoredBattles.set(roomId, entry);

    // Deterministic matchId link: when the PS plugin forwarded a matchId, link
    // without inference. Validate the match exists and is in a pre-final status.
    //
    // INVITE FLOW: the plugin now creates the room with both player slots EMPTY +
    // INVITED — the battle has NOT started yet (each player must pick a team in
    // their native team-picker and accept). So we ONLY record the psRoomId here
    // and link the room → match; we do NOT flip the match to in_progress and do
    // NOT clear the ready-timeout. The in_progress transition happens later in
    // handleBattleLine once BOTH players have accepted (joined the battle). The
    // ready-timeout (extended to the team-pick window in arena.ts) stays armed so
    // a player who never picks a team triggers a proper revert + room cancel.
    if (pmMatchId && pmMatchId.trim()) {
      const matchRow = db.select().from(schema.matches)
        .where(eq(schema.matches.id, pmMatchId.trim()))
        .get();
      if (matchRow && matchRow.status !== 'completed' && matchRow.status !== 'disputed') {
        entry.matchId = matchRow.id;
        entry.isOfficial = true;
        const p1TeamId = useridToTeam.get(p1uid)?.teamId;
        const p2TeamId = useridToTeam.get(p2uid)?.teamId;
        entry.homeSide =
          p1TeamId === matchRow.homeTeamId ? 'p1'
            : p2TeamId === matchRow.homeTeamId ? 'p2'
              : null;
        // Record the room id only — leave status as-is ('scheduled'/'ready').
        const linkRes = db.update(schema.matches)
          .set({ psRoomId: roomId })
          .where(and(
            eq(schema.matches.id, matchRow.id),
            inArray(schema.matches.status, ['scheduled', 'ready']),
          ))
          .run();
        console.log(`[PS Bot] Deterministic match link (invite pending): ${matchRow.id} → ${roomId}`);

        // Tell the Arena the psRoomId landed. Without this, myMatches[].psRoomId
        // stays null for the whole team-pick window — the only OTHER broadcast
        // carrying psRoomId is match_live, which fires later once both players
        // have joined — so the frontend's "pick your team in Showdown" state
        // (gated on psRoomId, see official-match.tsx) can never render and the
        // coach is stuck on the "sending team-select invite..." spinner until
        // match_live or the 5-minute ready-timeout. match_state already carries
        // psRoomId and the frontend already applies it — reuse that broadcast
        // as-is rather than inventing a new event shape.
        if (linkRes.changes > 0) {
          try { broadcastMatchState(matchRow.id); }
          catch (err) { console.error('[PS Bot] broadcastMatchState failed:', err); }
        }
      } else if (!matchRow) {
        console.warn(`[PS Bot] PM matchId ${pmMatchId} not found — falling back to inference`);
      }
    }

    // Inference fallback (old 5-field PM, or matchId lookup failed).
    if (!entry.matchId && entry.p1 && entry.p2) {
      checkForOfficialMatch(entry);
    }
  }

  // Join the battle room so PS routes its protocol lines to us.
  console.log(`[PS Bot] Joining ${roomId} (signalled by chat plugin)`);
  sendToPs(`|/join ${roomId}`);
}

/**
 * Extract format slug from a PS room id. `battle-gen9natdexdraft-12345` →
 * `gen9natdexdraft`. Returns null if the id doesn't match the expected shape.
 */
export function formatFromRoomId(roomId: string): string | null {
  const m = /^battle-([a-z0-9]+)-\d+(?:-\w+)?$/.exec(roomId);
  return m ? m[1] : null;
}

/** Resolved root directory PS writes autosaved replays to (re-exported for the
 *  replay-archive lib so it doesn't recompute the env/default logic). */
export function getPsLogsDir(): string {
  return PS_LOGS_DIR;
}

/**
 * Parse a single `{roomId}.log.json` file and return its `log: string[]`,
 * or null if the file is missing / unreadable / has no log array.
 */
export function parseReplayLogFile(path: string): string[] | null {
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as { log?: string[] };
    if (Array.isArray(parsed.log)) return parsed.log;
  } catch (err) {
    console.warn(`[PS Bot] Failed to read replay ${path}:`, err);
  }
  return null;
}

/**
 * Bounded recursive search for a file literally named `{roomId}.log.json`
 * under `dir`. Used as a safety net when the deterministic scan misses (e.g.
 * a non-standard layout). `maxDepth` caps the descent so we never walk the
 * whole PS logs tree — a stray giant directory can't hang the request.
 * Returns the first matching path found, or null.
 */
function findReplayFileRecursive(dir: string, fileNames: string[], maxDepth: number): string | null {
  if (maxDepth < 0) return null;
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  // Files first — a hit at this level wins before we descend.
  for (const e of entries) {
    if (e.isFile() && fileNames.includes(e.name)) return join(dir, e.name);
  }
  // Descend newest-first. Date dirs (YYYY-MM / YYYY-MM-DD) sort lexicographically,
  // so a reverse sort walks the most recent first — matching the deterministic
  // scan's intent. Without an explicit sort we'd inherit raw readdir order, which
  // is filesystem-dependent (fine locally, wrong on other filesystems) and could
  // return an OLDER replay when the same room id exists under several dates.
  const subdirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
    .reverse();
  for (const name of subdirs) {
    const hit = findReplayFileRecursive(join(dir, name), fileNames, maxDepth - 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * Locate the on-disk path of a saved replay log for `roomId`. PS autosaves
 * every battle's protocol log to:
 *   {PS_LOGS_DIR}/{YYYY-MM}/{tier}/{YYYY-MM-DD}/{roomId}.log.json
 * where `tier` is the format id (e.g. `gen9natdexdraft`). Confirmed in
 * showdown/server/server/room-battle.ts and showdown/monitor.ts.
 *
 * We don't know the date a-priori (a match could span midnight or have been
 * abandoned days ago), so we walk the year-month and day dirs newest-first so
 * the common case (a recent match) hits almost immediately, then fall back to a
 * bounded recursive search. Returns the absolute path, or null if not found.
 *
 * Shared by `readReplayLogFromDisk` (parsed `log[]`) and the replay-archive lib
 * (raw bytes for download) so the locate strategy lives in exactly one place.
 */
export function locateReplayFile(
  roomId: string,
  rootDir: string = PS_LOGS_DIR,
): string | null {
  const tier = formatFromRoomId(roomId);
  if (!tier) return null;

  if (!existsSync(rootDir)) {
    console.warn(`[PS Bot] PS_LOGS_DIR not found: ${rootDir} — disk-replay fallback disabled`);
    return null;
  }

  // PS names the file by the REPLAY id — the room id with the "battle-" prefix
  // stripped — e.g. room "battle-gen9natdexdraft-78" → "gen9natdexdraft-78.log.json".
  // Accept both forms so callers can pass either the room id or the replay id.
  const fileNames = Array.from(new Set([
    `${roomId}.log.json`,
    `${roomId.replace(/^battle-/, '')}.log.json`,
  ]));

  // ── Deterministic scan: {YYYY-MM}/{tier}/{YYYY-MM-DD}/{replayId}.log.json ──
  // List year-month dirs, newest first.
  let monthDirs: string[];
  try {
    monthDirs = readdirSync(rootDir).filter(d => /^\d{4}-\d{2}$/.test(d)).sort().reverse();
  } catch (err) {
    console.warn(`[PS Bot] Failed to scan ${rootDir}:`, err);
    monthDirs = [];
  }

  for (const month of monthDirs) {
    const tierDir = join(rootDir, month, tier);
    if (!existsSync(tierDir)) continue;

    // Day dirs under this month/tier, newest first.
    let dayDirs: string[];
    try {
      dayDirs = readdirSync(tierDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
    } catch (err) {
      console.warn(`[PS Bot] Failed to scan ${tierDir}:`, err);
      continue;
    }

    for (const day of dayDirs) {
      for (const fileName of fileNames) {
        const candidate = join(tierDir, day, fileName);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  // ── Safety fallback: bounded recursive search for the named file. ──
  // Catches non-standard layouts the deterministic scan can't anticipate.
  // Depth 4 covers {YYYY-MM}/{tier}/{YYYY-MM-DD}/{file} plus a little slack.
  return findReplayFileRecursive(rootDir, fileNames, 4);
}

/**
 * Look for a saved replay log on disk and return its parsed `log: string[]`,
 * or null if not found / unreadable. Thin wrapper over `locateReplayFile`.
 */
export function readReplayLogFromDisk(
  roomId: string,
  rootDir: string = PS_LOGS_DIR,
): string[] | null {
  const path = locateReplayFile(roomId, rootDir);
  if (!path) return null;
  return parseReplayLogFile(path);
}

/**
 * Replay a finished battle from disk through the regular completion path.
 * Used when the bot was offline at the moment a match's `|win|` was emitted —
 * the live room has been torn down, but PS persists the protocol to disk
 * (autosavereplays = true).
 *
 * Synthesizes a MonitoredBattle (so handleMatchEnd's branching just works),
 * feeds every line through the parser, then routes the final result to the
 * normal handler. Idempotent against already-completed matches because
 * handleMatchEnd guards on `battle.matchId` and our caller filters on
 * `status='in_progress'`.
 */
/**
 * Synthesize a MonitoredBattle from a match row + the raw protocol lines of a
 * saved replay, feeding every line through the parser. Captures |player| lines
 * to populate battle.p1/p2, |win|/|tie| to determine the result, and resolves
 * battle.homeSide so handleMatchEnd attributes home/away correctly.
 *
 * Returns the synthesized battle plus the resolved result. `winnerUsername` is
 * null on a tie; `hasResult` is false when the log never reached |win|/|tie|
 * (abandoned mid-game) — callers should NOT record such a battle.
 *
 * Shared by replayFromDisk (offline recovery) and importBattleForMatch (admin
 * import of a played battle).
 */
function buildBattleFromLog(
  match: { id: string; homeTeamId: string | null; awayTeamId: string | null },
  roomId: string,
  lines: string[],
): { battle: MonitoredBattle; winnerUsername: string | null; hasResult: boolean } {
  const homeTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.homeTeamId ?? '')).get();
  const awayTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.awayTeamId ?? '')).get();
  const p1Userid = teamPsUserid(homeTeam);
  const p2Userid = teamPsUserid(awayTeam);

  const battle: MonitoredBattle = {
    roomId,
    matchId: match.id,
    p1: p1Userid,
    p2: p2Userid,
    format: '',
    parser: new ReplayParser(),
    lines: [],
    isOfficial: true,
    lastLineAt: Date.now(),
    homeSide: null,
    joinedSides: new Set(),
  };

  // Replay every line through the parser. We also accumulate lines into
  // battle.lines so the persisted replayLog matches what live capture would
  // have stored.
  let winnerUsername: string | null = null;
  let isTie = false;
  for (const line of lines) {
    battle.lines.push(line);
    battle.parser.feedLine(line);
    if (line.startsWith('|win|')) {
      winnerUsername = line.slice('|win|'.length).split('|')[0].trim();
    } else if (line === '|tie' || line.startsWith('|tie|')) {
      // Match a real tie line only — the standard `|tier|...` battle-log line
      // also starts with `|tie` and must NOT be read as a tie.
      isTie = true;
    } else if (line.startsWith('|player|')) {
      // |player|p1|USERNAME|... — captures usernames into battle.p1/p2 the
      // same way the live path does, so handleMatchEnd's userid math works.
      const parts = line.split('|');
      const side = parts[2];
      const username = parts[3];
      if (side === 'p1' && username) battle.p1 = toUserid(username);
      if (side === 'p2' && username) battle.p2 = toUserid(username);
    }
  }

  // Resolve orientation now that |player| lines have populated battle.p1/p2.
  battle.homeSide =
    useridToTeam.get(battle.p1)?.teamId === match.homeTeamId ? 'p1'
      : useridToTeam.get(battle.p2)?.teamId === match.homeTeamId ? 'p2'
        : null;

  return { battle, winnerUsername, hasResult: !!winnerUsername || isTie };
}

function replayFromDisk(match: { id: string; homeTeamId: string | null; awayTeamId: string | null; psRoomId: string | null }): boolean {
  const roomId = match.psRoomId;
  if (!roomId) return false;

  const lines = readReplayLogFromDisk(roomId);
  if (!lines || lines.length === 0) return false;

  const { battle, winnerUsername, hasResult } = buildBattleFromLog(match, roomId, lines);

  if (!hasResult) {
    // Replay was saved but never reached |win|/|tie| — match was abandoned
    // mid-game on the PS server. Don't auto-complete; leave for admin review.
    console.log(`[PS Bot] Disk replay for ${match.id} has no |win|/|tie| — skipping`);
    return false;
  }

  console.log(`[PS Bot] Recovering ${match.id} from disk replay (${roomId})`);
  handleMatchEnd(battle, winnerUsername);
  return true;
}

/**
 * Normalize a possibly-messy room id into a bare `battle-...` room id.
 * Accepts a full URL (`https://sim.cannoli.live/battle-gen9natdexdraft-12345`),
 * a leading-slash path (`/battle-...`), or an already-bare id — strips
 * scheme/host/leading slash and trims whitespace.
 */
export function normalizeRoomId(raw: string): string {
  let id = (raw ?? '').trim();
  // Strip scheme + host if a full URL was pasted.
  const urlMatch = /^[a-z]+:\/\/[^/]+\/(.+)$/i.exec(id);
  if (urlMatch) id = urlMatch[1];
  // Strip any leading slashes (path form).
  id = id.replace(/^\/+/, '').trim();
  return id;
}

/**
 * Result of an admin "import battle" attempt. `ok: false` carries an HTTP
 * status the route maps onto `set.status`.
 *
 * On `ok: true`:
 *  - `sidesUncertain` — auto-detection could not confidently resolve which PS
 *    side is the Cannoli home team (userid not in useridToTeam). The UI should
 *    surface a side-assignment picker pre-filled with `detectedP1` / `detectedP2`
 *    so the admin can confirm or flip before the result is finalized. When a
 *    `sideOverride` was passed the resolution is authoritative and this is false.
 *  - `detectedP1` / `detectedP2` — the Showdown usernames parsed from the replay
 *    `|player|` lines, exposed so the UI can label the override picker.
 */
export type ImportBattleResult =
  | {
      ok: true;
      homeScore: number;
      awayScore: number;
      winnerTeamId: string | null;
      status: string;
      pokemonCount: number;
      /** True when the home/away orientation was guessed (userid not found). */
      sidesUncertain: boolean;
      /** PS username for p1 side, as parsed from the replay. */
      detectedP1: string;
      /** PS username for p2 side, as parsed from the replay. */
      detectedP2: string;
    }
  | { ok: false; error: string; status: number };

/**
 * Import a finished battle (played outside the normal Arena flow) into a
 * scheduled match: read its saved replay from disk and route it through the
 * regular completion path (handleMatchEnd writes scores, winnerTeamId,
 * replayLog/Url, per-Pokemon K/D, validation, and awards).
 *
 * Modeled on replayFromDisk but takes an EXPLICIT matchId + a (possibly URL/
 * messy) roomId, and returns a structured result for the admin route. Will not
 * overwrite an already-finalized match (v1 — use force-result for that).
 */
/**
 * @param sideOverride  Admin-supplied mapping override when auto-detection is
 *   wrong or uncertain. `'p1IsHome'` means p1 is the Cannoli home team;
 *   `'p2IsHome'` means p2 is. `null` (default) uses auto-detection via
 *   `useridToTeam`. Only used when provided — it takes precedence over the
 *   auto-detected `battle.homeSide`.
 */
export function importBattleForMatch(
  matchId: string,
  roomId: string,
  sideOverride: 'p1IsHome' | 'p2IsHome' | null = null,
): ImportBattleResult {
  const match = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get();
  if (!match) return { ok: false, error: 'Match not found', status: 404 };

  // Don't clobber a finalized match — mirrors handleMatchEnd's no-clobber
  // guard (which would otherwise silently no-op). Overwrite is out of scope.
  if (match.status === 'completed' || match.status === 'disputed' || (match.status as string) === 'cancelled') {
    return { ok: false, error: `Match already ${match.status}; use force-result to override`, status: 409 };
  }

  const normalizedRoomId = normalizeRoomId(roomId);
  const lines = readReplayLogFromDisk(normalizedRoomId);
  if (!lines || lines.length === 0) {
    return { ok: false, error: 'No saved replay found for that room id', status: 404 };
  }

  const { battle, winnerUsername, hasResult } = buildBattleFromLog(match, normalizedRoomId, lines);

  if (!hasResult) {
    return {
      ok: false,
      error: 'Replay has no result (|win|/|tie|) — battle may be unfinished/abandoned',
      status: 422,
    };
  }

  // Apply side override when supplied — this is authoritative and overrides the
  // auto-detected battle.homeSide from useridToTeam. Lets admins correct a
  // reversed orientation without voiding and re-importing.
  const sidesUncertain = !sideOverride && battle.homeSide === null;
  if (sideOverride) {
    battle.homeSide = sideOverride === 'p1IsHome' ? 'p1' : 'p2';
  } else if (battle.homeSide === null) {
    // Auto-detection failed — fall back to p1=home as a best guess. The
    // sidesUncertain flag is returned so the UI can ask the admin to confirm.
    battle.homeSide = 'p1';
  }

  // Capture detected player names before handleMatchEnd mutates/cleans up.
  const detectedP1 = battle.p1;
  const detectedP2 = battle.p2;

  console.log(`[PS Bot] Importing battle ${normalizedRoomId} into match ${matchId}${sidesUncertain ? ' (sides uncertain — defaulting p1=home)' : ''}`);
  // handleMatchEnd does all recording; the match isn't completed so its
  // no-clobber guard passes.
  handleMatchEnd(battle, winnerUsername);

  // Re-read the now-recorded match for the authoritative scores/winner/status
  // (handleMatchEnd may have flipped status to 'disputed' on validation warnings).
  const updated = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get();
  const pokemonCount = db.select().from(schema.matchPokemon)
    .where(eq(schema.matchPokemon.matchId, matchId))
    .all().length;

  return {
    ok: true,
    homeScore: updated?.homeScore ?? 0,
    awayScore: updated?.awayScore ?? 0,
    winnerTeamId: updated?.winnerTeamId ?? null,
    status: updated?.status ?? 'completed',
    pokemonCount,
    sidesUncertain,
    detectedP1,
    detectedP2,
  };
}

/**
 * Pull the raw PS protocol lines out of a user-supplied "replay" blob. League
 * battles aren't on the backend's disk, so an admin pastes/uploads the replay
 * itself. We accept the three shapes a replay realistically arrives in, tried
 * in order:
 *   1. A downloaded PS replay `.html` — the protocol log lives in the inner
 *      text of `<script type="text/plain" class="battle-log-data"> … </script>`.
 *   2. JSON with a `log` field (e.g. `{roomId}.log.json`) — `log` is either a
 *      single newline-joined string or an array of lines.
 *   3. Raw protocol text — the lines pasted straight out of a battle room.
 *
 * Returns the protocol lines (split on `\n`), or null if nothing that looks
 * like a PS log (a line starting with `|`) can be found.
 */
export function extractReplayLogLines(replay: string): string[] | null {
  const raw = (replay ?? '').trim();
  if (!raw) return null;

  let lines: string[] | null = null;

  // ── 1. PS replay HTML ──
  const htmlMatch = /<script[^>]*class="battle-log-data"[^>]*>([\s\S]*?)<\/script>/.exec(raw);
  if (htmlMatch) {
    lines = htmlMatch[1].split('\n');
  }

  // ── 2. JSON with a `log` field ──
  if (!lines) {
    try {
      const parsed = JSON.parse(raw) as { log?: unknown };
      if (typeof parsed.log === 'string') {
        lines = parsed.log.split('\n');
      } else if (Array.isArray(parsed.log)) {
        lines = parsed.log.map(l => String(l));
      }
    } catch {
      // not JSON — fall through to raw-protocol handling
    }
  }

  // ── 3. Raw protocol text ──
  if (!lines && raw.split('\n').some(l => l.startsWith('|'))) {
    lines = raw.split('\n');
  }

  if (!lines) return null;

  // Trim a stray trailing `</script>` (or other closing tag) off the last
  // protocol line — pasted/over-matched HTML can leave one dangling.
  if (lines.length > 0) {
    const last = lines.length - 1;
    lines[last] = lines[last].replace(/<\/?[a-z][^>]*>\s*$/i, '').trimEnd();
  }

  // A real PS log always contains at least one `|`-prefixed line.
  if (!lines.some(l => l.startsWith('|'))) return null;

  return lines;
}

/**
 * Import a finished battle into a scheduled match from a REPLAY the admin
 * supplies (downloaded `.html`, a `.log.json`, or raw protocol text), rather
 * than from a disk autosave. Mirrors importBattleForMatch but sources its
 * lines via extractReplayLogLines. Used for league battles that never touched
 * this backend's disk.
 *
 * @param sideOverride  Admin-supplied mapping when auto-detection is wrong or
 *   uncertain. `'p1IsHome'` = p1 is home; `'p2IsHome'` = p2 is home.
 *   `null` = auto-detect. When uncertain, falls back to p1=home and sets
 *   `sidesUncertain: true` on the result so the UI can ask the admin to confirm.
 */
export function importBattleFromReplay(
  matchId: string,
  replay: string,
  sideOverride: 'p1IsHome' | 'p2IsHome' | null = null,
): ImportBattleResult {
  const match = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get();
  if (!match) return { ok: false, error: 'Match not found', status: 404 };

  // Don't clobber a finalized match — same guard as importBattleForMatch.
  if (match.status === 'completed' || match.status === 'disputed' || (match.status as string) === 'cancelled') {
    return { ok: false, error: `Match already ${match.status}; use force-result to override`, status: 409 };
  }

  const lines = extractReplayLogLines(replay);
  if (!lines || lines.length === 0) {
    return { ok: false, error: 'Could not find a battle log in that replay', status: 422 };
  }

  const { battle, winnerUsername, hasResult } = buildBattleFromLog(match, 'imported-replay', lines);

  if (!hasResult) {
    return {
      ok: false,
      error: 'Replay has no result (|win|/|tie|) — battle may be unfinished',
      status: 422,
    };
  }

  // Apply side override when supplied — authoritative, overrides auto-detected homeSide.
  const sidesUncertain = !sideOverride && battle.homeSide === null;
  if (sideOverride) {
    battle.homeSide = sideOverride === 'p1IsHome' ? 'p1' : 'p2';
  } else if (battle.homeSide === null) {
    // Auto-detection failed — fall back to p1=home as a best guess.
    battle.homeSide = 'p1';
  }

  const detectedP1 = battle.p1;
  const detectedP2 = battle.p2;

  console.log(`[PS Bot] Importing replay into match ${matchId} (${lines.length} lines)${sidesUncertain ? ' — sides uncertain, defaulting p1=home' : ''}`);
  // handleMatchEnd does all recording; the match isn't finalized so its
  // no-clobber guard passes.
  handleMatchEnd(battle, winnerUsername);

  // Re-read the now-recorded match for authoritative scores/winner/status
  // (handleMatchEnd may have flipped status to 'disputed' on validation warnings).
  const updated = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get();
  const pokemonCount = db.select().from(schema.matchPokemon)
    .where(eq(schema.matchPokemon.matchId, matchId))
    .all().length;

  return {
    ok: true,
    homeScore: updated?.homeScore ?? 0,
    awayScore: updated?.awayScore ?? 0,
    winnerTeamId: updated?.winnerTeamId ?? null,
    status: updated?.status ?? 'completed',
    pokemonCount,
    sidesUncertain,
    detectedP1,
    detectedP2,
  };
}

/**
 * On bot reconnect, re-join any battle rooms we were observing before the
 * disconnect. Matches stuck in `in_progress` with a known psRoomId can be
 * rescued; matches in `ready` without a psRoomId have to time out and retry.
 *
 * Two passes:
 *   1. Try to /join each room — if PS still has it open, the bot resumes
 *      observing live and the |win| we missed will come through naturally
 *      (PS replays the room state to spectators on join).
 *   2. For any in_progress matches still NOT in the live monitored set after
 *      the join sweep, fall back to reading the autosaved replay log from
 *      disk and replaying it through the same completion path.
 */
function rejoinInProgressBattles() {
  const open = db.select().from(schema.matches)
    .where(eq(schema.matches.status, 'in_progress'))
    .all()
    .filter(m => !!m.psRoomId);

  for (const match of open) {
    const roomId = match.psRoomId!;
    if (monitoredBattles.has(roomId)) continue;

    // Disk-replay fallback first: PS only autosaves `{roomId}.log.json` once
    // the battle is over (`|win|` / `|tie|`). If a log file exists, the room
    // is gone — there's nothing to /join and the result would be lost
    // forever without this path. Replay from disk through the standard
    // completion handler.
    if (replayFromDisk(match)) continue;

    // Restore state. The replay parser starts blank — we won't recover anything
    // that happened while the bot was offline, but we can still record |win|.
    const homeTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.homeTeamId ?? '')).get();
    const awayTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.awayTeamId ?? '')).get();
    const p1 = teamPsUserid(homeTeam);
    const p2 = teamPsUserid(awayTeam);

    // Orientation: compare each PS userid to the home team's mapping.
    // p1 mapped to homeTeamId → home plays p1; otherwise home plays p2.
    // (If neither player maps to the home team — e.g. team had no PS username
    // recorded — fall back to null and let the bot resolve once |player|
    // lines arrive.)
    const p1Team = p1 ? useridToTeam.get(p1)?.teamId : null;
    const p2Team = p2 ? useridToTeam.get(p2)?.teamId : null;
    const homeSide: 'p1' | 'p2' | null =
      p1Team === match.homeTeamId ? 'p1'
        : p2Team === match.homeTeamId ? 'p2'
          : null;

    monitoredBattles.set(roomId, {
      roomId,
      matchId: match.id,
      p1, p2,
      format: '',
      parser: new ReplayParser(),
      lines: [],
      isOfficial: true,
      homeSide,
      lastLineAt: Date.now(),
      joinedSides: new Set(),
    });

    console.log(`[PS Bot] Rejoining ${roomId} for match ${match.id}`);
    sendToPs(`|/join ${roomId}`);
  }
}

function handleBattleLine(room: string, line: string) {
  const parts = line.split('|');
  const cmd = parts[1];

  // Check if this is a new battle we should monitor.
  // For league matches, the chat plugin pre-registers via PM before we get
  // here — don't clobber that state. For ad-hoc battles (e.g. scrims that
  // happen to share the lobby), still set up a fallback entry.
  if (cmd === 'init' && parts[2] === 'battle') {
    if (!monitoredBattles.has(room)) {
      monitoredBattles.set(room, {
        roomId: room,
        matchId: null,
        p1: '',
        p2: '',
        format: '',
        parser: new ReplayParser(),
        lines: [],
        isOfficial: false,
        homeSide: null,
        lastLineAt: Date.now(),
        joinedSides: new Set(),
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

  // Accumulate log (cap at 4096 lines to bound memory for pathological/abandoned battles)
  if (battle.lines.length < 4096) battle.lines.push(line);
  battle.lastLineAt = Date.now();
  battle.parser.feedLine(line);

  switch (cmd) {
    case 'player': {
      // |player|p1|USERNAME|AVATAR|RATING
      // Invite flow: an unfilled slot arrives as `|player|p1|` (empty username);
      // once a player picks a team and accepts, PS (re-)emits it WITH a username.
      // Only a non-empty username counts as that side having JOINED.
      const side = parts[2]; // p1 or p2
      const username = parts[3];
      const joinedSide = side === 'p1' || side === 'p2' ? side : null;
      if (joinedSide && username) {
        battle[joinedSide] = toUserid(username);
        battle.joinedSides.add(joinedSide);
      }

      const bothJoined = battle.joinedSides.has('p1') && battle.joinedSides.has('p2');
      if (bothJoined && !battle.matchId) {
        // 5-field PM / pure-inference path: resolve the match now AND, since
        // both players have joined, flip it to in_progress (checkForOfficialMatch
        // does the flip itself when it links a match).
        checkForOfficialMatch(battle);
      } else if (bothJoined && battle.matchId) {
        // Deterministic-link path: the room was linked at PM time (psRoomId
        // recorded, status left pre-start). Both players have now accepted the
        // invite and joined the battle — THIS is battle-start, so transition the
        // match to in_progress.
        transitionMatchToInProgress(battle);
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

// ─── Tera Preview ───────────────────────────────────────────────────────────

/**
 * A team's league Tera Captains (rosters.isTeraCaptain), each with the
 * roster-assigned ALLOWED tera types (teraType1/2/3 — up to 3, freely
 * switchable per league rules; not a single fixed type). Entries with no
 * type assigned yet are dropped — nothing useful to preview for them.
 */
function getTeraCaptains(teamId: string): { pokemon: string; types: string[] }[] {
  const roster = db.select().from(schema.rosters).where(eq(schema.rosters.teamId, teamId)).all();
  return roster
    .filter(r => r.isTeraCaptain)
    .map(r => ({
      pokemon: r.pokemonName,
      types: [r.teraType1, r.teraType2, r.teraType3].filter((t): t is string => !!t),
    }))
    .filter(c => c.types.length > 0);
}

/**
 * Post a Cannoli-authored tera-captain preview into the battle room once both
 * players have joined. Cannoli battles are created via the native invite flow
 * (see ps/cannoli.ts) — each player brings their OWN saved Showdown team,
 * which essentially never has a `teraType` set on any set, so PS's built-in
 * "X's Tera Types:" team-preview line renders as empty separators
 * ("caleb's Tera Types: /////" — feedback #49). We own the real intended
 * data (rosters.teraType1/2/3, the up-to-3 allowed types per league Tera
 * Captain), so post our own corrected line via the `/cannoli-tera-preview`
 * plugin command instead of trying to inject into the player's PS team (which
 * doesn't exist yet at battle-creation time — it's chosen later, client-side,
 * when the player accepts the invite).
 *
 * Called once from transitionMatchToInProgress, right as the match flips to
 * in_progress (both players just joined — team preview is imminent/underway
 * server-side). No-op if either userid doesn't map to a known team, or if
 * neither team has a tera captain with a type assigned yet.
 */
function sendTeraPreview(battle: MonitoredBattle) {
  const p1Team = useridToTeam.get(battle.p1);
  const p2Team = useridToTeam.get(battle.p2);
  if (!p1Team || !p2Team) return;

  const p1Captains = getTeraCaptains(p1Team.teamId);
  const p2Captains = getTeraCaptains(p2Team.teamId);
  if (!p1Captains.length && !p2Captains.length) return;

  sendToPs(`${battle.roomId}|/cannoli-tera-preview ${JSON.stringify(p1Captains)}|${JSON.stringify(p2Captains)}`);
}

// ─── Match Detection ────────────────────────────────────────────────────────

function checkForOfficialMatch(battle: MonitoredBattle) {
  const team1 = useridToTeam.get(battle.p1);
  const team2 = useridToTeam.get(battle.p2);

  if (!team1 || !team2) {
    // Fix 7 — could be a regular scrim, or could be a renamed coach whose new
    // PS userid no longer maps to a team. Log to activity_log with type
    // `bot_unmatched_battle` so admins can spot rename patterns. Only log when
    // the battle's format looks like a Cannoli draft format (contains 'draft')
    // to avoid drowning admins in scrim noise; if format is unknown, log
    // unconditionally with a clear message.
    const fmt = (battle.format || '').toLowerCase();
    const looksLikeCannoliFormat = fmt.includes('draft') || fmt === '';
    if (looksLikeCannoliFormat) {
      db.insert(schema.activityLog).values({
        type: 'bot_unmatched_battle',
        category: 'match',
        actor: BOT_USERNAME,
        leagueId: 'system',
        description: `Unmatched battle: ${battle.p1} vs ${battle.p2} in ${battle.roomId}`,
        metadata: JSON.stringify({
          roomId: battle.roomId,
          p1: battle.p1,
          p2: battle.p2,
          format: battle.format,
          hasTeam1: !!team1,
          hasTeam2: !!team2,
          note: 'Investigate only if this is a league-format battle (possible PS rename)',
        }),
      }).run();
    }
    return;
  }

  // Fix 6 — load the league so we can prefer matches at the current week, and
  // gate on league.paused / league.phase (Fix 11). useridToTeam maps each
  // userid to a single team; if the two teams disagree on leagueId, pick
  // team1's league (best we can do without ambiguity).
  const leagueId = team1.leagueId;
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  if (!league) return;

  // Fix 11 — skip writes for paused leagues and leagues not in regular/playoffs.
  if (league.paused) return;
  if (league.phase !== 'regular' && league.phase !== 'playoffs') return;

  // Look for 'ready' matches between these two teams.
  const candidates = db.select().from(schema.matches)
    .where(eq(schema.matches.status, 'ready'))
    .all()
    .filter(m =>
      (m.homeTeamId === team1.teamId && m.awayTeamId === team2.teamId) ||
      (m.homeTeamId === team2.teamId && m.awayTeamId === team1.teamId),
    );

  // Fix 6 — prefer the match at league.currentWeek; fall back to the earliest
  // ready week (likely a make-up). Log a warning when falling back.
  let match = candidates.find(m => m.week === league.currentWeek);
  if (!match && candidates.length > 0) {
    const sorted = [...candidates].sort((a, b) => a.week - b.week);
    match = sorted[0];
    console.warn(
      `[PS Bot] No 'ready' match at week ${league.currentWeek} for ${team1.teamId} vs ${team2.teamId} — falling back to week ${match.week} (likely make-up)`,
    );
  }

  if (match) {
    battle.matchId = match.id;
    battle.isOfficial = true;
    // Resolve home/away orientation now that we know which Cannoli match this
    // battle corresponds to. team1 == home → p1 is home; team2 == home → p2.
    battle.homeSide =
      team1.teamId === match.homeTeamId ? 'p1'
        : team2.teamId === match.homeTeamId ? 'p2'
          : null;

    console.log(`[PS Bot] Official match detected: ${match.id} → ${battle.roomId}`);

    // This path only runs once BOTH |player| lines have arrived (the caller
    // guards on battle.p1 && battle.p2), so the battle has started — flip the
    // match to in_progress now.
    transitionMatchToInProgress(battle);
  }
}

/**
 * Transition a linked match to `in_progress` at BATTLE START — i.e. once both
 * players have joined the invite battle by picking a team and accepting. This is
 * deferred from PM time (where we only record psRoomId) because the invite-flow
 * room exists before either player has picked a team.
 *
 * Idempotent: the write-race guard only advances rows still in a pre-start
 * status, so a duplicate |player| line or a concurrent path can't double-flip.
 * No-ops unless the battle has a linked matchId and BOTH players are present.
 */
function transitionMatchToInProgress(battle: MonitoredBattle) {
  if (!battle.matchId) return;
  if (!battle.joinedSides.has('p1') || !battle.joinedSides.has('p2')) return;

  const match = db.select().from(schema.matches)
    .where(eq(schema.matches.id, battle.matchId))
    .get();
  // Only fire battle-start while the match is still pre-start. If it's already
  // in_progress (e.g. a second |player| line) or finalized, do nothing.
  if (!match || (match.status !== 'scheduled' && match.status !== 'ready')) return;

  // Update match with PS room ID and status. Write-race guard: only advance if
  // the match is still in a pre-start state.
  db.update(schema.matches)
    .set({
      status: 'in_progress',
      psRoomId: battle.roomId,
      startedAt: new Date().toISOString(),
    })
    .where(and(
      eq(schema.matches.id, match.id),
      inArray(schema.matches.status, ['scheduled', 'ready']),
    ))
    .run();

  // Post Cannoli's own tera-captain preview now that team preview is
  // imminent/underway server-side — see sendTeraPreview doc (feedback #49).
  sendTeraPreview(battle);

  // Log to activity
  db.insert(schema.activityLog).values({
    type: 'match_started',
    category: 'match',
    actor: BOT_USERNAME,
    leagueId: match.leagueId,
    description: `Match started: ${battle.roomId}`,
    metadata: JSON.stringify({ matchId: match.id, psRoomId: battle.roomId, p1: battle.p1, p2: battle.p2 }),
  }).run();

  // Tell Arena clients the match just went live. `match_live` is the FE event
  // (use-arena-websocket.ts) that flips the row to in_progress and stamps the
  // room id; without it a readied coach sits on the "Both ready — starting
  // match..." spinner until the next live-stats tick or a manual reload.
  // Publish on the per-match channel (HUD) and arena:global (myMatches list).
  const liveBroadcaster = getArenaBroadcaster();
  if (liveBroadcaster) {
    const liveMsg = JSON.stringify({ type: 'match_live', matchId: match.id, psRoomId: battle.roomId });
    liveBroadcaster.publish(`arena:match:${match.id}`, liveMsg);
    liveBroadcaster.publish('arena:global', liveMsg);
  }

  clearReadyTimerForMatch(match.id);
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

    // Capture the (narrowed) match id — the tx() closure below loses the
    // `if (battle.matchId)` narrowing, so refer to `matchId` inside it.
    const matchId = battle.matchId;

    if (match) {
      // Fix 2 — never overwrite a finalized match. Auto-forfeit may have
      // already written status='completed' with a 0-0 score; the bot's
      // delayed parse must not silently rewrite that.
      if (match.status === 'completed' || match.status === 'disputed' || match.status === 'cancelled') {
        console.log(`[PS Bot] Skipping result write for ${battle.matchId}: match already ${match.status}`);
        db.insert(schema.activityLog).values({
          type: 'bot_result_skipped',
          category: 'match',
          actor: BOT_USERNAME,
          leagueId: match.leagueId,
          description: `Bot result skipped — match already ${match.status} (${battle.roomId})`,
          metadata: JSON.stringify({
            matchId: battle.matchId,
            prevStatus: match.status,
            roomId: battle.roomId,
            p1: battle.p1,
            p2: battle.p2,
          }),
        }).run();
        monitoredBattles.delete(battle.roomId);
        return;
      }

      const homeTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.homeTeamId ?? '')).get();
      const awayTeam = db.select().from(schema.teams).where(eq(schema.teams.id, match.awayTeamId ?? '')).get();

      // Determine scores. Use the resolved orientation (battle.homeSide) when
      // available — this is the single source of truth for which PS side
      // corresponds to the Cannoli home team. Fall back to the older
      // username-comparison heuristic only if orientation never resolved
      // (team rosters with no PS username, etc.).
      let homeScore = 0;
      let awayScore = 0;
      // Winner is decided by the Showdown |win| flag, NOT the KO differential.
      // A forfeit/timeout at full health emits equal KO scores (e.g. 2-2) but a
      // real winner — winnerTeamId captures it so standings credit the W/L
      // correctly even when home_score == away_score.
      let winnerTeamId: string | null = null;
      if (winnerUsername) {
        const winnerUserid = toUserid(winnerUsername);
        const homeSide = battle.homeSide;
        const homeIsP1 = homeSide === 'p1'
          || (homeSide === null && useridToTeam.get(battle.p1)?.teamId === match.homeTeamId);
        const homeWon = homeIsP1
          ? winnerUserid === battle.p1
          : winnerUserid === battle.p2;
        if (homeWon) {
          homeScore = result.winnerScore;
          awayScore = result.loserScore;
          winnerTeamId = match.homeTeamId;
        } else {
          homeScore = result.loserScore;
          awayScore = result.winnerScore;
          winnerTeamId = match.awayTeamId;
        }
      }

      // Cap replayLog at 1 MB. This was 256 KB, but the |win|/|tie| line lives
      // at the END of the log, so a long best-of / 6v6 battle exceeding 256 KB
      // had its result clipped off the in-site replay viewer. 1 MB clears any
      // realistic singles battle; the canonical full log still lives at
      // replayUrl, so truncation remains recoverable.
      const replayLog = battle.lines.join('\n');
      const MAX_REPLAY_LOG = 1024 * 1024;
      const truncatedLog = replayLog.length > MAX_REPLAY_LOG
        ? replayLog.slice(0, MAX_REPLAY_LOG) + '\n[...truncated]'
        : replayLog;

      // Resolve which PS side is the home team (same logic the K/D loop uses
      // below). Used to cache the full brought team-of-6 per side so replay
      // cards can render benched mons that never appeared in battle. Only
      // meaningful when both teams are resolved (real official match).
      const homeSideResolved: 'p1' | 'p2' = battle.homeSide
        ?? (useridToTeam.get(battle.p1)?.teamId === match.homeTeamId ? 'p1' : 'p2');
      const broughtPreview = (match.homeTeamId && match.awayTeamId)
        ? JSON.stringify(broughtSidesFromResult(result, homeSideResolved))
        : null;

      // All result writes run in ONE transaction so a mid-write crash can't
      // leave a `completed` match with partial/zero match_pokemon rows — this
      // brings the bot path to parity with recordMatchResult. (The body is kept
      // at its existing indentation to keep this a minimal, reviewable diff.)
      tx(() => {
      // Update match record. Write-race guard: only write if the match is still
      // in a pre-completion state (prevents a double-write from a late disk-replay
      // or a concurrent admin force-result from clobbering an already-finalized row).
      db.update(schema.matches)
        .set({
          status: 'completed',
          homeScore,
          awayScore,
          winnerTeamId,
          completedAt: new Date().toISOString(),
          replayLog: truncatedLog,
          broughtPreview,
          // Build an absolute URL that resolves to the public sim host's
          // replay viewer. PS exposes battle rooms at `https://{host}/{roomId}`
          // — this works whether or not the room was explicitly /savereplay'd
          // because the live battle URL persists for spectators. For an
          // imported replay there is no live room id, so leave replayUrl null
          // rather than minting a bogus `/{imported-replay}` link.
          replayUrl: battle.roomId === 'imported-replay'
            ? null
            : `${PS_PUBLIC_HOST}/${battle.roomId}`,
        })
        .where(and(
          eq(schema.matches.id, matchId),
          inArray(schema.matches.status, ['scheduled', 'ready', 'in_progress']),
        ))
        .run();

      // Write per-Pokemon K/D stats. Attribute by orientation, not by raw
      // p1/p2 → home/away mapping. The previous code used useridToTeam, which
      // is correct ONLY when the userid maps cleanly back; if it didn't (stale
      // mapping, name change), the fallback `match.homeTeamId` for p1 was
      // wrong half the time. With battle.homeSide resolved at match start,
      // we deterministically know which PS side is home.
      // Delete-before-insert so a re-run (admin re-import, disk-replay recovery)
      // can never duplicate match_pokemon rows — mirrors recordMatchResult.
      db.delete(schema.matchPokemon)
        .where(eq(schema.matchPokemon.matchId, matchId))
        .run();

      // Cache each team's drafted roster names once so a battle-log mon name
      // resolves to its exact roster slot (Mega/Primal + in-battle transforms).
      const rosterNameCache = new Map<string, string[]>();
      const rosterNamesFor = (teamId: string): string[] => {
        let names = rosterNameCache.get(teamId);
        if (!names) {
          names = db.select({ name: schema.rosters.pokemonName })
            .from(schema.rosters)
            .where(eq(schema.rosters.teamId, teamId))
            .all()
            .map(r => r.name);
          rosterNameCache.set(teamId, names);
        }
        return names;
      };

      for (const mon of result.pokemon) {
        const side = mon.player;
        const homeSide = battle.homeSide
          ?? (useridToTeam.get(battle.p1)?.teamId === match.homeTeamId ? 'p1' : 'p2');
        const teamId = side === homeSide ? match.homeTeamId : match.awayTeamId;
        if (teamId == null) continue; // both teams resolved for a real battle

        if (mon.appeared) {
          db.insert(schema.matchPokemon).values({
            matchId,
            teamId,
            // Resolve to the team's exact drafted roster name so per-Pokemon K/D
            // JOINs to the roster entry (handles "Altaria-Mega" → "Mega Altaria"
            // and in-battle transforms like "Palafin-Hero" → "Palafin").
            pokemonName: resolveRosterPokemonName(rosterNamesFor(teamId), mon.species),
            kills: mon.kills,
            deaths: mon.deaths,
            teraUsed: mon.teraUsed,
            teraType: mon.teraType,
          }).run();
        }
      }

      // Run validation. Fix 5 — when BLOCKING warnings exist, flip status to
      // 'disputed' so the match is excluded from standings/playoffs gating.
      // Warn-only findings (warnOnly: true — format_mismatch, banned_move, etc.)
      // are stored on the match row for admin visibility but must NOT flip status
      // to disputed; the match proceeds as completed. The manual handler does the
      // same; bot-flagged matches must not sneak through on blocking issues.
      // Fix 1 — only fire per-match auto-awards when no BLOCKING warnings; for a
      // disputed match we wait for dismiss-warnings to mint awards.
      let hasWarnings = false;
      if (homeTeam && awayTeam) {
        const homeRoster = db.select().from(schema.rosters).where(eq(schema.rosters.teamId, homeTeam.id)).all();
        const awayRoster = db.select().from(schema.rosters).where(eq(schema.rosters.teamId, awayTeam.id)).all();

        const homeSide = battle.homeSide
          ?? (useridToTeam.get(battle.p1)?.teamId === match.homeTeamId ? 'p1' : 'p2');
        const warnings = validateMatchResult(
          result,
          homeRoster.map(r => ({ pokemonName: r.pokemonName, isTeraCaptain: r.isTeraCaptain })),
          awayRoster.map(r => ({ pokemonName: r.pokemonName, isTeraCaptain: r.isTeraCaptain })),
          homeTeam.teamAbbrev,
          awayTeam.teamAbbrev,
          homeSide,
          // Per-league move/ability/item legality is keyed by the league's cost
          // format ('natdex' | 'natdexplus'). Wired through so the LEAGUE_BANNED_*
          // maps take effect the moment they're populated (currently empty stubs).
          getLeagueCostFormat(match.leagueId),
        );

        // Partition warnings: blocking ones flip to disputed; warn-only ones are
        // stored for audit but do not change match status.
        const blockingWarnings = warnings.filter(w => !w.warnOnly);
        if (warnings.length > 0) {
          // Always persist all warnings (blocking + warn-only) for admin review.
          // Only set disputed when blocking issues exist.
          if (blockingWarnings.length > 0) {
            hasWarnings = true;
            db.update(schema.matches)
              .set({ warnings: JSON.stringify(warnings), status: 'disputed' })
              .where(eq(schema.matches.id, matchId))
              .run();
          } else {
            // Warn-only: store warnings but keep status = completed.
            db.update(schema.matches)
              .set({ warnings: JSON.stringify(warnings) })
              .where(eq(schema.matches.id, matchId))
              .run();
          }
        }
      }

      // Fix 1 — fire per-match auto-awards (Kingslayer / Flawless). The
      // manual record handler does this; the bot is the primary recording
      // path during a normal season and was missing the call. Skip when the
      // match is now 'disputed' — dismiss-warnings will run the awards once
      // an admin clears them.
      if (!hasWarnings) {
        runAutoAwards(match.leagueId, { trigger: 'match', matchId });
      }

      // Advance the playoff bracket when a clean (non-disputed) playoff match
      // finalizes. The bot was the only recording path that never filled the
      // next-round slot, which stalled brackets until an admin stepped in.
      // Disputed matches wait for dismiss-warnings to advance. advancePlayoffWinner
      // only fills a still-empty slot, so re-running it is safe.
      if (!hasWarnings && match.phase === 'playoffs' && match.playoffRound && winnerTeamId) {
        const winnerSeed = winnerTeamId === match.homeTeamId ? match.homeSeed : match.awaySeed;
        advancePlayoffWinner({
          matchId,
          leagueId: match.leagueId,
          playoffRound: match.playoffRound,
          winnerId: winnerTeamId,
          winnerSeed,
        });
      }

      // Activity log
      db.insert(schema.activityLog).values({
        type: 'match_completed',
        category: 'match',
        actor: BOT_USERNAME,
        leagueId: match.leagueId,
        description: `Match completed: ${homeTeam?.teamAbbrev ?? '?'} ${homeScore}-${awayScore} ${awayTeam?.teamAbbrev ?? '?'}`,
        metadata: JSON.stringify({ matchId, homeScore, awayScore, winner: winnerUsername }),
      }).run();
      }); // end result-write transaction

      // Broadcast result to Arena (after commit — clients only learn the result
      // once it's durably written).
      const broadcaster = getArenaBroadcaster();
      if (broadcaster) {
        broadcaster.publish(`arena:match:${matchId}`, JSON.stringify({
          type: 'match_result',
          matchId,
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

  // Use resolved orientation so HUD's "home" column always shows the Cannoli
  // home team — regardless of which PS side they got assigned.
  const stats = battle.parser.getLiveStats(battle.homeSide ?? 'p1');
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
 *
 * After the showdownUsername column was dropped, the only mapping path is
 * via the team's owning user account: PS authentication routes through our
 * SSO login server (`backend/src/routes/ps-login.ts`) which signs assertions
 * for `toUserid(users.username)`. So a battle frame's PS name normalizes to
 * the same `userid` we get from `toUserid(user.username)` — that's the join
 * key.
 *
 * Called on startup and can be refreshed when rosters change.
 */
export function refreshUserMap() {
  useridToTeam.clear();

  // Order exactly like getUserTeam (arena-state.ts): active (non-offseason)
  // leagues first, then newest season. A coach who has played multiple seasons
  // owns one team row per season; keeping the FIRST (top-ranked) row per PS
  // userid maps them to their CURRENT-season team rather than a stale archived
  // one — otherwise the bot's match detection mis-resolves the league for any
  // returning coach (the live DB holds S9/S10/S11 side by side).
  const rows = db.select({
    teamId: schema.teams.id,
    leagueId: schema.teams.leagueId,
    username: schema.users.username,
    psUsername: schema.users.psUsername,
  })
    .from(schema.teams)
    .innerJoin(schema.users, eq(schema.teams.userId, schema.users.id))
    .innerJoin(schema.leagues, eq(schema.teams.leagueId, schema.leagues.id))
    .orderBy(
      sql`CASE WHEN ${schema.leagues.phase} = 'offseason' THEN 1 ELSE 0 END`,
      sql`${schema.leagues.seasonId} DESC`,
    )
    .all();

  for (const row of rows) {
    const userid = effectivePsUserid(row);
    if (useridToTeam.has(userid)) continue; // first (current-season) row wins
    useridToTeam.set(userid, { teamId: row.teamId, leagueId: row.leagueId });
  }

  console.log(`[PS Bot] User map loaded: ${useridToTeam.size} players`);
}

/**
 * Resolve a team's expected PS userid by walking team → user → username.
 * Returns '' when the team has no owning user account (rare — orphaned
 * roster), which mirrors the previous "no showdown username" fallback.
 */
function teamPsUserid(team: { userId: number | null } | null | undefined): string {
  if (!team?.userId) return '';
  const user = db.select({ username: schema.users.username, psUsername: schema.users.psUsername })
    .from(schema.users)
    .where(eq(schema.users.id, team.userId))
    .get();
  return user ? effectivePsUserid(user) : '';
}

/**
 * Resolve the canonical PS userid for a user record.
 *
 * Prefers the coach's custom `users.psUsername` (lets them use a different PS
 * handle — e.g. a team acronym — from their Cannoli account name); falls back
 * to the account `username`. This is the same identity the SSO login server
 * signs assertions for (see `getPsUserid` in ps-login.ts), so the bot's
 * userid→team join key stays in lockstep with what shows up in battle.
 */
export function effectivePsUserid(user: { username: string; psUsername?: string | null }): string {
  return toUserid(user.psUsername ?? user.username);
}
