/** Nature effect on the Speed stat: boosting (+10%), neutral, or hindering (-10%). */
export type SpeedNature = 'positive' | 'neutral' | 'negative';

/**
 * Compute a Pokemon's effective Speed stat.
 *
 * Pipeline (floor at every step, matching in-game integer math):
 * 1. Raw stat: floor((2*base + IVs + floor(EVs/4)) * level / 100 + 5)
 * 2. Nature: floor(raw * 1.1) for positive, floor(raw * 0.9) for negative
 * 3. Stat stages: `boosts` in -6..+6, with Sticky Web applied as an extra -1 stage;
 *    positive stages multiply by (2+n)/2, negative by 2/(2-n), floored
 * 4. Choice Scarf: floor(result * 1.5)
 */
export function calcSpeed(
  baseSpe: number, level: number, evs: number, ivs: number,
  nature: SpeedNature, boosts: number,
  scarf: boolean, stickyWeb: boolean,
): number {
  const raw = Math.floor((2 * baseSpe + ivs + Math.floor(evs / 4)) * level / 100 + 5);
  const natureMult = nature === 'positive' ? 1.1 : nature === 'negative' ? 0.9 : 1.0;
  const natured = Math.floor(raw * natureMult);

  // Apply sticky web as -1 speed stage
  const effectiveBoosts = stickyWeb ? boosts - 1 : boosts;

  let result: number;
  if (effectiveBoosts === 0) result = natured;
  else if (effectiveBoosts > 0) result = Math.floor(natured * (2 + effectiveBoosts) / 2);
  else result = Math.floor(natured * 2 / (2 - effectiveBoosts));

  // Choice Scarf: 1.5x
  if (scarf) result = Math.floor(result * 1.5);

  return result;
}
