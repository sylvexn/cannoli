/**
 * API client for the Cannoli backend.
 * All league-scoped data flows through these functions.
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

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
    const e: Error & { body?: any; status?: number; code?: string } =
      new Error(err.error || `API error: ${res.status}`);
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

// ─── Types (matching backend response shapes) ────────────────────────────────

export interface ApiLeague {
  id: string;
  name: string;
  color: string;
  draftDate?: string | null;
  draftOrder?: string[] | null;
  playoffTeamCount?: number;
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
  } | null;
}

export interface ApiCoachOwner {
  username: string;
  displayName: string | null;
  avatarPath: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  role: 'dev' | 'admin' | 'user';
  // Coach flair — surfaced inline so CoachLink can render the type chip
  // wherever a team owner appears (no extra fetch).
  title?: string | null;
  signatureType?: string | null;
}

export interface ApiTeam {
  id: string;
  name: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  rank: number;
  showdownUsername: string | null;
  logoPath?: string | null;
  bannerPath?: string | null;
  bio?: string | null;
  /** Short team motto, ≤ 80 chars (owner-editable). */
  motto?: string | null;
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
  warnings: string[];
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
}

// ─── API functions ───────────────────────────────────────────────────────────

// ─── Auth response types ────────────────────────────────────────────────────

export interface ApiAuthUser {
  id: string;
  username: string;
  role: 'dev' | 'admin' | 'user';
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
  notifyTrades: boolean;
  notifyMatches: boolean;
  notifyAnnouncements: boolean;
  /** IANA zone (e.g. "America/New_York"); null means use the browser zone. */
  timezone: string | null;
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
  // ─── Coach flair ────────────────────────────────────────────────────────
  /** Short user-set flair string, ≤ 40 chars. */
  title?: string | null;
  /** Canonical Pokemon type name — drives chip + optional avatar tint. */
  signatureType?: string | null;
  /** User's role — surfaced on the profile page as an ADMIN chip when
   *  applicable. Only set on backends that include it (older deploys may
   *  omit it; treat undefined as `'user'`). */
  role?: 'dev' | 'admin' | 'user' | null;
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

export interface ApiSiteSettings {
  siteName: string | null;
  announcement: string | null;
  announcementType: string | null;
  defaultPointCap: number | null;
  defaultTeraCaptainSlots: number | null;
  defaultTradeDeadlineWeek: number | null;
  defaultRosterSize: number | null;
  defaultMaxTeams: number | null;
  defaultUserPassword: string | null;
  draftTimerEnabled: boolean;
  draftDemoVisible: boolean;
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

// ─── Speed Tiers ─────────────────────────────────────────────────────────

export interface ApiSpeedTierRow {
  /** Stable composite id (per-league) `<leagueId>:<teamId>:<pokemonName>`. */
  id: string;
  name: string;
  /** Owner-set nickname (per rosters.nickname). Null when not set. */
  nickname?: string | null;
  /** Owner-set shiny flag (per rosters.isShiny). */
  isShiny?: boolean;
  dex: number | null;
  baseSpeed: number;
  type1: string | null;
  type2: string | null;
  tier: number;
  isTeraCaptain: boolean;
  abilities: string[];
  /** Present when the row is fetched via the global endpoint. Null on the
   *  legacy per-league endpoint (caller already knows the league). */
  league?: { id: string; name: string; color: string } | null;
  owner: {
    teamId: string;
    teamAbbrev: string;
    teamName: string;
    teamColor: string;
    logoPath: string | null;
  } | null;
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
  isTeraCaptain: boolean;
  nickname: string | null;
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

export interface ApiFeedbackIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: (string | undefined)[];
  createdAt: string;
  closedAt: string | null;
  url: string;
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    postJson<{ user: ApiAuthUser }>('/api/auth/login', { username, password }),

  logout: () => postJson<{ success: boolean }>('/api/auth/logout'),

