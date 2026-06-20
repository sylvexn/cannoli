/**
 * API client for the Cannoli backend.
 * All league-scoped data flows through these functions.
 */

import type { ApiError } from './errors';

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Build a full URL for an uploads path stored in the DB.
 *
 * - Returns '' for empty/null input.
 * - Returns the value unchanged if it's already absolute (http/https/leading /).
 * - Otherwise prepends `${API_BASE}/uploads/` so relative keys like
 *   "user-avatars/123.png" resolve to the correct backend origin in all
 *   environments (dev proxy, staging, production).
 */
export function buildUploadUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
    return path;
  }
  return `${API_BASE}/uploads/${path}`;
}

/**
 * Read the csrf_token cookie set by the backend on login + /me.
 * This is the JS-readable companion to the httpOnly session cookie; we echo
 * its value into the X-CSRF-Token header on writes so the backend can
 * verify the double-submit.
 */
function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function mutateJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = readCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    // Preserve body fields (e.g. `code`, `activeLeagues`) on the thrown Error so
    // callers can branch on structured error codes without re-fetching.
    // Shape matches the `ApiError` interface in lib/errors.ts.
    const e: ApiError = new Error(err.error || `API error: ${res.status}`);
    e.body = err;
    e.status = res.status;
    if (err && typeof err === 'object' && 'code' in err) e.code = err.code;
    throw e;
  }
  return res.json();
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return mutateJson('POST', path, body);
}

async function putJson<T>(path: string, body?: unknown): Promise<T> {
  return mutateJson('PUT', path, body);
}

async function deleteJson<T>(path: string): Promise<T> {
  return mutateJson('DELETE', path, undefined);
}

async function patchJson<T>(path: string, body?: unknown): Promise<T> {
  return mutateJson('PATCH', path, body);
}

// ─── Types (matching backend response shapes) ────────────────────────────────

export interface ApiLeague {
  id: string;
  name: string;
  color: string;
  draftDate?: string | null;
  draftOrder?: string[] | null;
  /** IANA zone anchoring deadline cutoffs (TZ-DEADLINE). */
  timezone?: string | null;
  playoffTeamCount?: number;
  /** Cost format id ('natdex' | 'natdexplus') — which price sheet this league
   *  drafts/values its pool against. */
  costFormat?: string;
  /** Registered-team (== coach) count for this league. */
  playerCount?: number;
  /** Admin results-reveal gate. `null` = OFF (all visible); integer N = results
   *  for weeks > N hidden for everyone (standings computed through week N). */
  resultsRevealedThrough?: number | null;
  season: {
    id: string;
    seasonNumber: number;
    phase: 'predraft' | 'draft' | 'regular' | 'playoffs' | 'offseason';
    currentWeek: number;
    totalWeeks: number;
    pointCap: number;
    teraCaptainSlots: number;
    tradeDeadlineWeek: number;
    rosterSize: number;
    forfeitPolicy?: 'double_forfeit' | 'admin_review';
    paused?: boolean;
    archived?: boolean;
    weekDates?: Record<string, string> | null;
    weekDatesAutoFilled?: boolean;
  } | null;
}

export interface ApiCoachOwner {
  username: string;
  displayName: string | null;
  avatarPath: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  role: 'dev' | 'admin' | 'user' | 'bot';
}

export interface ApiTeam {
  id: string;
  name: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  rank: number;
  logoPath?: string | null;
  bannerPath?: string | null;
  bio?: string | null;
  /** Owner-authored captain note, ≤ 280 chars. */
  captainNote?: string | null;
  userId: number | null;
  /** Coach identity joined from the users table — for <CoachLink> rendering. */
  owner?: ApiCoachOwner | null;
  /** True once the team has saved a full captain set during the post-draft
   *  captain gate. League advances to phase=regular once every team is locked. */
  captainsLocked?: boolean;
  record: { wins: number; losses: number; differential: number; kills?: number; deaths?: number };
  tiebreaker?: { rule: 'h2h' | 'diff' | 'kills' | 'id'; value: number | string } | null;
  roster: ApiRosterPokemon[];
}

/** One coach row in the admin league-membership view. */
export interface ApiMembershipCoach {
  id: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  logoPath: string | null;
  coachName: string;
  userId: number | null;
  manager: { username: string; displayName: string | null } | null;
  /** Career totals across ALL of this coach's teams (keyed on userId) —
   *  null when the team has no linked user account. */
  career: {
    seasonsPlayed: number;
    wins: number;
    losses: number;
    kills: number;
    deaths: number;
    championships: number;
  } | null;
}

export interface ApiMembershipLeague {
  id: string;
  name: string;
  color: string;
  phase: string;
  /** Whether coaches can still be added / removed / moved (before draft start). */
  editable: boolean;
  lockReason: string | null;
  teams: ApiMembershipCoach[];
}

export interface ApiMembership {
  seasonNumber: number | null;
  leagues: ApiMembershipLeague[];
}

export interface ApiRosterPokemon {
  name: string;
  nickname: string | null;
  rosterId: number;
  types: string[];
  tier: number;
  isTeraCaptain: boolean;
  teraTypes?: string[];
  isShiny: boolean;
  acquiredVia: string;
  acquiredWeek: number | null;
  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } | null;
  abilities: string[];
  seasonStats: { kills: number; deaths: number; gp: number };
}

export interface ApiMatch {
  id: string;
  week: number;
  homePlayer: string;
  awayPlayer: string;
  homeScore: number | null;
  awayScore: number | null;
  replayUrl: string | null;
  /** A battle log is stored for this match — playable in the in-site viewer
   *  even when replayUrl is null (imported replays). */
  hasReplay?: boolean;
  status: 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'disputed';
  phase: string;
  playoffRound: string | null;
  homeSeed: number | null;
  awaySeed: number | null;
}

export interface ApiByeWeek {
  week: number;
  teamId: string;
}

export interface ApiSchedule {
  matches: ApiMatch[];
  byes: ApiByeWeek[];
}

/**
 * A match validation warning. The `warnings` JSON column is heterogeneous:
 * the bot / replay-import path stores structured {@link ValidationWarning}
 * objects (roster / tera / format mismatches), while admin disputes and the
 * internal-consistency checks store plain strings. The UI must tolerate both.
 */
export type MatchWarning =
  | string
  | { type: string; team?: string; pokemon?: string; reason: string };

export interface ApiAdminMatch {
  id: string;
  leagueId: string;
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  replayUrl: string | null;
  /** A battle log is stored for this match — playable in the in-site viewer
   *  even when replayUrl is null (imported replays). */
  hasReplay?: boolean;
  warnings: MatchWarning[];
  phase: string;
  playoffRound: string | null;
  startedAt: string | null;
  completedAt: string | null;
  psRoomId: string | null;
}

export interface ApiMatchPokemon {
  name: string;
  nickname?: string | null;
  /** True when the owner has flipped the shiny toggle on this team's roster slot. */
  isShiny?: boolean;
  kills: number;
  deaths: number;
  teraUsed: boolean;
  teraType: string | null;
}

export interface ApiReplaySummary {
  matchId: string;
  isComplete: boolean;
  mvp: { name: string; nickname?: string | null; isShiny?: boolean; kills: number; deaths: number; teamId: string } | null;
  teraCount: number;
  sweep: boolean;
  margin: number;
  scoreLine: string | null;
  home: ApiMatchPokemon[];
  away: ApiMatchPokemon[];
}

export interface ApiTransaction {
  id: number;
  week: number;
  type: 'trade' | 'fa' | 'tera_change';
  teamId: string;
  otherTeamId: string | null;
  pokemonOut: string | null;
  pointsOut: number | null;
  pokemonIn: string | null;
  pointsIn: number | null;
  teraPokemon: string | null;
}

export interface ApiDraftPick {
  id: number;
  teamId: string;
  pickNumber: number;
  pokemonName: string;
  tier: number;
}

export interface ApiSnakePick {
  round: number;
  pick: number;
  overallPick: number;
  teamId: string;
}

