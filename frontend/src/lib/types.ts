import type { PokemonType } from './pokemon';

/** Authenticated user */
export interface User {
  id: string;
  username: string;
  role: 'dev' | 'admin' | 'user';
  mustChangePassword: boolean;
  active: boolean;
  createdAt: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  tertiaryColor?: string | null;
}

/** League-level configuration (admin-managed) */
export interface LeagueConfig {
  /** Maximum total effective points allowed on a roster */
  pointCap: number;
  /** Number of tera captains allowed per team */
  teraCaptainSlots: number;
}

export const DEFAULT_LEAGUE_CONFIG: LeagueConfig = {
  pointCap: 110,
  teraCaptainSlots: 2,
};

export interface Player {
  id: string;
  name: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  /** Owner user id (null if no manager assigned) */
  userId?: number | null;
  record: { wins: number; losses: number; differential: number };
  roster: RosterPokemon[];
}

export interface RosterPokemon {
  name: string;
  types: PokemonType[];
  /** Base tier cost (before tera captain markup) */
  tier: number;
  isTeraCaptain: boolean;
  teraTypes?: PokemonType[];
  stats: {
    hp: number; atk: number; def: number; spa: number; spd: number; spe: number;
  };
  abilities: string[];
  seasonStats: {
    kills: number; deaths: number; gp: number;
  };
  isShiny?: boolean;
}

export interface MatchPokemonEntry {
  name: string;
  kills: number;
  deaths: number;
  teraUsed: boolean;
  teraType?: PokemonType;
}

export interface Match {
  id: string;
  week: number;
  homePlayer: string;
  awayPlayer: string;
  homeScore?: number;
  awayScore?: number;
  replayUrl?: string;
  phase?: 'regular' | 'playoffs';
  playoffRound?: string | null;
  homeSeed?: number | null;
  awaySeed?: number | null;
  pokemonKD?: {
    home: MatchPokemonEntry[];
    away: MatchPokemonEntry[];
  };
}

export interface DraftPick {
  round: number;
  pick: number;
  playerId: string;
  pokemonName: string;
  tier: number;
  isTeraCaptain: boolean;
}

export interface LeagueSeason {
  id: string;
  seasonNumber: number;
  phase: 'predraft' | 'draft' | 'regular' | 'playoffs' | 'offseason';
  currentWeek: number;
  totalWeeks: number;
  pointCap: number;
  teraCaptainSlots: number;
  tradeDeadlineWeek: number;
  forfeitPolicy?: 'double_forfeit' | 'admin_review';
  paused?: boolean;
  weekDates?: Record<string, string> | null;
}

export interface Trade {
  id: string;
  week: number;
  status: 'pending' | 'awaiting_admin' | 'accepted' | 'rejected' | 'expired';
  proposer: string;
  recipient: string;
  offering: string[];
  requesting: string[];
  proposedAt: string;
  resolvedAt?: string;
}

export interface TradeBlockListing {
  teamId: string;
  pokemonName: string;
  note?: string;
}

export interface League {
  id: string;
  name: string;
  color: string;
  draftDate?: string | null;
  season: LeagueSeason;
  players: Player[];
  hasData: boolean;
}

export type EventCategory = 'admin' | 'auth' | 'config' | 'draft' | 'trade' | 'match' | 'team' | 'scrim';

export interface ActivityEvent {
  id: string;
  type: string;
  category: EventCategory;
  actor: string;
  description: string;
  leagueId?: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}
