/**
 * Disk-replay archive: enumerate, summarize, and cross-reference the battle
 * replays Pokemon Showdown autosaves to {PS_LOGS_DIR}/{YYYY-MM}/{tier}/
 * {YYYY-MM-DD}/{roomId}.log.json.
 *
 * Backs the admin "PS Replays" tooling — listing every replay PS persisted to
 * disk (independent of whether the Cannoli bot captured it), a per-replay
 * detail view with per-mon K/D, raw download, and best-effort linking back to a
 * Cannoli match so admins can spot bot-missed (recoverable) battles.
 *
 * Everything here is read-only against the PS logs volume + the Cannoli DB. The
 * file-locate / parse primitives are reused from ps-bot.ts (single source of
 * truth for the autosave layout).
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { eq, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import {
  getPsLogsDir,
  formatFromRoomId,
  normalizeRoomId,
  locateReplayFile,
} from './ps-bot';
import { ReplayParser } from './replay-parser';

// Types

/** How a disk replay relates to a Cannoli match. */
export type LinkStatus = 'attached' | 'recoverable' | 'unlinked';

/** Best-effort resolution of a disk replay to a Cannoli match. */
export interface MatchLink {
  matchId: string;
  leagueId: string;
  /** True when the match already has its replayLog stored (bot captured it). */
  attached: boolean;
}

/** One row in the disk-replay list. */
export interface PsReplayRow {
  roomId: string;
  /** PS display format, e.g. "[Gen 9] NatDex Draft" (null if unknown). */
  format: string | null;
  /** Format slug parsed from the room id, e.g. "gen9natdexdraft". */
  formatId: string | null;
  /** ISO-8601 string converted from the file's `timestamp`, or null. */
  playedAt: string | null;
  p1: string;
  p2: string;
  /** Winner PS username, or null on tie / unknown. */
  winner: string | null;
  turns: number | null;
  /** [p1survivors, p2survivors] when present, else null. */
  score: [number, number] | null;
  matchId: string | null;
  leagueId: string | null;
  attached: boolean;
  linkStatus: LinkStatus;
}

/** Per-mon K/D row for the detail view. */
export interface PsReplayPokemon {
  species: string;
  player: 'p1' | 'p2';
  kills: number;
  deaths: number;
  teraUsed: boolean;
  teraType: string | null;
}

/** Full detail shape for a single disk replay. */
export interface PsReplayDetail extends PsReplayRow {
  endType: string | null;
  p1Brought: string[];
  p2Brought: string[];
  pokemon: PsReplayPokemon[];
}

/** Result of {@link listDiskReplays}. */
export interface DiskReplayListing {
  available: boolean;
  dir: string;
  total: number;
  truncated: boolean;
  rows: PsReplayRow[];
}

// Raw top-level shape PS writes to {roomId}.log.json. Every field is optional —
// forfeits / abnormal endings can omit most of them, so we always fall back to
// parsing the `log` array.
interface RawReplayFile {
  winner?: string;
  turns?: number;
  p1?: string;
  p2?: string;
  p1team?: { name?: string; species?: string }[];
  p2team?: { name?: string; species?: string }[];
  score?: [number, number];
  endType?: string;
  timestamp?: string;
  roomid?: string;
  format?: string;
  log?: string[];
}

// File reading

function readRawFile(path: string): RawReplayFile | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RawReplayFile;
  } catch (err) {
    console.warn(`[PS Replays] Failed to read/parse ${path}:`, err);
    return null;
  }
}

/** Convert a PS `timestamp` string to an ISO-8601 string, or null if unparseable. */
function toIso(timestamp: string | undefined): string | null {
  if (!timestamp) return null;
  const d = new Date(timestamp);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Log fallbacks
//
// When a top-level field is missing we recover it from the protocol `log`:
//   |player|p1|NAME|...   → p1 / p2 usernames
//   |win|NAME             → winner
//   |turn|N               → last turn (turn count)
//   |poke|p1|SPECIES,...  → brought species per side

function playersFromLog(log: string[]): { p1: string; p2: string } {
  let p1 = '';
  let p2 = '';
  for (const line of log) {
    if (!line.startsWith('|player|')) continue;
    const parts = line.split('|');
    const side = parts[2];
    const name = parts[3];
    if (!name) continue;
    if (side === 'p1' && !p1) p1 = name;
    else if (side === 'p2' && !p2) p2 = name;
  }
  return { p1, p2 };
}

function winnerFromLog(log: string[]): string | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const line = log[i];
    if (line.startsWith('|win|')) return line.slice('|win|'.length).split('|')[0].trim() || null;
    if (line === '|tie' || line.startsWith('|tie|')) return null;
  }
  return null;
}

