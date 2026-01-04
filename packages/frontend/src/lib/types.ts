import type { PokemonType } from './pokemon';

export interface Player {
  id: string;
  name: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  record: { wins: number; losses: number; differential: number };
  roster: RosterPokemon[];
}

export interface RosterPokemon {
  name: string;
  types: PokemonType[];
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
}

export interface Match {
  id: string;
  week: number;
  homePlayer: string;
  awayPlayer: string;
  homeScore?: number;
  awayScore?: number;
  replayUrl?: string;
  pokemonKD?: {
    home: { name: string; kills: number; deaths: number }[];
    away: { name: string; kills: number; deaths: number }[];
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
  phase: 'draft' | 'regular' | 'playoffs' | 'offseason';
  currentWeek: number;
  totalWeeks: number;
}

export interface TierPokemon {
  name: string;
  tier: number;
  types: PokemonType[];
  drafted: boolean;
  draftedBy?: string;
}
