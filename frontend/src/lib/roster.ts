import type { RosterPokemon, LeagueConfig } from './types';
import { getEffectiveCost } from '@/data/tier-list';

/** Calculate effective points used by a roster (accounts for tera captain cost markup) */
export function rosterPointsUsed(roster: RosterPokemon[]): number {
  return roster.reduce((sum, mon) => sum + getEffectiveCost(mon.name, mon.isTeraCaptain), 0);
}

/** Count how many tera captains are on a roster */
export function teraCaptainCount(roster: RosterPokemon[]): number {
  return roster.filter(mon => mon.isTeraCaptain).length;
}

/** Check if a roster is within the point cap */
export function isWithinPointCap(roster: RosterPokemon[], config: LeagueConfig): boolean {
  return rosterPointsUsed(roster) <= config.pointCap;
}

/** Check if a roster has too many tera captains */
export function isWithinCaptainLimit(roster: RosterPokemon[], config: LeagueConfig): boolean {
  return teraCaptainCount(roster) <= config.teraCaptainSlots;
}
