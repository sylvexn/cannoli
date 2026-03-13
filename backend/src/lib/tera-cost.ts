/**
 * Tera captain cost markup. Mirrors `frontend/src/data/tier-list.ts`.
 * Tiers 9 and below cost more when designated as captains.
 */

export const TERA_COST_MAP: Record<number, number> = {
  9: 12, 8: 10, 7: 9, 6: 8, 5: 6, 4: 5, 3: 4, 2: 2, 1: 1,
};

/** Cost a Pokemon contributes to its team's point total. */
export function effectiveCost(tier: number, isCaptain: boolean): number {
  if (!isCaptain) return tier;
  return TERA_COST_MAP[tier] ?? tier;
}