function turnsFromLog(log: string[]): number | null {
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].startsWith('|turn|')) {
      const n = parseInt(log[i].split('|')[2], 10);
      return isNaN(n) ? null : n;
    }
  }
  return null;
}

/** Strip the species out of a `|poke|p1|Species, L100, M|...` line. */
function speciesFromPokeLine(line: string): string | null {
  const parts = line.split('|');
  const detail = parts[3];
  if (!detail) return null;
  return detail.split(',')[0].trim() || null;
}

function broughtFromLog(log: string[], side: 'p1' | 'p2'): string[] {
  const out: string[] = [];
  const prefix = `|poke|${side}|`;
  for (const line of log) {
    if (!line.startsWith(prefix)) continue;
    const species = speciesFromPokeLine(line);
    if (species) out.push(species);
  }
  return out;
}

/** Brought species for a side: prefer top-level team arrays, fall back to log. */
function broughtForSide(
  raw: RawReplayFile,
  log: string[],
  side: 'p1' | 'p2',
): string[] {
  const team = side === 'p1' ? raw.p1team : raw.p2team;
  if (Array.isArray(team) && team.length > 0) {
    const fromTeam = team
      .map(m => (m?.species || m?.name || '').trim())
      .filter(Boolean);
    if (fromTeam.length > 0) return fromTeam;
  }
  return broughtFromLog(log, side);
}

// Row extraction

/** Build a (link-less) PsReplayRow from a parsed file. Returns null when the
 *  room id can't be resolved (so the row would be useless). */
function rowFromRaw(raw: RawReplayFile, filePath: string): Omit<PsReplayRow, 'matchId' | 'leagueId' | 'attached' | 'linkStatus'> | null {
  const log = Array.isArray(raw.log) ? raw.log : [];
  const fromLog = playersFromLog(log);

  // roomid is the authoritative room id; derive it from the filename if absent.
  let roomId = (raw.roomid || '').trim();
  if (!roomId) {
    const base = filePath.split('/').pop() || '';
    roomId = base.replace(/\.log\.json$/, '');
  }
  if (!roomId) return null;

  const formatId = formatFromRoomId(roomId);
  const p1 = (raw.p1 || fromLog.p1 || '').trim();
  const p2 = (raw.p2 || fromLog.p2 || '').trim();
  const winner = typeof raw.winner === 'string' && raw.winner.trim()
    ? raw.winner.trim()
    : winnerFromLog(log);
  const turns = typeof raw.turns === 'number' ? raw.turns : turnsFromLog(log);
  const score: [number, number] | null =
    Array.isArray(raw.score) && raw.score.length === 2
      ? [Number(raw.score[0]) || 0, Number(raw.score[1]) || 0]
      : null;

  return {
    roomId,
    format: raw.format ?? null,
    formatId,
    playedAt: toIso(raw.timestamp),
    p1,
    p2,
    winner,
    turns,
    score,
  };
}

// Directory walk

/** Numeric battle suffix from a room id (`battle-...-78` → 78). -Infinity when
 *  absent so unparsable ids sort last. */
function battleSuffix(roomId: string): number {
  const m = /-(\d+)(?:-\w+)?$/.exec(roomId);
  return m ? parseInt(m[1], 10) : -Infinity;
}

function listDirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Enumerate every `*.log.json` under PS_LOGS_DIR newest-first, parse up to
 * `limit` of them into rows, and report the total count found across the whole
 * tree (counting filenames is cheap; we only fully-parse the first `limit`).
 *
 * Walk order matches the autosave layout: YYYY-MM dirs reverse-sorted → tier
 * dirs → YYYY-MM-DD dirs reverse-sorted → files within a day sorted by the
 * numeric battle suffix descending.
 *
 * NOTE: returns rows WITHOUT match-link fields — the caller (or
 * {@link listDiskReplaysLinked}) resolves those. This keeps the pure walk
 * testable without a DB.
 */
