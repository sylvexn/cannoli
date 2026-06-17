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
import { toCannoliSpeciesName } from './pokedex';
import { toUserid, signAssertion } from './ps-login';
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import { getArenaBroadcaster, clearReadyTimerForMatch } from '../routes/arena';
import { runAutoAwards } from './pins/auto-award';
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
}

let ws: WebSocket | null = null;
let connected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let challstr: string | null = null;

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
    const wasConnected = connected;
    connected = true;
    botState.connected = true;
    botState.reconnectAttempts = 0;
    bump();
    if (!wasConnected) notifyConnectionChange(true);
  };

  ws.onmessage = (event) => {
    const data = typeof event.data === 'string' ? event.data : '';
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

  if (!message.startsWith('cannoli-battle-created|')) return;

  const [, roomId, p1, p2, format] = message.split('|');
  if (!roomId) return;

  // Pre-register the battle so handleBattleLine has state when |init| arrives.
  if (!monitoredBattles.has(roomId)) {
    const entry: MonitoredBattle = {
      roomId,
      matchId: null,
      p1: toUserid(p1 || ''),
      p2: toUserid(p2 || ''),
      format: format || '',
      parser: new ReplayParser(),
      lines: [],
      isOfficial: false,
      homeSide: null,
    };
    monitoredBattles.set(roomId, entry);
    // Set matchId immediately so live-stats broadcasting starts as soon as the
    // first protocol lines arrive (gating only on `|player|` would lose the
    // opening few turns of telemetry).
    if (entry.p1 && entry.p2) checkForOfficialMatch(entry);
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

/**
 * Parse a single `{roomId}.log.json` file and return its `log: string[]`,
 * or null if the file is missing / unreadable / has no log array.
 */
function parseReplayLogFile(path: string): string[] | null {
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
function findReplayFileRecursive(dir: string, fileName: string, maxDepth: number): string | null {
  if (maxDepth < 0) return null;
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  // Files first — a hit at this level wins before we descend.
  for (const e of entries) {
    if (e.isFile() && e.name === fileName) return join(dir, e.name);
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = findReplayFileRecursive(join(dir, e.name), fileName, maxDepth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Look for a saved replay log on disk. PS autosaves every battle's protocol
 * log to:
 *   {PS_LOGS_DIR}/{YYYY-MM}/{tier}/{YYYY-MM-DD}/{roomId}.log.json
 * where `tier` is the format id (e.g. `gen9natdexdraft`). Confirmed in
 * showdown/server/server/room-battle.ts and showdown/monitor.ts.
 *
 * We don't know the date a-priori (a match could span midnight or have been
 * abandoned days ago), so we walk the year-month and day dirs looking for the
 * file. Both segments are date-named so this is bounded — newest-first so the
 * common case (a recent match) hits almost immediately.
 *
 * Returns the parsed `log: string[]` from the JSON, or null if not found /
 * unreadable.
 */
export function readReplayLogFromDisk(
  roomId: string,
  rootDir: string = PS_LOGS_DIR,
): string[] | null {
  const tier = formatFromRoomId(roomId);
  if (!tier) return null;

  if (!existsSync(rootDir)) {
    console.warn(`[PS Bot] PS_LOGS_DIR not found: ${rootDir} — disk-replay fallback disabled`);
    return null;
  }

  const fileName = `${roomId}.log.json`;

  // ── Deterministic scan: {YYYY-MM}/{tier}/{YYYY-MM-DD}/{roomId}.log.json ──
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
      const candidate = join(tierDir, day, fileName);
      if (existsSync(candidate)) return parseReplayLogFile(candidate);
    }
  }

  // ── Safety fallback: bounded recursive search for the named file. ──
  // Catches non-standard layouts the deterministic scan can't anticipate.
  // Depth 4 covers {YYYY-MM}/{tier}/{YYYY-MM-DD}/{file} plus a little slack.
  const hit = findReplayFileRecursive(rootDir, fileName, 4);
  if (hit) return parseReplayLogFile(hit);

  return null;
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
    homeSide: null,
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
 */
export type ImportBattleResult =
  | { ok: true; homeScore: number; awayScore: number; winnerTeamId: string | null; status: string; pokemonCount: number }
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
export function importBattleForMatch(matchId: string, roomId: string): ImportBattleResult {
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

  console.log(`[PS Bot] Importing battle ${normalizedRoomId} into match ${matchId}`);
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
 */
export function importBattleFromReplay(matchId: string, replay: string): ImportBattleResult {
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

  console.log(`[PS Bot] Importing replay into match ${matchId} (${lines.length} lines)`);
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

      // Cap replayLog at 256 KB — long battles can run 100+ KB of protocol
      // lines and we don't want a single match row ballooning the SQLite
      // page cache. The canonical full log lives at replayUrl on the PS
      // server, so truncation is recoverable.
      const replayLog = battle.lines.join('\n');
      const MAX_REPLAY_LOG = 256 * 1024;
      const truncatedLog = replayLog.length > MAX_REPLAY_LOG
        ? replayLog.slice(0, MAX_REPLAY_LOG) + '\n[...truncated]'
        : replayLog;

      // Update match record
      db.update(schema.matches)
        .set({
          status: 'completed',
          homeScore,
          awayScore,
          winnerTeamId,
          completedAt: new Date().toISOString(),
          replayLog: truncatedLog,
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
        .where(eq(schema.matches.id, battle.matchId))
        .run();

      // Write per-Pokemon K/D stats. Attribute by orientation, not by raw
      // p1/p2 → home/away mapping. The previous code used useridToTeam, which
      // is correct ONLY when the userid maps cleanly back; if it didn't (stale
      // mapping, name change), the fallback `match.homeTeamId` for p1 was
      // wrong half the time. With battle.homeSide resolved at match start,
      // we deterministically know which PS side is home.
      for (const mon of result.pokemon) {
        const side = mon.player;
        const homeSide = battle.homeSide
          ?? (useridToTeam.get(battle.p1)?.teamId === match.homeTeamId ? 'p1' : 'p2');
        const teamId = side === homeSide ? match.homeTeamId : match.awayTeamId;
        if (teamId == null) continue; // both teams resolved for a real battle

        if (mon.appeared) {
          db.insert(schema.matchPokemon).values({
            matchId: battle.matchId,
            teamId,
            // Store in Cannoli convention ("Mega Altaria"), not Showdown's
            // "Altaria-Mega", so per-Pokemon K/D JOINs to the roster entry.
            pokemonName: toCannoliSpeciesName(mon.species),
            kills: mon.kills,
            deaths: mon.deaths,
            teraUsed: mon.teraUsed,
            teraType: mon.teraType,
          }).run();
        }
      }

      // Run validation. Fix 5 — when warnings exist, flip status to 'disputed'
      // so the match is excluded from standings/playoffs gating. The manual
      // handler does the same; bot-flagged matches must not sneak through.
      // Fix 1 — only fire per-match auto-awards when no warnings; for a
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
        );

        if (warnings.length > 0) {
          hasWarnings = true;
          db.update(schema.matches)
            .set({ warnings: JSON.stringify(warnings), status: 'disputed' })
            .where(eq(schema.matches.id, battle.matchId))
            .run();
        }
      }

      // Fix 1 — fire per-match auto-awards (Kingslayer / Flawless). The
      // manual record handler does this; the bot is the primary recording
      // path during a normal season and was missing the call. Skip when the
      // match is now 'disputed' — dismiss-warnings will run the awards once
      // an admin clears them.
      if (!hasWarnings) {
        runAutoAwards(match.leagueId, { trigger: 'match', matchId: battle.matchId });
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

  const teams = db.select({
    id: schema.teams.id,
    leagueId: schema.teams.leagueId,
    userId: schema.teams.userId,
  }).from(schema.teams).all();

  for (const team of teams) {
    if (team.userId) {
      const user = db.select().from(schema.users).where(eq(schema.users.id, team.userId)).get();
      if (user) {
        useridToTeam.set(toUserid(user.username), { teamId: team.id, leagueId: team.leagueId });
      }
    }
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
  const user = db.select({ username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, team.userId))
    .get();
  return user ? toUserid(user.username) : '';
}
