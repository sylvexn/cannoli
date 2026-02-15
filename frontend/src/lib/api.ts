/**
 * API client for the Cannoli backend.
 * All league-scoped data flows through these functions.
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function mutateJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
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
  season: {
    id: string;
    seasonNumber: number;
    phase: 'draft' | 'regular' | 'playoffs' | 'offseason';
    currentWeek: number;
    totalWeeks: number;
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
  phase: string;
  playoffRound: string | null;
  homeSeed: number | null;
  awaySeed: number | null;
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

export interface ApiPokemonStat {
  pokemonName: string;
  teamId: string;
  kills: number;
  deaths: number;
  gp: number;
  differential: number;
  kpg: number;
  types: string[];
  tier: number;
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
}

export interface ApiMoveCategory {
  id: string;
  name: string;
  entries: { name: string; moveId: string; isAbility: boolean }[];
}

export interface ApiTrade {
  id: string;
  leagueId: string;
  week: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
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

  getTeams: (leagueId: string) => fetchJson<ApiTeam[]>(`/api/leagues/${leagueId}/teams`),

  getSchedule: (leagueId: string) => fetchJson<ApiMatch[]>(`/api/leagues/${leagueId}/schedule`),

  getMatchPokemon: (matchId: string) => fetchJson<{ home: ApiMatchPokemon[]; away: ApiMatchPokemon[] }>(`/api/matches/${matchId}/pokemon`),

  getTransactions: (leagueId: string) => fetchJson<ApiTransaction[]>(`/api/leagues/${leagueId}/transactions`),

  getDraftPicks: (leagueId: string) => fetchJson<ApiDraftPick[]>(`/api/leagues/${leagueId}/draft`),

  getStats: (leagueId: string) => fetchJson<ApiPokemonStat[]>(`/api/leagues/${leagueId}/stats`),

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

  updateTierListEntry: (name: string, data: { tier?: number; status?: string }) =>
    putJson<{ success: boolean }>(`/api/tier-list/${encodeURIComponent(name)}`, data),

  createMoveCategory: (name: string) =>
    postJson<{ id: string; name: string }>('/api/move-categories', { name }),

  updateMoveCategory: (id: string, name: string) =>
    putJson<{ success: boolean }>(`/api/move-categories/${id}`, { name }),

  deleteMoveCategory: (id: string) =>
    deleteJson<{ success: boolean }>(`/api/move-categories/${id}`),

  addMoveCategoryEntry: (catId: string, name: string, isAbility?: boolean) =>
    postJson<{ success: boolean }>(`/api/move-categories/${catId}/entries`, { name, isAbility }),

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

  draftPick: (leagueId: string, pokemonName: string, teamId?: string) =>
    postJson<{ success: boolean; pick: ApiDraftPick }>(`/api/leagues/${leagueId}/draft/pick`, { pokemonName, teamId }),

  pauseDraft: (leagueId: string) =>
    postJson<{ success: boolean }>(`/api/leagues/${leagueId}/draft/pause`),

  resumeDraft: (leagueId: string) =>
    postJson<ApiDraftState>(`/api/leagues/${leagueId}/draft/resume`),

  autoPick: (leagueId: string) =>
    postJson<{ success: boolean }>(`/api/leagues/${leagueId}/draft/auto-pick`),

  approveTrade: (tradeId: string) =>
    postJson<{ success: boolean }>(`/api/trades/${tradeId}/approve`),

  rejectTrade: (tradeId: string, reason?: string) =>
    postJson<{ success: boolean }>(`/api/trades/${tradeId}/reject`, { reason }),

  // User write (own team)
  addTradeBlockListing: (leagueId: string, data: { pokemonName: string; note?: string; teamId?: string }) =>
    postJson<{ id: number }>(`/api/leagues/${leagueId}/trade-block`, data),

  removeTradeBlockListing: (id: number) =>
    deleteJson<{ success: boolean }>(`/api/trade-block-listings/${id}`),

  proposeTrade: (leagueId: string, data: { recipientId: string; offering: string[]; requesting: string[]; proposerId?: string }) =>
    postJson<{ id: string }>(`/api/leagues/${leagueId}/trades/propose`, data),
};
