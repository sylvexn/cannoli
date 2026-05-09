import type { ApiMatch, ApiTeam } from '@/lib/api';
import type { League } from '@/lib/types';

export interface QueueEntry {
  id: string;
  match: ApiMatch;
  league: League;
  homeTeam: ApiTeam | undefined;
  awayTeam: ApiTeam | undefined;
  homeRank: number | undefined;
  awayRank: number | undefined;
}

export type StreamPhase = 'preroll' | 'replay' | 'postroll';

export interface PersistedState {
  order: string[];
  index: number;
  featured: string[];
  prerollDelayMs: number;
}

export const POSTROLL_MS = 8000;
export const IDLE_FADE_MS = 2000;
export const PREROLL_DELAY_OPTIONS = [3000, 5000, 8000];

export function storageKey(week: string | undefined): string {
  return `cannoli:stream:week-${week ?? 'unknown'}`;
}

