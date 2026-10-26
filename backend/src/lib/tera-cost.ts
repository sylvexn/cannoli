/**
 * Back-compat shim over `@cannoli/rules`. Enforcement sites take a `Ruleset`
 * (via getLeagueRuleset); this default-ruleset form remains only for callers
 * that have no league (draft-center, scripts).
 */
import { DEFAULT_MARKUP, DEFAULT_RULESET, markupCost, type Ruleset } from '@cannoli/rules';

export const TERA_COST_MAP: Record<number, number> = { ...DEFAULT_MARKUP };

/** Cost a Pokemon contributes to its team's point total. */
export function effectiveCost(
  tier: number,
  isCaptain: boolean,
  rs: Pick<Ruleset, 'teraEnabled' | 'teraMarkup'> = DEFAULT_RULESET,
): number {
  return markupCost(rs, tier, isCaptain);
}
