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
    weekDates?: Record<string, string> | null;
  } | null;
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
  userId: number | null;
  record: { wins: number; losses: number; differential: number };
  roster: ApiRosterPokemon[];
}

export interface ApiRosterPokemon {
  name: string;
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
  kills: number;
  deaths: number;
  teraUsed: boolean;
  teraType: string | null;
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
  avatarPath: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  createdAt: string | null;
  currentTeams: Array<{
    teamId: string;
    leagueId: string;
    teamName: string;
    teamAbbrev: string;
    teamColor: string;
    logoPath: string | null;
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

  getSchedule: (leagueId: string) => fetchJson<ApiMatch[]>(`/api/leagues/${leagueId}/schedule`),

  getMatchPokemon: (matchId: string) => fetchJson<{ home: ApiMatchPokemon[]; away: ApiMatchPokemon[] }>(`/api/matches/${matchId}/pokemon`),

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

  deleteLeague: (id: string) =>
    deleteJson<{ success: boolean }>(`/api/leagues/${id}`),

  advancePhase: (leagueId: string, phase: string) =>
    postJson<{ success: boolean }>(`/api/leagues/${leagueId}/phase`, { phase }),

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

  // Profile colors
  updateMyColors: (colors: { primaryColor?: string | null; secondaryColor?: string | null; tertiaryColor?: string | null }) =>
    mutateJson<{ success: boolean }>('PATCH', '/api/users/me/colors', colors),

  // Profile (displayName, bio)
  updateMe: (data: { displayName?: string | null; bio?: string | null }) =>
    mutateJson<{ success: boolean }>('PATCH', '/api/users/me', data),

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

  // PS Bot
  getBotStatus: () => fetchJson<ApiBotStatus>('/api/admin/bot-status'),

  runJob: (name: string) => postJson<{ success: boolean }>(`/api/admin/jobs/${name}/run`),

  forceMatchResult: (matchId: string, data: { homeScore: number; awayScore: number; forfeitedBy?: 'home' | 'away' | 'both' | null; note?: string }) =>
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
    putJson<{ success: boolean }>(`/api/teams/${teamId}/tera-captains`, { captains }),

  toggleShiny: (teamId: string, pokemonName: string, isShiny: boolean) =>
    putJson<{ success: boolean }>(`/api/teams/${teamId}/shiny`, { pokemonName, isShiny }),

  // Free agents
  getFreeAgents: (leagueId: string) =>
    fetchJson<{ name: string; tier: number; type1: string; type2: string | null; stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } }[]>(
      `/api/leagues/${leagueId}/free-agents`
    ),

  freeAgentPickup: (leagueId: string, data: { teamId: string; pokemonName: string; dropPokemonName?: string }) =>
    postJson<{ success: boolean }>(`/api/leagues/${leagueId}/free-agents/pickup`, data),

  // Player availability
  getAvailability: (leagueId: string) =>
    fetchJson<{ id: number; teamId: string; leagueId: string; week: number; day: string; status: string; note: string | null }[]>(
      `/api/leagues/${leagueId}/availability`
    ),

  setAvailability: (leagueId: string, data: { teamId: string; week: number; day: string; status: string; note?: string }) =>
    putJson<{ success: boolean }>(`/api/leagues/${leagueId}/availability`, data),

  // Pokemon lookup
  getPokemonByName: (name: string) =>
    fetchJson<{ name: string; type1: string; type2: string | null; hp: number; atk: number; def: number; spa: number; spd: number; spe: number; ability1: string | null; ability2: string | null; hiddenAbility: string | null; tier: number } | null>(
      `/api/pokemon/${encodeURIComponent(name)}`
    ),

  // Bulk pokemon search (paginated)
  getPokemonList: (params?: { search?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    return fetchJson<{ name: string; type1: string; type2: string | null; tier: number; hp: number; atk: number; def: number; spa: number; spd: number; spe: number; ability1: string | null; ability2: string | null; hiddenAbility: string | null }[]>(
      `/api/pokemon?${q}`
    );
  },
};
