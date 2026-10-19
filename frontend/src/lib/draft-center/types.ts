/**
 * Draft Center data model. Mirrors backend/src/lib/draft-center/types.ts — the
 * same JSON is stored server-side (logged in) and in localStorage (guests), so
 * importing local teams is a straight POST.
 */
import type { PokemonType } from '@/lib/pokemon';

export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
export type StatKey = typeof STAT_KEYS[number];
export type StatSpread = Record<StatKey, number>;

export const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
};

export interface DcSet {
  /** Move display names, max 4. */
  moves: string[];
  item: string;
  ability: string;
  nature: string;
  evs: StatSpread;
  ivs: StatSpread;
}

export interface DcMon {
  name: string;
  captain: boolean;
  /** Up to 3 tera types — only meaningful for captains. */
  teraTypes: PokemonType[];
  set?: DcSet;
}

export interface DcTeamInput {
  name: string;
  leagueId: string | null;
  roster: DcMon[];
}

export interface DcViolation {
  code: string;
  severity: 'warn' | 'info';
  message: string;
  pokemon?: string;
}

export interface DcValidation {
  used: number;
  budget: number;
  remaining: number;
  rosterSize: number;
  count: number;
  violations: DcViolation[];
}

/** A saved team as the app handles it, whether it lives on the server or in localStorage. */
export interface DcTeam extends DcTeamInput {
  id: string;
  /** Present only for server teams that have sharing switched on. */
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Server DTO = DcTeam plus the server-computed summary. */
export interface DcTeamDto extends DcTeam {
  rulesetLabel: string;
  validation: DcValidation;
}

export interface DcSharedTeam {
  name: string;
  leagueId: string | null;
  roster: DcMon[];
  updatedAt: string;
  rulesetLabel: string;
  validation: DcValidation;
  owner: { username: string; displayName: string | null; primaryColor: string | null };
}

export const MAX_TERA_TYPES = 3;
export const DEFAULT_ROSTER_SIZE = 12;
export const MAX_CAPTAIN_TIER = 9;

export const emptySpread = (v: number): StatSpread => ({ hp: v, atk: v, def: v, spa: v, spd: v, spe: v });