export function listDiskReplaysRaw(limit = 100): {
  available: boolean;
  dir: string;
  total: number;
  rows: PsReplayRow[];
} {
  const dir = getPsLogsDir();
  if (!existsSync(dir)) {
    return { available: false, dir, total: 0, rows: [] };
  }

  let total = 0;
  const rows: PsReplayRow[] = [];

  const monthDirs = listDirSafe(dir)
    .filter(d => /^\d{4}-\d{2}$/.test(d))
    .sort()
    .reverse();

  for (const month of monthDirs) {
    const monthPath = join(dir, month);
    // Tier dirs — order between tiers within a month doesn't carry a meaningful
    // "newest" signal, so iterate as listed (sorted for determinism).
    const tierDirs = listDirSafe(monthPath).sort();
    for (const tier of tierDirs) {
      const tierPath = join(monthPath, tier);
      const dayDirs = listDirSafe(tierPath)
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort()
        .reverse();
      for (const day of dayDirs) {
        const dayPath = join(tierPath, day);
        const files = listDirSafe(dayPath)
          .filter(f => f.endsWith('.log.json'))
          .sort((a, b) => battleSuffix(b.replace(/\.log\.json$/, '')) - battleSuffix(a.replace(/\.log\.json$/, '')));
        for (const file of files) {
          total++;
          if (rows.length >= limit) continue; // keep counting, stop parsing
          const filePath = join(dayPath, file);
          const raw = readRawFile(filePath);
          if (!raw) continue;
          const base = rowFromRaw(raw, filePath);
          if (!base) continue;
          rows.push({
            ...base,
            matchId: null,
            leagueId: null,
            attached: false,
            linkStatus: 'unlinked',
          });
        }
      }
    }
  }

  return { available: true, dir, total, rows };
}

// Match linking

/**
 * Best-effort resolve a disk replay (by its two PS usernames) to a Cannoli
 * match.
 *
 *  1. Find users whose lowercased username is p1 or p2.
 *  2. Find their teams; among matches whose {home,away} are exactly that pair of
 *     teams (either orientation), prefer one in a NON-archived (active) season,
 *     then the most recent (highest week).
 *  3. attached = match.replayLog != null (bot already captured it).
 *
 * Returns null when no users / teams / match can be resolved. `formatId` is
 * accepted for future format-scoped disambiguation but not required today.
 */
export function linkReplayToMatch(
  p1: string,
  p2: string,
  _formatId?: string | null,
): MatchLink | null {
  const a = (p1 || '').trim().toLowerCase();
  const b = (p2 || '').trim().toLowerCase();
  if (!a || !b) return null;

  const matchedUsers = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(sql`lower(${schema.users.username})`, [a, b]))
    .all();
  if (matchedUsers.length < 2) return null;

  const userIds = matchedUsers.map(u => u.id);
  const teamRows = db
    .select({ id: schema.teams.id, leagueId: schema.teams.leagueId })
    .from(schema.teams)
    .where(inArray(schema.teams.userId, userIds))
    .all();
  const teamIds = new Set(teamRows.map(t => t.id));
  if (teamIds.size < 2) return null;

  // Candidate matches: both home & away are teams we resolved (either way).
  const candidateMatches = db
    .select({
      id: schema.matches.id,
      leagueId: schema.matches.leagueId,
      week: schema.matches.week,
      homeTeamId: schema.matches.homeTeamId,
      awayTeamId: schema.matches.awayTeamId,
      replayLog: schema.matches.replayLog,
    })
    .from(schema.matches)
    .all()
    .filter(
      m =>
        m.homeTeamId &&
        m.awayTeamId &&
        teamIds.has(m.homeTeamId) &&
        teamIds.has(m.awayTeamId),
    );
  if (candidateMatches.length === 0) return null;

  // Resolve each candidate's archived flag via league → season (cached per league).
  const archivedByLeague = new Map<string, boolean>();
  const isArchived = (leagueId: string): boolean => {
    if (archivedByLeague.has(leagueId)) return archivedByLeague.get(leagueId)!;
    const row = db
      .select({ archived: schema.seasons.archived })
      .from(schema.leagues)
      .innerJoin(schema.seasons, eq(schema.leagues.seasonId, schema.seasons.id))
      .where(eq(schema.leagues.id, leagueId))
      .get();
    const archived = !!row?.archived;
    archivedByLeague.set(leagueId, archived);
    return archived;
  };

  // Prefer active (non-archived) season, then most recent (highest week).
  const sorted = [...candidateMatches].sort((x, y) => {
    const xa = isArchived(x.leagueId) ? 1 : 0;
    const ya = isArchived(y.leagueId) ? 1 : 0;
    if (xa !== ya) return xa - ya; // active (0) before archived (1)
    return y.week - x.week; // higher week first
  });

  const best = sorted[0];
  return {
    matchId: best.id,
    leagueId: best.leagueId,
    attached: best.replayLog != null,
  };
}