export interface ApiDraftState {
  leagueId: string;
  status: 'not_started' | 'in_progress' | 'paused' | 'completed';
  currentPickIndex: number;
  timerDuration: number;
  timerExpiresAt: string | null;
  picks: { teamId: string; pokemonName: string; tier: number; pickNumber: number }[];
  snakeOrder: ApiSnakePick[];
  teamPoints: Record<string, number>;
  /** Per-team draft config — surfaced so the client doesn't hardcode 110.
   *  Optional for backwards-compat with older endpoints that don't return it. */
  pointCap?: number;
  rosterSize?: number;
  teraCaptainSlots?: number;
}

// ─── API functions ───────────────────────────────────────────────────────────

// ─── Auth response types ────────────────────────────────────────────────────

export interface ApiAuthUser {
  id: string;
  username: string;
  role: 'dev' | 'admin' | 'user' | 'bot';
  mustChangePassword: boolean;
  active: boolean;
  createdAt: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  tertiaryColor?: string | null;
  displayName?: string | null;
  bio?: string | null;
  avatarPath?: string | null;
}

export interface ApiUserPreferences {
  theme: 'dark' | 'light';
  density: 'compact' | 'comfortable';
  defaultLandingPath: string;
  /** IANA zone (e.g. "America/New_York"); null means use the browser zone. */
  timezone: string | null;
  /** Deuteranopia-safe palette swap — retargets red/green tokens to orange/blue. */
  colorblindMode: boolean;
  /** Spoiler-free mode — blurs match results (scores/winners/badges) on the
   *  standings and replays pages behind a click-to-reveal veil. */
  spoilerFreeMode: boolean;
  /** Per-league spoiler reveal high-water marks: { [leagueId]: highestRevealedWeek }.
   *  Revealing week N reveals weeks 1..N, so a result for week W shows once
   *  W <= spoilerRevealedThrough[leagueId]. (Legacy per-week mode — unused now.) */
  spoilerRevealedThrough: Record<string, number>;
  /** Per-match spoiler reveals: stable match ids the user has peeked. A match
   *  shows plainly once its id is in this set, persisted across reloads. */
  spoilerRevealedMatches?: string[];
  updatedAt: string | null;
}

export interface ApiLifetimeStats {
  seasonsPlayed: number;
  totalRecord: { wins: number; losses: number };
  careerKills: number;
  careerDeaths: number;
  totalTrades: number;
  championships: number;
  leagueBreakdown: Array<{
    leagueId: string;
    teamId: string;
    teamName: string;
    record: { wins: number; losses: number };
    finish: 'champion' | 'finalist' | null;
    isChampion: boolean;
  }>;
}

export interface ApiPublicProfile {
  username: string;
  displayName: string | null;
  bio: string | null;
  /** Short status one-liner (≤ 80 chars), e.g. "looking for water-types". */
  statusMessage?: string | null;
  /** Public path to uploaded banner image (`/uploads/user-banners/<id>.<ext>`)
   *  or null. When null, the profile page falls back to the gemstone gradient. */
  bannerUrl?: string | null;
  /** ISO timestamp of last authenticated request — feeds the online dot. */
  lastSeenAt?: string | null;
  avatarPath: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  createdAt: string | null;
  /** User's role — surfaced on the profile page as an ADMIN chip when
   *  applicable. Only set on backends that include it (older deploys may
   *  omit it; treat undefined as `'user'`). */
  role?: 'dev' | 'admin' | 'user' | 'bot' | null;
  currentTeams: Array<{
    teamId: string;
    leagueId: string;
    teamName: string;
    teamAbbrev: string;
    teamColor: string;
    logoPath: string | null;
    /** Season number this team belongs to — needed when the hero panel
     *  renders the league/season pill. Optional for back-compat with older
     *  backends that haven't redeployed yet. */
    seasonNumber?: number;
    /** League phase at fetch time — drives "Finals Pending" pill in S10. */
    leaguePhase?: 'predraft' | 'draft' | 'regular' | 'playoffs' | 'offseason';
  }>;
  /** Past tenures — one row per archived (league × season) the user has
   *  owned a team in. Populated lazily as A4 backfills S9 archives; the
   *  profile page reads defensively. */
  pastTeams?: Array<{
    teamId: string;
    leagueId: string;
    /** DB id of the season this tenure belongs to — used to deep-link the
     *  archive route /archive/:seasonId/:leagueId/:teamId. */
    seasonId: number;
    teamName: string;
    teamAbbrev: string;
    teamColor: string;
    logoPath: string | null;
    seasonNumber: number;
    /** Finishing position + display label (e.g. `{ position: 1, label: 'Champion' }`).
     *  Null when the league finished without playoffs or before rank was tracked. */
    finish: { position: number; label: string } | null;
  }>;
  careerSummary: {
    seasonsPlayed: number;
    careerWins: number;
    careerLosses: number;
    careerKills: number;
    careerDeaths: number;
    championships: number;
  };
}

export interface ApiBotStatus {
  connected: boolean;
  authedAs: string | null;
  reconnectAttempts: number;
  lastEventAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  monitoredBattles: { roomId: string; matchId: string | null; p1: string; p2: string }[];
  health: 'green' | 'yellow' | 'red';
}

// ─── Admin types ────────────────────────────────────────────────────────────

export interface ApiActivityEvent {
  id: string;
  type: string;
  category: string;
  actor: string;
  leagueId?: string | null;
  description: string;
  metadata: Record<string, unknown>;
  timestamp: string | null;
}

/** One row of the raw API request log (admin "API Logs" tab). */
export interface ApiRequestLog {
  id: string;
  /** 'server' = HTTP traffic, 'client' = browser-reported fault. */
  source: 'server' | 'client';
  method: string;
  path: string;
  status: number;
  durationMs: number;
  userId: string | null;
  username: string | null;
  ip: string | null;
  /** Short correlation ref (5xx + client errors); shown to the user. */
  errorId: string | null;
  errorName: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  timestamp: string | null;
}

export interface ApiRequestLogResponse {
  logs: ApiRequestLog[];
  /** Count of rows matching the active filters (for pagination). */
  total: number;
  /** Overview across the whole table, independent of filters. */
  stats: {
    total: number;
    errors4xx: number;
    errors5xx: number;
    avgMs: number;
    p95Ms: number;
  };
}

// ─── Observability dashboard (dev-only) ───────────────────────────────────────

export type ErrorGroupStatus = 'open' | 'resolved' | 'muted';

export interface ApiErrorGroup {
  id: number;
  fingerprint: string;
  kind: string;
  errorName: string | null;
  sampleMessage: string | null;
  samplePath: string | null;
  count: number;
  affectedUsers: number;
  status: ErrorGroupStatus;
  firstSeen: string | null;
  lastSeen: string | null;
  firstVersion: string | null;
  lastVersion: string | null;
  /** True when first seen within the dashboard's "new" window. */
  isNew: boolean;
  /** Per-bucket occurrence counts for the last 24h (oldest→newest sparkline). */
  spark: number[];
}

export interface ApiErrorGroupDetail extends ApiErrorGroup {
  sampleStack: string | null;
  resolvedAt: string | null;
  resolvedVersion: string | null;
  /** Most recent occurrences (joined request_logs rows). */
  occurrences: ApiRequestLog[];
}

export interface ApiObservabilityOverview {
  groups: ApiErrorGroup[];
  total: number;
  /** Counts by status across all groups (independent of filters). */
  stats: { open: number; resolved: number; muted: number; newToday: number };
}

export interface ApiObservabilityTrends {
  /** Buckets oldest→newest over the requested window. */
  buckets: { t: string; total: number; errors: number; p95Ms: number }[];
  slowestEndpoints: { path: string; avgMs: number; p95Ms: number; count: number }[];
}

export interface ApiHealthCheck {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  detail: string | null;
  latencyMs: number | null;
  checkedAt: string | null;
  lastOkAt: string | null;
}

export interface ApiObservabilityHealth {
  checks: ApiHealthCheck[];
  uptimeSeconds: number;
  version: string;
}

export interface ApiSiteSettings {
  defaultUserPassword: string | null;
  draftTimerEnabled: boolean;
  draftDemoVisible: boolean;
  faDeadlineWeek?: number;
  faPickupsPerSeason?: number;
  defaultPlayoffTeamCount?: number;
}