  me: () => fetchJson<{ user: ApiAuthUser | null }>('/api/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    postJson<{ success: boolean }>('/api/auth/change-password', { currentPassword, newPassword }),

  // League data
  getLeagues: () => fetchJson<ApiLeague[]>('/api/leagues'),

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

  getSiteSettings: () => fetchJson<ApiSiteSettings>('/api/site-settings'),

  getMoveCategories: () => fetchJson<ApiMoveCategory[]>('/api/move-categories'),

  getTrades: (leagueId: string) => fetchJson<ApiTrade[]>(`/api/leagues/${leagueId}/trades`),

  getTradeBlock: (leagueId: string) => fetchJson<ApiTradeBlockListing[]>(`/api/leagues/${leagueId}/trade-block`),

  getTierList: () => fetchJson<ApiTierListEntry[]>('/api/tier-list'),

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
    data: { tier?: number; status?: string; force?: boolean; confirmLeague?: string },
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

  // Who's online — used by the sidebar widget. 30s poll cadence on the
  // frontend; no caching here since it's already cheap (single SELECT).
  getOnlineUsers: () => fetchJson<{ users: Array<{
    id: number;
    username: string;
    displayName: string | null;
    avatarPath: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    tertiaryColor: string | null;
    role: 'dev' | 'admin' | 'user';
    statusMessage: string | null;
    lastSeenAt: string | null;
  }> }>('/api/online'),

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

  // Preferences
  getMyPreferences: () => fetchJson<ApiUserPreferences>('/api/users/me/preferences'),
  updateMyPreferences: (prefs: Partial<Omit<ApiUserPreferences, 'updatedAt'>>) =>
    putJson<{ success: boolean }>('/api/users/me/preferences', prefs),

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
    showdownUsername?: string | null;
  }) => postJson<{ id: string }>(`/api/leagues/${leagueId}/teams`, data),

  updateTeam: (teamId: string, data: {
    coachName?: string;
    teamName?: string;
    teamAbbrev?: string;
    teamColor?: string;
    userId?: number | null;
    showdownUsername?: string | null;
    bio?: string | null;
    motto?: string | null;
    captainNote?: string | null;
  }) => putJson<{ success: boolean }>(`/api/teams/${teamId}`, data),

  deleteTeam: (teamId: string, opts?: { force?: boolean }) =>
    deleteJson<{ success: boolean }>(`/api/teams/${teamId}${opts?.force ? '?force=1' : ''}`),

  // Feedback
  submitFeedback: (title: string, description: string, page?: string) =>
    postJson<{ success: boolean; issueNumber: number; issueUrl: string }>('/api/feedback', { title, description, page }),

  getFeedbackIssues: (state?: 'open' | 'closed' | 'all') =>
    fetchJson<ApiFeedbackIssue[]>(`/api/admin/issues${state ? `?state=${state}` : ''}`),

  getFeedbackNotifications: () =>
    fetchJson<{ issueNumber: number; title: string; issueUrl: string }[]>('/api/feedback/notifications'),

  acknowledgeFeedback: (issueNumber: number) =>
    postJson<{ success: boolean }>(`/api/feedback/${issueNumber}/acknowledge`),

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
  getFreeAgents: (leagueId: string) =>
    fetchJson<{ name: string; tier: number; type1: string; type2: string | null; stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } }[]>(
      `/api/leagues/${leagueId}/free-agents`
    ),

  freeAgentPickup: (leagueId: string, data: { teamId: string; pokemonName: string; dropPokemonName?: string }) =>
    postJson<{ success: boolean }>(`/api/leagues/${leagueId}/free-agents/pickup`, data),

  // Speed tiers (rostered pokemon + base speed + ability list, league-wide)
  getSpeedTiers: (leagueId: string) =>
    fetchJson<ApiSpeedTierRow[]>(`/api/leagues/${leagueId}/speed-tiers`),

  // Global speed tiers — all active-season leagues, frontend filters client-side
  getGlobalSpeedTiers: () =>
    fetchJson<ApiSpeedTierRow[]>(`/api/speed-tiers`),

  // Cross-league ownership for a single Pokemon (for global pages + side card)
  getPokemonGlobalOwnership: (name: string) =>
    fetchJson<ApiGlobalOwnership[]>(`/api/pokemon/${encodeURIComponent(name)}/global-ownership`),

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
};
