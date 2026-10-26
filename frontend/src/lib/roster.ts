import type { RosterPokemon } from './types';
import type { RuleConfig } from './league-ruleset';
import { getTermCost, type TeraRules } from '@/data/tier-list';

/** Calculate effective points used by a roster (accounts for tera captain cost markup) */
export function rosterPointsUsed(roster: RosterPokemon[], rs?: TeraRules): number {
  return roster.reduce((sum, mon) => sum + (mon.isTeraCaptain ? getTermCost(mon.tier, rs) : mon.tier), 0);
}

/** Count how many tera captains are on a roster */
export function teraCaptainCount(roster: RosterPokemon[]): number {
  return roster.filter(mon => mon.isTeraCaptain).length;
}

/** Check if a roster is within the point cap */
export function isWithinPointCap(roster: RosterPokemon[], config: Pick<RuleConfig, 'pointCap' | 'teraCaptainSlots' | 'ruleset'>): boolean {
  return rosterPointsUsed(roster, config.ruleset) <= config.pointCap;
}

/** Check if a roster has too many tera captains */
export function isWithinCaptainLimit(roster: RosterPokemon[], config: Pick<RuleConfig, 'pointCap' | 'teraCaptainSlots' | 'ruleset'>): boolean {
  return teraCaptainCount(roster) <= config.teraCaptainSlots;
}