export interface ApiMoveCategoryEntry {
  id: number;
  name: string;
  moveId: string;
  isAbility: boolean;
}

export interface ApiMoveCategory {
  id: string;
  name: string;
  entries: ApiMoveCategoryEntry[];
}

export interface ApiTrade {
  id: string;
  leagueId: string;
  week: number;
  status: 'pending' | 'awaiting_admin' | 'accepted' | 'rejected' | 'expired';
  proposerId: string;
  recipientId: string;
  offering: string[];
  requesting: string[];
  proposedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  rejectReason: string | null;
}

export interface ApiTradeBlockListing {
  id: number;
  teamId: string;
  pokemonName: string;
  note: string | null;
}

export interface ApiTierListEntry {
  name: string;
  tier: number;
  status: 'available' | 'tera-banned' | 'banned';
}

export interface ApiCostFormat {
  id: string;
  label: string;
  leagueIds: string[];
}

/** Saved {format, captain config, banlist, tier-list snapshot} preset. The
 *  season wizard's "Start from template" option seeds initial state from one
 *  of these so admins don't have to re-enter the same numbers each season. */
export interface ApiDraftTemplate {
  id: number;
  name: string;
  description: string | null;
  format: string;
  tierListSnapshot: { tier: number; names: string[] }[];
  banlist: string[];
  teraBanlist: string[];
  captainCount: number;
  pointCap: number;
  rosterSize: number;
  createdAt: string | null;
  createdBy: number | null;
}

// ─── Speed Tiers ─────────────────────────────────────────────────────────

/**
 * One ownership entry per (league, team) the Pokemon is rostered on. Rendered
 * as a colored gem chip in the speed-tier table; multiple chips per row when
 * the same mon is drafted in more than one active league.
 */
export interface ApiSpeedTierOwnership {
  leagueId: string;
  leagueName: string;
  leagueColor: string;
  teamId: string;
  teamAbbrev: string;
  teamName: string;
  teamColor: string;
  coachName: string;
  logoPath: string | null;
  isTeraCaptain: boolean;
  nickname: string | null;
}

export interface ApiSpeedTierRow {
  /** Stable id = the canonical `pokemon.name` (e.g. "Charizard-Mega-Y"). */
  id: string;
  name: string;
  dex: number | null;
  baseSpeed: number;
  type1: string | null;
  type2: string | null;
  tier: number;
  formCategory: 'base' | 'mega' | 'regional' | 'other';
  /** True when the mon is a tera captain on AT LEAST ONE roster. Per-league
   *  captain status lives on individual ownership entries. */
  isTeraCaptain: boolean;
  abilities: string[];
  /** Every (league, team) this mon is currently rostered on. Empty array =
   *  free agent in the active season. */
  ownerships: ApiSpeedTierOwnership[];
}

export interface ApiGlobalOwnership {
  leagueId: string;
  leagueName: string;
  leagueColor: string;
  owner: {
    teamId: string;
    teamAbbrev: string;
    teamName: string;
    teamColor: string;
    logoPath: string | null;
  };
  /** Coach data for CoachLink rendering. Falls back to a `{ displayName }`-only
   *  shape when the team has no linked user account. */
  coach?: {
    username?: string;
    displayName: string;
    avatarPath?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    tertiaryColor?: string | null;
    role?: string;
  };
  isTeraCaptain: boolean;
  nickname: string | null;
}

export interface ApiPokemonRecentBattle {
  matchId: string;
  leagueId: string;
  leagueName: string;
  leagueColor: string;
  week: number;
  phase: 'regular' | 'playoffs';
  playoffRound: string | null;
  replayUrl: string;
  completedAt: string | null;
  owner: {
    teamId: string;
    teamAbbrev: string;
    teamName: string;
    teamColor: string;
    logoPath: string | null;
  };
  opponent: {
    teamId: string;
    teamAbbrev: string;
    teamName: string;
    teamColor: string;
    logoPath: string | null;
  };
  result: 'W' | 'L' | 'T' | null;
  teamScore: number | null;
  oppScore: number | null;
  kills: number;
  deaths: number;
  teraUsed: boolean;
  teraType: string | null;
}

// ─── Pins ────────────────────────────────────────────────────────────────

export type PinCategory = 'career' | 'season' | 'week' | 'draft' | 'community' | 'custom';

export interface ApiPinDefinition {
  id: string;
  name: string;
  description: string;
  iconName: string;
  color: string;
  category: PinCategory;
  isAuto: boolean;
  createdAt?: string | null;
}

export interface ApiPin {
  id: number;
  pinDefId: string;
  seasonId: number | null;
  awardedAt: string | null;
  awardedBy: number | null;
  metadata: Record<string, unknown> | null;
  definition: ApiPinDefinition;
}

export interface ApiPinRecent {
  id: number;
  userId: number;
  username: string;
  pinDefId: string;
  defName: string;
  defIconName: string;
  defColor: string;
  seasonId: number | null;
  awardedAt: string | null;
  awardedBy: number | null;
  metadata: Record<string, unknown> | null;
}

export type ChangelogCategory = 'feature' | 'improvement' | 'fix';

export interface ApiChangelogEntry {
  id: string;
  /** ISO 8601 timestamp (UTC). */
  date: string;
  category: ChangelogCategory;
  title: string;
  body?: string;
}

// ─── Feedback (DB-backed, all 4 categories) ──────────────────────────────────
export type FeedbackCategory = 'bug' | 'feature' | 'league' | 'general';

/** A feedback row as returned by the admin triage endpoint (joined to users). */
export interface ApiFeedbackItem {
  id: number;
  category: FeedbackCategory;
  title: string;
  body: string;
  page: string | null;
  errorRef: string | null;
  /** Ready to drop into <img src>; null when no screenshot was attached. */
  screenshotUrl: string | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  status: 'open' | 'resolved';
  adminResponse: string | null;
  reporter: string;
  reporterRole: string;
  resolvedAt: string | null;
  createdAt: string;
}

// ─── Notifications (unified pane: changelog + feedback + announcement + match) ─
export type NotificationSource = 'changelog' | 'feedback' | 'announcement' | 'match';

export interface NotificationItem {
  /** Prefixed composite id, e.g. 'changelog:<entryId>' | 'notif:<rowId>' | 'announcement:<rowId>' | 'match:<matchId>'. */
  id: string;
  source: NotificationSource;
  title: string;
  body: string | null;
  /** Client route or absolute URL; null = no navigation. */
  link: string | null;
  /** Source-specific category driving icon + accent (changelog/announcement category). */
  category: string | null;
  createdAt: string;
  read: boolean;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
  unreadBySource: { changelog: number; feedback: number; announcement: number; match: number };
}

export type AnnouncementCategory = 'info' | 'feature' | 'event' | 'maintenance';
export type AnnouncementSurface = 'bell' | 'banner' | 'both';

export interface ApiAnnouncement {
  id: number;
  title: string;
  body: string;
  link: string | null;
  category: AnnouncementCategory;
  createdByUsername: string | null;
  createdAt: string;
  active: boolean;
  surface: AnnouncementSurface;
  leagueId: string | null;
  targetRole: 'admin' | 'user' | null;
  updatedAt: string | null;
}

export interface ApiBanner {
  id: number;
  title: string;
  body: string;
  link: string | null;
  category: AnnouncementCategory;
  createdAt: string;
}

export interface AdminNotificationLogEntry {
  id: string;
  kind: 'announcement' | 'directed';
  title: string;
  body: string;
  category: string | null;
  surface: string | null;
  leagueId: string | null;
  targetRole: string | null;
  recipientUsername: string | null;
  retracted: boolean;
  createdAt: string;
}

export interface AdminNotificationLog {
  items: AdminNotificationLogEntry[];
  nextBefore: string | null;
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    postJson<{ user: ApiAuthUser }>('/api/auth/login', { username, password }),

  logout: () => postJson<{ success: boolean }>('/api/auth/logout'),

  demoLogin: () => postJson<{ user: ApiAuthUser }>('/api/auth/demo-session'),

