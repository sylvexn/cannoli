/**
 * API client for the Cannoli backend.
 * All league-scoped data flows through these functions.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
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

export const api = {
  getLeagues: () => fetchJson<ApiLeague[]>('/api/leagues'),

  getTeams: (leagueId: string) => fetchJson<ApiTeam[]>(`/api/leagues/${leagueId}/teams`),

  getSchedule: (leagueId: string) => fetchJson<ApiMatch[]>(`/api/leagues/${leagueId}/schedule`),

  getMatchPokemon: (matchId: string) => fetchJson<{ home: ApiMatchPokemon[]; away: ApiMatchPokemon[] }>(`/api/matches/${matchId}/pokemon`),

  getTransactions: (leagueId: string) => fetchJson<ApiTransaction[]>(`/api/leagues/${leagueId}/transactions`),

  getDraftPicks: (leagueId: string) => fetchJson<ApiDraftPick[]>(`/api/leagues/${leagueId}/draft`),

  getStats: (leagueId: string) => fetchJson<ApiPokemonStat[]>(`/api/leagues/${leagueId}/stats`),
};