/** Derive a {@link LinkStatus} from a (possibly null) match link. */
export function deriveLinkStatus(link: MatchLink | null): LinkStatus {
  if (!link) return 'unlinked';
  return link.attached ? 'attached' : 'recoverable';
}

/** Attach match-link fields to a bare row in place. */
function applyLink(row: PsReplayRow): PsReplayRow {
  const link = linkReplayToMatch(row.p1, row.p2, row.formatId);
  row.matchId = link?.matchId ?? null;
  row.leagueId = link?.leagueId ?? null;
  row.attached = link?.attached ?? false;
  row.linkStatus = deriveLinkStatus(link);
  return row;
}

// Public API

/**
 * List disk replays (newest-first) with each row cross-referenced to a Cannoli
 * match. `available: false` when PS_LOGS_DIR doesn't exist.
 */
export function listDiskReplays(limit = 100): DiskReplayListing {
  const { available, dir, total, rows } = listDiskReplaysRaw(limit);
  if (!available) {
    return { available: false, dir, total: 0, truncated: false, rows: [] };
  }
  for (const row of rows) applyLink(row);
  return { available: true, dir, total, truncated: total > rows.length, rows };
}

/**
 * Locate the file for `roomId` and return its path + raw bytes, or null if not
 * found. Used by the download endpoint.
 */
export function readDiskReplayFileRaw(roomId: string): { path: string; raw: string } | null {
  const path = locateReplayFile(normalizeRoomId(roomId));
  if (!path) return null;
  try {
    return { path, raw: readFileSync(path, 'utf-8') };
  } catch (err) {
    console.warn(`[PS Replays] Failed to read ${path}:`, err);
    return null;
  }
}

/**
 * Full detail for one disk replay: list-row fields + endType + brought species
 * per side + per-mon K/D (from {@link ReplayParser}). Null if the file can't be
 * located / parsed.
 */
export function summarizeDiskReplay(roomId: string): PsReplayDetail | null {
  const normalized = normalizeRoomId(roomId);
  const path = locateReplayFile(normalized);
  if (!path) return null;
  const raw = readRawFile(path);
  if (!raw) return null;

  const base = rowFromRaw(raw, path);
  if (!base) return null;

  const log = Array.isArray(raw.log) ? raw.log : [];
  const parsed = ReplayParser.parse(log.join('\n'));

  const pokemon: PsReplayPokemon[] = parsed.pokemon.map(p => ({
    species: p.species,
    player: p.player,
    kills: p.kills,
    deaths: p.deaths,
    teraUsed: p.teraUsed,
    teraType: p.teraType,
  }));

  const link = linkReplayToMatch(base.p1, base.p2, base.formatId);

  return {
    ...base,
    matchId: link?.matchId ?? null,
    leagueId: link?.leagueId ?? null,
    attached: link?.attached ?? false,
    linkStatus: deriveLinkStatus(link),
    endType: raw.endType ?? null,
    p1Brought: broughtForSide(raw, log, 'p1'),
    p2Brought: broughtForSide(raw, log, 'p2'),
    pokemon,
  };
}