  me: () => fetchJson<{ user: ApiAuthUser | null }>('/api/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    postJson<{ success: boolean }>('/api/auth/change-password', { currentPassword, newPassword }),

  // League data. `all: true` returns leagues across every season (incl.
  // archived) — used by the Replay Gallery to browse historical replays.
  getLeagues: (all = false) => fetchJson<ApiLeague[]>(`/api/leagues${all ? '?all=1' : ''}`),

  getSeasons: () => fetchJson<{
    id: number;
    seasonNumber: number;
    phase: 'predraft' | 'draft' | 'regular' | 'playoffs' | 'offseason';
    currentWeek: number;
    totalWeeks: number;
    archived?: boolean;
  }[]>('/api/seasons'),

  getSeasonLeagues: (seasonId: number) => fetchJson<{
    id: string;
    name: string;
    color: string;
    teams: {
      id: string;
      coachName: string;
      teamName: string;
      teamAbbrev: string;
      teamColor: string;
    }[];
  }[]>(`/api/seasons/${seasonId}/leagues`),

  getTeams: (leagueId: string) => fetchJson<ApiTeam[]>(`/api/leagues/${leagueId}/teams`),

  getSchedule: (leagueId: string) => fetchJson<ApiSchedule>(`/api/leagues/${leagueId}/schedule`),

  getMatchPokemon: (matchId: string) => fetchJson<{ home: ApiMatchPokemon[]; away: ApiMatchPokemon[] }>(`/api/matches/${matchId}/pokemon`),
  getReplaySummary: (matchId: string) => fetchJson<ApiReplaySummary | null>(`/api/matches/${matchId}/replay-summary`),

  getTransactions: (leagueId: string) => fetchJson<ApiTransaction[]>(`/api/leagues/${leagueId}/transactions`),

  getDraftPicks: (leagueId: string) => fetchJson<ApiDraftPick[]>(`/api/leagues/${leagueId}/draft`),

  // Admin read
  getUsers: () => fetchJson<ApiAuthUser[]>('/api/users'),

  getActivityLog: (params?: { category?: string; leagueId?: string; search?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.category) q.set('category', params.category);
    if (params?.leagueId) q.set('leagueId', params.leagueId);
    if (params?.search) q.set('search', params.search);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    return fetchJson<{ events: ApiActivityEvent[]; total: number }>(`/api/activity-log?${q}`);
  },

  // Raw API request logs (HTTP traffic + errors) — admin "API Logs" tab.
  getRequestLogs: (params?: { status?: string; method?: string; source?: string; search?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.status && params.status !== 'all') q.set('status', params.status);
    if (params?.method && params.method !== 'all') q.set('method', params.method);
    if (params?.source && params.source !== 'all') q.set('source', params.source);
    if (params?.search) q.set('search', params.search);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    return fetchJson<ApiRequestLogResponse>(`/api/admin/request-logs?${q}`);
  },
  clearRequestLogs: () => postJson<{ cleared: number }>('/api/admin/request-logs/clear'),

  // ── Observability dashboard (dev-only) ──
  getErrorGroups: (params?: { status?: string; kind?: string; search?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.status && params.status !== 'all') q.set('status', params.status);
    if (params?.kind && params.kind !== 'all') q.set('kind', params.kind);
    if (params?.search) q.set('search', params.search);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    return fetchJson<ApiObservabilityOverview>(`/api/admin/observability/groups?${q}`);
  },
  getErrorGroup: (id: number) =>
    fetchJson<ApiErrorGroupDetail>(`/api/admin/observability/groups/${id}`),
  setErrorGroupStatus: (id: number, status: ErrorGroupStatus) =>
    postJson<{ success: boolean }>(`/api/admin/observability/groups/${id}/status`, { status }),
  getObservabilityTrends: (window?: '24h' | '7d') =>
    fetchJson<ApiObservabilityTrends>(`/api/admin/observability/trends?window=${window ?? '24h'}`),
  getObservabilityHealth: () =>
    fetchJson<ApiObservabilityHealth>('/api/admin/observability/health'),
  getObservabilityUnread: () =>
    fetchJson<{ unread: number }>('/api/admin/observability/unread'),
  markObservabilitySeen: () =>
    postJson<{ success: boolean }>('/api/admin/observability/seen'),
  // Dev tooling: inject / remove fake error groups for demos + screenshots.
  seedDemoErrors: () =>
    postJson<{ success: boolean; groups: number; occurrences: number }>('/api/admin/observability/seed-demo'),
  clearDemoErrors: () =>
    postJson<{ success: boolean; cleared: number }>('/api/admin/observability/seed-demo/clear'),

  // Report a browser-side fault (error boundary / global handlers). Returns a
  // short ref the user can quote in feedback. Caller swallows failures.
  reportClientError: (input: { page: string; message: string; name?: string; stack?: string; kind?: string; breadcrumbs?: unknown[]; version?: string }) =>
    postJson<{ errorId: string }>('/api/client-errors', input),

  getSiteSettings: () => fetchJson<ApiSiteSettings>('/api/site-settings'),

  getMoveCategories: () => fetchJson<ApiMoveCategory[]>('/api/move-categories'),

  getTrades: (leagueId: string) => fetchJson<ApiTrade[]>(`/api/leagues/${leagueId}/trades`),

  getTradeBlock: (leagueId: string) => fetchJson<ApiTradeBlockListing[]>(`/api/leagues/${leagueId}/trade-block`),

  getTierList: (format?: string) =>
    fetchJson<ApiTierListEntry[]>(format ? `/api/tier-list?format=${encodeURIComponent(format)}` : '/api/tier-list'),

  getCostFormats: () => fetchJson<ApiCostFormat[]>('/api/cost-formats'),

  // ─── Draft Templates ─────────────────────────────────────────────
  // A template snapshots format + tier list + bans + captain config so a new
  // season can spin up a known-good preset. The wizard "Start from template"
  // step seeds initial state from one of these.
  listDraftTemplates: () => fetchJson<ApiDraftTemplate[]>('/api/draft-templates'),

  getDraftTemplate: (id: number) => fetchJson<ApiDraftTemplate>(`/api/draft-templates/${id}`),

  createDraftTemplate: (data: {
    name: string;
    description?: string | null;
    format: string;
    tierListSnapshot: { tier: number; names: string[] }[];
    banlist?: string[];
    teraBanlist?: string[];
    captainCount?: number;
    pointCap?: number;
    rosterSize?: number;
  }) => postJson<ApiDraftTemplate>('/api/draft-templates', data),

  updateDraftTemplate: (id: number, data: Partial<{
    name: string;
    description: string | null;
    format: string;
    tierListSnapshot: { tier: number; names: string[] }[];
    banlist: string[];
    teraBanlist: string[];
    captainCount: number;
    pointCap: number;
    rosterSize: number;
  }>) => putJson<ApiDraftTemplate>(`/api/draft-templates/${id}`, data),

  deleteDraftTemplate: (id: number) => deleteJson<{ success: boolean }>(`/api/draft-templates/${id}`),

  // Admin write
  createUser: (username: string, role: string) =>
    postJson<{ user: ApiAuthUser; password: string }>('/api/users', { username, role }),

  updateUser: (id: string, data: { role?: string; active?: boolean }) =>
    putJson<{ success: boolean }>(`/api/users/${id}`, data),

  resetUserPassword: (id: string) =>
    postJson<{ password: string }>(`/api/users/${id}/reset-password`),

  saveSiteSettings: (settings: Record<string, unknown>) =>
    putJson<{ success: boolean }>('/api/site-settings', settings),

  updateTierListEntry: (
    name: string,
    data: { format?: string; tier?: number; status?: string; force?: boolean; confirmLeague?: string },
  ) =>
    putJson<{ success: boolean; forced?: boolean }>(`/api/tier-list/${encodeURIComponent(name)}`, data),

  createMoveCategory: (name: string) =>
    postJson<{ id: string; name: string }>('/api/move-categories', { name }),

  updateMoveCategory: (id: string, name: string) =>
    putJson<{ success: boolean }>(`/api/move-categories/${id}`, { name }),

  deleteMoveCategory: (id: string) =>
    deleteJson<{ success: boolean }>(`/api/move-categories/${id}`),

  addMoveCategoryEntry: (catId: string, name: string, isAbility?: boolean) =>
    postJson<{ success: boolean; id: number }>(`/api/move-categories/${catId}/entries`, { name, isAbility }),

  updateMoveCategoryEntry: (entryId: number, data: { name?: string; isAbility?: boolean }) =>
    putJson<{ success: boolean }>(`/api/move-category-entries/${entryId}`, data),

  deleteMoveCategoryEntry: (entryId: number) =>
    deleteJson<{ success: boolean }>(`/api/move-category-entries/${entryId}`),

  createLeague: (name: string, color: string) =>
    postJson<{ id: string }>('/api/leagues', { name, color }),

  updateLeague: (id: string, data: Record<string, unknown>) =>
    putJson<{ success: boolean }>(`/api/leagues/${id}`, data),

  deleteLeague: (id: string, opts?: { force?: boolean; confirmName?: string }) => {
    const q = opts?.force ? '?force=1' : '';
    return mutateJson<{ success: boolean }>(
      'DELETE',
      `/api/leagues/${id}${q}`,
      opts?.confirmName ? { confirmName: opts.confirmName } : undefined,
    );
  },

  advancePhase: (leagueId: string, phase: string, opts?: { override?: boolean; confirm?: string }) =>
    postJson<{ success: boolean }>(`/api/leagues/${leagueId}/phase`, { phase, ...opts }),

  generatePlayoffs: (leagueId: string, opts?: { topN?: number }) =>
    postJson<{
      success: boolean;
      matchCount: number;
      seedings: { seed: number; teamId: string }[];
    }>(`/api/leagues/${leagueId}/playoffs/generate`, opts ?? {}),

  archiveSeason: (seasonId: number, archived: boolean) =>
    putJson<{ success: boolean }>(`/api/seasons/${seasonId}/archived`, { archived }),

  /**
   * The full archive ceremony: flips the archived flag, sets every league
   * in the season to phase=offseason, and runs both runAutoAwards
   * (existing pins) and mintArchivePins (champion / high-score / steal /
   * sweeper). Idempotent — safe to re-run after a stat correction.
   */
  archiveSeasonCeremony: (seasonId: number) =>
    postJson<{
      success: boolean;
      seasonId: number;
      seasonNumber: number;
      leagues: number;
      existingAwards: { leagueId: string; awarded: number; skipped: number }[];
      newAwards: { leagueId: string; awarded: { pinDefId: string; userId: number }[]; skipped: number }[];
    }>(`/api/admin/seasons/${seasonId}/archive`),

  advanceWeek: (leagueId: string) =>
    postJson<{ success: boolean; week: number }>(`/api/leagues/${leagueId}/week`),

  /** Set the admin results-reveal gate. `revealedThrough = null` turns the gate
   *  OFF (all results visible); an integer N hides results for weeks > N for
   *  everyone (standings computed through week N). Staff-only; backend clamps to
   *  [0, currentWeek] and 400s with code 'reveal_out_of_range' otherwise. */
  setResultsReveal: (leagueId: string, revealedThrough: number | null) =>
    postJson<{ success: boolean; resultsRevealedThrough: number | null }>(
      `/api/admin/leagues/${leagueId}/results-reveal`, { revealedThrough }),

  saveDraftOrder: (leagueId: string, order: string[]) =>
    postJson<{ success: boolean }>(`/api/leagues/${leagueId}/draft-order`, { order }),

  getDraftState: (leagueId: string) =>
    fetchJson<ApiDraftState>(`/api/leagues/${leagueId}/draft/state`),

  startDraft: (leagueId: string, timerDuration?: number) =>
    postJson<ApiDraftState>(`/api/leagues/${leagueId}/draft/start`, { timerDuration }),

  pauseDraft: (leagueId: string) =>
    postJson<{ success: boolean }>(`/api/leagues/${leagueId}/draft/pause`),

  resumeDraft: (leagueId: string) =>
    postJson<ApiDraftState>(`/api/leagues/${leagueId}/draft/resume`),

  forceDraftPick: (leagueId: string, teamId: string, pokemonName: string) =>
    postJson<{ success: boolean; pick: { teamId: string; pokemonName: string; tier: number; pickNumber: number } }>(
      `/api/leagues/${leagueId}/draft/force-pick`,
      { teamId, pokemonName },
    ),

  skipDraftPick: (leagueId: string) =>
    postJson<{ success: boolean }>(`/api/leagues/${leagueId}/draft/skip`),

  undoDraftPick: (leagueId: string) =>
    postJson<{ success: boolean; undonePick: { teamId: string; pokemonName: string; tier: number; pickNumber: number } }>(
      `/api/leagues/${leagueId}/draft/undo`,
    ),

  generateSchedule: (leagueId: string, opts?: { force?: boolean; confirmName?: string }) =>
    postJson<{ success: boolean; matchCount: number }>(`/api/leagues/${leagueId}/schedule/generate`, opts ?? {}),

  approveTrade: (tradeId: string) =>
    postJson<{ success: boolean }>(`/api/trades/${tradeId}/approve`),

  rejectTrade: (tradeId: string, reason?: string) =>
    postJson<{ success: boolean }>(`/api/trades/${tradeId}/reject`, { reason }),

  // User write (own team)
  proposeTrade: (leagueId: string, data: { recipientId: string; offering: string[]; requesting: string[]; proposerId?: string }) =>
    postJson<{ id: string }>(`/api/leagues/${leagueId}/trades/propose`, data),

  // Counterparty trade response (accept → awaiting_admin, reject → rejected)
  respondToTrade: (tradeId: string, action: 'accept' | 'reject', reason?: string) =>
    postJson<{ success: boolean }>(`/api/trades/${tradeId}/respond`, { action, reason }),

  // Proposer-side withdraw of a pending trade
  withdrawTrade: (tradeId: string) =>
    postJson<{ success: boolean }>(`/api/trades/${tradeId}/withdraw`),

  // Counter-proposal: closes the original and opens a new linked trade in the
  // reverse direction. The body is the *counter* offering/requesting (from
  // the original recipient's perspective: what THEY are now offering, and
  // what they want from the original proposer).
  counterTrade: (tradeId: string, data: { offering: string[]; requesting: string[] }) =>
    postJson<{ id: string; originalId: string }>(`/api/trades/${tradeId}/counter`, data),

  // Trade-block listings (user writes)
  createTradeBlockListing: (leagueId: string, data: { pokemonName: string; note?: string; teamId?: string }) =>
    postJson<{ id: number }>(`/api/leagues/${leagueId}/trade-block`, data),

  deleteTradeBlockListing: (listingId: number) =>
    deleteJson<{ success: boolean }>(`/api/trade-block-listings/${listingId}`),

  // Standalone FA release (drop without pickup)
  freeAgentRelease: (leagueId: string, data: { teamId: string; pokemonName: string }) =>
    postJson<{ success: boolean }>(`/api/leagues/${leagueId}/free-agents/release`, data),

  // Profile colors
  updateMyColors: (colors: { primaryColor?: string | null; secondaryColor?: string | null; tertiaryColor?: string | null }) =>
    mutateJson<{ success: boolean }>('PATCH', '/api/users/me/colors', colors),

  // Profile (displayName, bio, statusMessage, bannerUrl + coach flair).
  // bannerUrl is for clearing the banner or pasting a remote URL — multipart
  // uploads should go through `uploadUserBanner` below.
  updateMe: (data: {
    displayName?: string | null;
    bio?: string | null;
    statusMessage?: string | null;
    bannerUrl?: string | null;
    psUsername?: string | null;
  }) => mutateJson<{ success: boolean }>('PATCH', '/api/users/me', data),

  // Staff override — edit another user's profile fields. Backend gates on
  // dev/admin role and emits a `profile_edited_by_staff` audit event with
  // { targetUserId, fields, editorId } metadata. The owner's own edits
  // continue to go through `updateMe` (preserves the audit distinction).
  updateUserAsStaff: (
    username: string,
    data: {
      bio?: string | null;
      statusMessage?: string | null;
      bannerUrl?: string | null;
    },
  ) => mutateJson<{ success: boolean }>(
    'PATCH',
    `/api/users/${encodeURIComponent(username)}`,
    data,
  ),

  // User banner upload — image, ≤ 1MB. Resolves to a stable
  // `/uploads/user-banners/<id>.<ext>` path stored on users.banner_url.
  uploadUserBanner: async (file: File) => {
    const fd = new FormData();
    fd.append('banner', file);
    const csrf = readCsrfToken();
    const res = await fetch(`${API_BASE}/api/users/me/banner`, {
      method: 'POST',
      credentials: 'include',
      headers: csrf ? { 'X-CSRF-Token': csrf } : {},
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Upload failed: ${res.status}`);
    }
    return res.json() as Promise<{ success: boolean; path: string }>;
  },

  // User avatar upload
  uploadAvatar: async (file: File) => {
    const fd = new FormData();
    fd.append('avatar', file);
    const csrf = readCsrfToken();
    const res = await fetch(`${API_BASE}/api/users/me/avatar`, {
      method: 'POST',
      credentials: 'include',
      headers: csrf ? { 'X-CSRF-Token': csrf } : {},
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Upload failed: ${res.status}`);
    }
    return res.json() as Promise<{ success: boolean; path: string }>;
  },

  // Remove avatar — resets avatarPath to null, best-effort deletes the file.
  deleteAvatar: () => deleteJson<{ success: boolean }>('/api/users/me/avatar'),

  // Preferences
  getMyPreferences: () => fetchJson<ApiUserPreferences>('/api/users/me/preferences'),
  updateMyPreferences: (prefs: Partial<Omit<ApiUserPreferences, 'updatedAt'>>) =>
    putJson<{ success: boolean }>('/api/users/me/preferences', prefs),
  /** Reveal a league's results through `week` (catch-up: reveals weeks 1..week).
   *  Returns the updated per-league high-water-mark map. (Legacy — unused now.) */
  revealSpoilerWeek: (leagueId: string, week: number) =>
    postJson<{ spoilerRevealedThrough: Record<string, number> }>(
      '/api/users/me/spoiler-reveal', { leagueId, week }),
  /** Reveal a single match by its stable id. Persists per user across reloads.
   *  Returns the updated set of revealed match ids. */
  revealSpoilerMatch: (matchId: string) =>
    postJson<{ success: true; spoilerRevealedMatches: string[] }>(
      '/api/users/me/spoiler-reveal-match', { matchId }),

  // Lifetime stats + public profile
  getLifetimeStats: () => fetchJson<ApiLifetimeStats>('/api/users/me/lifetime-stats'),
  getPublicProfile: (username: string) =>
    fetchJson<ApiPublicProfile>(`/api/users/${encodeURIComponent(username)}`),

  // Health probe (used by admin shell to surface live/mock badge)
  getHealth: () => fetchJson<{
    status: 'ok' | 'degraded';
    mode: 'live' | 'mock';
    db: 'connected' | 'disconnected';
    uptime: number;
  }>('/api/health'),

  // PS Bot
  getBotStatus: () => fetchJson<ApiBotStatus>('/api/admin/bot-status'),
  reconnectBot: () => postJson<{ success: boolean }>('/api/admin/bot/reconnect'),

  // Pin audit-log backfill (idempotent)
  backfillPinAudit: () =>
    postJson<{ inserted: number; skipped: number }>('/api/admin/pins/backfill-audit'),

  runJob: (name: string) => postJson<{ success: boolean }>(`/api/admin/jobs/${name}/run`),

  forceMatchResult: (matchId: string, data: {
    homeScore: number;
    awayScore: number;
    forfeitedBy?: 'home' | 'away' | 'both' | null;
    note?: string;
    pokemonData?: { teamId: string; pokemonName: string; kills: number; deaths: number; teraUsed?: boolean; teraType?: string }[];
  }) =>
    postJson<{ success: boolean }>(`/api/admin/matches/${matchId}/force-result`, data),

  importMatchBattle: (matchId: string, data: {
    roomId?: string;
    replay?: string;
    /** Override when auto-detection is wrong. 'p1IsHome' = p1 is Cannoli home team; 'p2IsHome' = p2. */
    sideOverride?: 'p1IsHome' | 'p2IsHome';
  }) =>
    postJson<{
      success: boolean;
      homeScore: number;
      awayScore: number;
      winnerTeamId: string | null;
      pokemonCount: number;
      /** True when orientation could not be auto-detected. Admin should confirm sides. */
      sidesUncertain: boolean;
      /** PS username of p1 side (from replay |player| lines). */
      detectedP1: string;
      /** PS username of p2 side (from replay |player| lines). */
      detectedP2: string;
    }>(`/api/admin/matches/${matchId}/import-battle`, data),

  // Team logo
  uploadTeamLogo: async (teamId: string, file: File) => {
    const fd = new FormData();
    fd.append('logo', file);
    const csrf = readCsrfToken();
    const res = await fetch(`${API_BASE}/api/teams/${teamId}/logo`, {
      method: 'POST',
      credentials: 'include',
      headers: csrf ? { 'X-CSRF-Token': csrf } : {},
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Upload failed: ${res.status}`);
    }
    return res.json() as Promise<{ success: boolean; path: string }>;
  },

  removeTeamLogo: (teamId: string) =>
    deleteJson<{ success: boolean }>(`/api/teams/${teamId}/logo`),

  // Team banner
  uploadTeamBanner: async (teamId: string, file: File) => {
    const fd = new FormData();
    fd.append('banner', file);
    const csrf = readCsrfToken();
    const res = await fetch(`${API_BASE}/api/teams/${teamId}/banner`, {
      method: 'POST',
      credentials: 'include',
      headers: csrf ? { 'X-CSRF-Token': csrf } : {},
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Upload failed: ${res.status}`);
    }
    return res.json() as Promise<{ success: boolean; path: string }>;
  },

  // Season + Team admin
  createSeason: (data: {
    seasonNumber: number;
    totalWeeks?: number;
    pointCap?: number;
    teraCaptainSlots?: number;
    tradeDeadlineWeek?: number;
    rosterSize?: number;
    forfeitPolicy?: 'double_forfeit' | 'admin_review';
    weekDates?: Record<string, string> | null;
    leagues?: {
      id: string;
      name: string;
      color: string;
      draftDate?: string | null;
      teams?: {
        coachName?: string;
        teamName: string;
        teamAbbrev: string;
        teamColor?: string;
        managerUsername?: string | null;
      }[];
    }[];
    overlapOverride?: boolean;
  }) => postJson<{
    id: number;
    seasonNumber: number;
    teamsCreated: number;
    unresolvedManagers: string[];
  }>('/api/seasons', data),

  createTeam: (leagueId: string, data: {
    id?: string;
    coachName: string;
    teamName: string;
    teamAbbrev: string;
    teamColor?: string;
    userId?: number | null;
  }) => postJson<{ id: string }>(`/api/leagues/${leagueId}/teams`, data),

  updateTeam: (teamId: string, data: {
    coachName?: string;
    teamName?: string;
    teamAbbrev?: string;
    teamColor?: string;
    userId?: number | null;
    bio?: string | null;
    captainNote?: string | null;
  }) => putJson<{ success: boolean }>(`/api/teams/${teamId}`, data),

  deleteTeam: (teamId: string, opts?: { force?: boolean }) =>
    deleteJson<{ success: boolean }>(`/api/teams/${teamId}${opts?.force ? '?force=1' : ''}`),

  // League membership (add / move / remove coaches before draft start)
  getMembership: () => fetchJson<ApiMembership>('/api/admin/membership'),
  addCoach: (data: {
    leagueId: string;
    userId: number;
    teamName: string;
    teamAbbrev: string;
    teamColor?: string;
    coachName?: string;
  }) => postJson<{ id: string }>('/api/admin/membership/add', data),
  moveCoach: (teamId: string, toLeagueId: string) =>
    postJson<{ success: boolean }>('/api/admin/membership/move', { teamId, toLeagueId }),
  replaceCoach: (teamId: string, body: { newUserId: number; coachName?: string }) =>
    postJson<{ success: boolean }>('/api/admin/membership/replace-coach', { teamId, ...body }),
  removeCoachTeam: (teamId: string) =>
    deleteJson<{ success: boolean }>(`/api/admin/membership/team/${teamId}`),

  // Feedback (multipart: a screenshot File may be attached)
  submitFeedback: async (input: {
    category: FeedbackCategory;
    title: string;
    description: string;
    page?: string;
    errorRef?: string;
    screenshot?: File;
  }) => {
    const fd = new FormData();
    fd.append('category', input.category);
    fd.append('title', input.title);
    fd.append('description', input.description);
    if (input.page) fd.append('page', input.page);
    if (input.errorRef) fd.append('errorRef', input.errorRef);
    if (input.screenshot) fd.append('screenshot', input.screenshot);
    const csrf = readCsrfToken();
    const res = await fetch(`${API_BASE}/api/feedback`, {
      method: 'POST',
      credentials: 'include',
      headers: csrf ? { 'X-CSRF-Token': csrf } : {},
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Failed: ${res.status}`);
    }
    return res.json() as Promise<{ success: boolean; id: number; issueNumber: number | null; issueUrl: string | null }>;
  },

  // Admin feedback triage (reads from the feedback table)
  getAdminFeedback: (params?: { category?: string; status?: string; hasGithub?: string }) => {
    const q = new URLSearchParams();
    if (params?.category) q.set('category', params.category);
    if (params?.status) q.set('status', params.status);
    if (params?.hasGithub) q.set('hasGithub', params.hasGithub);
    const qs = q.toString();
    return fetchJson<ApiFeedbackItem[]>(`/api/admin/feedback${qs ? `?${qs}` : ''}`);
  },

  resolveFeedback: (id: number, response?: string) =>
    postJson<{ success: boolean }>(`/api/admin/feedback/${id}/resolve`, { response }),

  // First-test + ongoing pattern: notify reporters of closed GitHub issues.
  backfillFeedbackNotifications: (issues?: number[]) =>
    postJson<{ inserted: number; skipped: number; noUser: number; unconfigured?: boolean }>(
      '/api/admin/notifications/backfill-feedback', { issues }),

  // Silent on-login sync: detects closed GitHub issues and routes resolutions to
  // the notifications pane (no toast). Returns a count only.
  syncFeedbackResolutions: () =>
    fetchJson<{ notified: number }>('/api/feedback/notifications'),

  // Changelog ("What's New") — still served standalone; the pane aggregates it.
  getChangelog: () =>
    fetchJson<{ entries: ApiChangelogEntry[]; lastSeenAt: string | null }>('/api/changelog'),

  markChangelogSeen: () =>
    postJson<{ success: boolean; seenAt: string }>('/api/changelog/seen'),

  // ─── Unified notifications pane ──────────────────────────────────────────
  getNotifications: () => fetchJson<NotificationsResponse>('/api/notifications'),

  /** Mark everything seen on pane open (changelog + announcements + all directed rows). */
  markNotificationsSeen: () => postJson<{ success: boolean }>('/api/notifications/seen'),

  /** Mark specific directed notifications read (composite ids; non-directed ids ignored). */
  markNotificationsRead: (ids: string[]) =>
    postJson<{ success: boolean }>('/api/notifications/read', { ids }),

  // ─── Admin announcement composer ─────────────────────────────────────────
  listAnnouncements: () => fetchJson<ApiAnnouncement[]>('/api/admin/announcements'),

  createAnnouncement: (a: {
    title: string;
    body: string;
    link?: string;
    category: AnnouncementCategory;
    surface?: AnnouncementSurface;
    leagueId?: string | null;
    targetRole?: 'admin' | 'user' | null;
  }) =>
    postJson<{ id: number }>('/api/admin/announcements', a),

  updateAnnouncement: (id: number, fields: Partial<{
    title: string;
    body: string;
    link: string | null;
    category: AnnouncementCategory;
    surface: AnnouncementSurface;
    leagueId: string | null;
    targetRole: 'admin' | 'user' | null;
  }>) =>
    patchJson<{ success: boolean }>(`/api/admin/announcements/${id}`, fields),

  retractAnnouncement: (id: number) =>
    deleteJson<{ success: boolean }>(`/api/admin/announcements/${id}`),

  getBanners: () => fetchJson<ApiBanner[]>('/api/banners'),

  dismissAnnouncement: (id: number) =>
    postJson<{ success: boolean }>(`/api/announcements/${id}/dismiss`),

  getAdminNotificationLog: (params?: { before?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.before) q.set('before', params.before);
    if (params?.limit != null) q.set('limit', String(params.limit));
    const qs = q.toString();
    return fetchJson<AdminNotificationLog>(`/api/admin/notifications/log${qs ? `?${qs}` : ''}`);
  },

  // Match management
  getAdminMatches: (params?: { leagueId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.leagueId) q.set('leagueId', params.leagueId);
    if (params?.status) q.set('status', params.status);
    return fetchJson<ApiAdminMatch[]>(`/api/admin/matches?${q}`);
  },

  recordMatchResult: (matchId: string, data: {
    homeScore: number;
    awayScore: number;
    replayUrl?: string;
    pokemonData?: { teamId: string; pokemonName: string; kills: number; deaths: number; teraUsed?: boolean; teraType?: string }[];
    warnings?: string[];
  }) => postJson<{ success: boolean }>(`/api/matches/${matchId}/result`, data),

  dismissMatchWarnings: (matchId: string) =>
    postJson<{ success: boolean }>(`/api/matches/${matchId}/dismiss-warnings`),

  voidMatch: (matchId: string) =>
    postJson<{ success: boolean }>(`/api/matches/${matchId}/void`),

  updateMatch: (matchId: string, data: { week?: number; deadline?: string | null }) =>
    mutateJson<{ success: boolean }>('PATCH', `/api/matches/${matchId}`, data),

  deleteMatch: (matchId: string) =>
    deleteJson<{ success: boolean }>(`/api/matches/${matchId}`),

  // Tera captain management
  saveTerraCaptains: (teamId: string, captains: { pokemonName: string; teraTypes: string[] }[]) =>
    putJson<{ success: boolean; captainsLocked?: boolean; phaseAdvanced?: boolean }>(
      `/api/teams/${teamId}/tera-captains`, { captains },
    ),

  toggleShiny: (teamId: string, pokemonName: string, isShiny: boolean) =>
    putJson<{ success: boolean }>(`/api/teams/${teamId}/shiny`, { pokemonName, isShiny }),

  setRosterNickname: (teamId: string, rosterId: number, nickname: string | null) =>
    putJson<{ success: boolean; nickname: string | null }>(
      `/api/teams/${teamId}/rosters/${rosterId}/nickname`, { nickname },
    ),

  // Free agents
  getFreeAgents: (leagueId: string, teamId?: string) => {
    const url = teamId
      ? `/api/leagues/${leagueId}/free-agents?teamId=${encodeURIComponent(teamId)}`
      : `/api/leagues/${leagueId}/free-agents`;
    return fetchJson<
      | { name: string; tier: number; type1: string; type2: string | null; stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } }[]
      | {
          freeAgents: { name: string; tier: number; type1: string; type2: string | null; stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } }[];
          budget: { faUsed: number; faRemaining: number; faPerSeason: number };
        }
    >(url);
  },

  freeAgentPickup: (
    leagueId: string,
    data: { teamId: string; pickupNames: string[]; dropNames?: string[] },
  ) =>
    postJson<{ success: boolean; faUsed: number; faRemaining: number; faPerSeason: number }>(
      `/api/leagues/${leagueId}/free-agents/pickup`,
      data,
    ),

  // Speed tiers (rostered pokemon + base speed + ability list, league-wide)
  getSpeedTiers: (leagueId: string) =>
    fetchJson<ApiSpeedTierRow[]>(`/api/leagues/${leagueId}/speed-tiers`),

  // Global speed tiers — all active-season leagues, frontend filters client-side
  getGlobalSpeedTiers: () =>
    fetchJson<ApiSpeedTierRow[]>(`/api/speed-tiers`),

  // Cross-league ownership for a single Pokemon (for global pages + side card)
  getPokemonGlobalOwnership: (name: string) =>
    fetchJson<ApiGlobalOwnership[]>(`/api/pokemon/${encodeURIComponent(name)}/global-ownership`),

  // Recent completed matches across active leagues that featured this Pokemon
  getPokemonRecentBattles: (name: string, limit = 10) =>
    fetchJson<ApiPokemonRecentBattle[]>(`/api/pokemon/${encodeURIComponent(name)}/recent-battles?limit=${limit}`),

  // Player availability
  getAvailability: (leagueId: string) =>
    fetchJson<{ id: number; teamId: string; leagueId: string; week: number; day: string; status: string; note: string | null }[]>(
      `/api/leagues/${leagueId}/availability`
    ),

  setAvailability: (leagueId: string, data: { teamId: string; week: number; day: string; status: string; note?: string }) =>
    putJson<{ success: boolean }>(`/api/leagues/${leagueId}/availability`, data),

  // Pokemon lookup
  getPokemonByName: (name: string) =>
    fetchJson<{ id: number; name: string; type1: string; type2: string | null; hp: number; atk: number; def: number; spa: number; spd: number; spe: number; ability1: string | null; ability2: string | null; hiddenAbility: string | null; tier: number } | null>(
      `/api/pokemon/${encodeURIComponent(name)}`
    ),

  // Bulk pokemon search (paginated)
  getPokemonList: (params?: { search?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    return fetchJson<{ id: number; name: string; type1: string; type2: string | null; tier: number; hp: number; atk: number; def: number; spa: number; spd: number; spe: number; ability1: string | null; ability2: string | null; hiddenAbility: string | null }[]>(
      `/api/pokemon?${q}`
    );
  },

  // ─── Pins / achievements ──────────────────────────────────────────────
  getUserPins: (username: string) =>
    fetchJson<ApiPin[]>(`/api/users/${encodeURIComponent(username)}/pins`),

  getPinDefinitions: () => fetchJson<ApiPinDefinition[]>('/api/admin/pin-definitions'),

  createPinDefinition: (data: {
    id: string;
    name: string;
    description?: string;
    iconName: string;
    color: string;
    category: PinCategory;
  }) => postJson<{ success: boolean; id: string }>('/api/admin/pin-definitions', data),

  updatePinDefinition: (id: string, data: {
    name?: string;
    description?: string;
    iconName?: string;
    color?: string;
    category?: PinCategory;
  }) => mutateJson<{ success: boolean }>('PATCH', `/api/admin/pin-definitions/${encodeURIComponent(id)}`, data),

  awardPin: (data: { userId: number; pinDefId: string; metadata?: Record<string, unknown>; seasonId?: number | null }) =>
    postJson<{ success: boolean; id: number | null }>('/api/admin/pins/award', data),

  revokePin: (id: number) =>
    deleteJson<{ success: boolean }>(`/api/admin/pins/${id}`),

  getRecentPins: (limit = 50) =>
    fetchJson<ApiPinRecent[]>(`/api/admin/pins/recent?limit=${limit}`),

  // Bulk-mint wizard: preview then confirm.
  getManualAwards: (season: number) =>
    fetchJson<{ season: number; awards: ApiManualAward[] }>(
      `/api/admin/pins/manual-awards/${season}`,
    ),

  mintSeasonAwards: (season: number) =>
    postJson<{
      success: boolean;
      inserted: number;
      skipped: number;
      unresolved: { award: ApiManualAward; reason: string }[];
    }>('/api/admin/pins/mint-season', { season }),

  /** Re-run the season-end auto-award job for every league in a season.
   *  Used by the Pins admin Mint button (only enabled in offseason / past finals). */
  runSeasonAutoAwards: (season: number) =>
    postJson<{
      success: boolean;
      season: number;
      totalAwarded: number;
      totalSkipped: number;
      perLeague: { leagueId: string; awarded: number; skipped: number }[];
    }>('/api/admin/pins/run-auto', { season }),

  /** Re-point an existing pin to a different user (used to override an
   *  auto-awarded pin without revoke + re-award). */
  updatePinRecipient: (id: number, data: { userId?: number; metadata?: Record<string, unknown> }) =>
    mutateJson<{ success: boolean }>('PATCH', `/api/admin/pins/${id}`, data),

  // ─── Season Simulator (mock-mode only) ──────────────────────────────────
  // Drives the mock.cannoli.live interactive season simulator. Every endpoint
  // is mock-gated server-side — calls 403 on a live backend.
  getSimState: () => fetchJson<ApiSimState>('/api/admin/sim/state'),

  simAdvanceWeek: (leagueId: string) =>
    postJson<{ ok: boolean; leagueId: string; matchesPlayed: number; weekBefore: number; weekAfter: number }>(
      '/api/admin/sim/advance-week', { leagueId },
    ),

  simMatch: (matchId: string) =>
    postJson<{ ok: boolean; matchId: string; homeScore: number; awayScore: number }>(
      `/api/admin/sim/match/${matchId}`,
    ),

  simWeek: (leagueId: string, week: number) =>
    postJson<{ ok: boolean; leagueId: string; week: number; matchesPlayed: number; throughWeek: number }>(
      `/api/admin/sim/week/${week}`, { leagueId },
    ),

  simAutoCompleteDraft: (leagueId: string) =>
    postJson<{ ok: boolean; leagueId: string; picks: number; captainsAssigned: number }>(
      '/api/admin/sim/draft/auto-complete', { leagueId },
    ),

  simGeneratePlayoffs: (leagueId: string) =>
    postJson<{ ok: boolean; leagueId: string; matchesPlayed: number; championId: string }>(
      '/api/admin/sim/playoffs/generate', { leagueId },
    ),

  simPhase: (leagueId: string, phase: string, opts?: { override?: boolean; confirm?: boolean }) =>
    postJson<{ ok: boolean; leagueId: string; from: string; to: string; teams: number }>(
      '/api/admin/sim/phase', { leagueId, phase, ...opts },
    ),

  simReset: (opts?: { masterSeed?: string }) =>
    postJson<{
      ok: boolean;
      droppedTables: number;
      masterSeed: string;
      totals: Record<string, number>;
      seasons: ApiSimSeason[];
    }>('/api/admin/sim/reset', { confirm: 'reset', ...(opts?.masterSeed ? { masterSeed: opts.masterSeed } : {}) }),

  simResetWeek: (leagueId: string, week: number) =>
    postJson<{ ok: boolean; leagueId: string; week: number; matchesVoided: number; currentWeek: number }>(
      `/api/admin/sim/reset-week/${week}`, { leagueId },
    ),

  simResetMatch: (matchId: string) =>
    postJson<{ ok: boolean; matchId: string }>(`/api/admin/sim/reset-match/${matchId}`),

  // ─── Rules content ───────────────────────────────────────────────────
  getRules: () => fetchJson<{ rulesText: string | null }>('/api/rules'),
  saveRules: (rulesText: string | null) =>
    putJson<{ success: boolean }>('/api/rules', { rulesText }),
};

// ─── Simulator types ─────────────────────────────────────────────────────────

export interface ApiSimSeason {
  id: number;
  seasonNumber: number;
  pointCap: number;
  teraCaptainSlots: number;
}

export interface ApiSimLeague {
  id: string;
  name: string;
  seasonId: number;
  phase: 'predraft' | 'draft' | 'regular' | 'playoffs' | 'offseason';
  currentWeek: number;
  totalWeeks: number;
  paused: boolean;
  regular: { completed: number; total: number };
  playoffs: { completed: number; total: number };
}

export interface ApiSimState {
  ok: boolean;
  mode: 'live' | 'mock';
  seasons: ApiSimSeason[];
  leagues: ApiSimLeague[];
}

/** Mirrors `ManualAward` in backend/src/lib/pins/awards-data.ts. The discriminated
 *  union over `username` vs `pokemon` is flattened to optional fields here
 *  because the wizard renders both shapes generically. */
export interface ApiManualAward {
  pin: string;
  leagueId?: string;
  season?: number;
  username?: string;
  pokemon?: string;
  nickname?: string;
}
