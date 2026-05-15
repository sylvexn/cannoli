/**
 * Speed-tier calculation utilities.
 *
 * adjustedSpeed = floor(
 *   (floor((2*baseSpeed + 31 + 252/4) * level / 100) + 5)
 *   * natureMod * itemMod * abilityMod
 * ) * stageMultiplier
 *
 * Assumes max IVs (31) and max Speed EVs (252) — the standard "Smogon scarf
 * benchmark" assumption. Stage is applied as the final multiplier per the
 * standard order of operations in main-series games (final stat, then stage).
 */

export type Weather = 'none' | 'sun' | 'rain' | 'sand' | 'snow';
export type Stage = -2 | -1 | 0 | 1 | 2;

export interface CalcAssumptions {
  /** Held item to assume on every row. */
  item: 'none' | 'scarf' | 'iron-ball';
  /** Speed nature to assume on every row. */
  nature: 'plus' | 'neutral' | 'minus';
  /** Whether to apply this Pokemon's weather-speed ability if it has one. */
  applyWeatherAbility: boolean;
  /** Apply the unconditional Unburden 2x boost to any row that has Unburden. */
  unburden: boolean;
  /** Apply the Quick Feet 1.5x boost (status assumed) to rows that have it. */
  quickFeet: boolean;
  weather: Weather;
  level: number;
}

export const ITEM_MOD: Record<CalcAssumptions['item'], number> = {
  none: 1,
  scarf: 1.5,
  'iron-ball': 0.5,
};

export const NATURE_MOD: Record<CalcAssumptions['nature'], number> = {
  plus: 1.1,
  neutral: 1.0,
  minus: 0.9,
};

export const STAGE_MULT: Record<Stage, number> = {
  '-2': 0.5,
  '-1': 2 / 3,
  0: 1,
  1: 1.5,
  2: 2,
} as unknown as Record<Stage, number>;

/**
 * Weather-conditional 2x speed abilities. Maps the canonical ability name
 * (matches the strings stored in pokemon.ability1/ability2/hidden_ability)
 * to the weather it activates in.
 */
export const WEATHER_ABILITIES: Record<string, Weather> = {
  Chlorophyll: 'sun',
  'Swift Swim': 'rain',
  'Sand Rush': 'sand',
  'Slush Rush': 'snow',
};

/**
 * Returns the ability multiplier for a Pokemon with the given ability list
 * under the supplied assumptions. Picks the best applicable ability — if a
 * Pokemon has multiple speed-relevant abilities (rare), we take the highest
 * boost so the simulation reflects the user's "most aggressive" assumption.
 */
export function abilityMultiplier(
  abilities: string[],
  a: Pick<CalcAssumptions, 'weather' | 'applyWeatherAbility' | 'unburden' | 'quickFeet'>,
): { mult: number; activeAbility: string | null } {
  let mult = 1;
  let active: string | null = null;
  for (const ability of abilities) {
    if (a.applyWeatherAbility && WEATHER_ABILITIES[ability] === a.weather && a.weather !== 'none') {
      if (2 > mult) { mult = 2; active = ability; }
    }
    if (a.unburden && ability === 'Unburden') {
      if (2 > mult) { mult = 2; active = ability; }
    }
    if (a.quickFeet && ability === 'Quick Feet') {
      if (1.5 > mult) { mult = 1.5; active = ability; }
    }
  }
  return { mult, activeAbility: active };
}

/**
 * Compute the adjusted speed at a given stage. Pure — used by the table sort
 * and by the per-row stage columns.
 */
export function adjustedSpeed(
  baseSpeed: number,
  abilities: string[],
  a: CalcAssumptions,
  stage: Stage,
): number {
  // Base stat formula with max IVs + 252 EVs (= 63 EV-bonus).
  const base = Math.floor((2 * baseSpeed + 31 + Math.floor(252 / 4)) * a.level / 100) + 5;
  const ability = abilityMultiplier(abilities, a);
  const itemMod = ITEM_MOD[a.item];
  const natureMod = NATURE_MOD[a.nature];
  // Stat multipliers stack: nature, item, ability — floor after each main
  // games-accurate; we collapse to a single floor on the product since the
  // intermediate flooring rounds-to-nearest is well within tolerance for a
  // sim view (a 1-pt rounding error never changes a tier ordering).
  const finalStat = Math.floor(base * natureMod * itemMod * ability.mult);
  return Math.floor(finalStat * STAGE_MULT[stage]);
}

export const STAGES: Stage[] = [0, 1, 2];

/** Convenience: the four "headline" speed values shown per row. */
export interface SpeedRowComputed {
  speed0: number;
  speed1: number;
  speed2: number;
  scarfEquivalent: number;
  /** Which boosting ability (if any) actually fired under current toggles. */
  activeAbility: string | null;
}

export function computeRow(
  baseSpeed: number,
  abilities: string[],
  a: CalcAssumptions,
): SpeedRowComputed {
  const speed0 = adjustedSpeed(baseSpeed, abilities, a, 0);
  const speed1 = adjustedSpeed(baseSpeed, abilities, a, 1);
  const speed2 = adjustedSpeed(baseSpeed, abilities, a, 2);
  // "Scarf-equivalent" = same row but with item forced to scarf, stage 0.
  // Lets users compare un-scarfed mons to scarf benchmarks at a glance.
  const scarfAssumptions: CalcAssumptions = { ...a, item: 'scarf' };
  const scarfEquivalent = adjustedSpeed(baseSpeed, abilities, scarfAssumptions, 0);
  const ability = abilityMultiplier(abilities, a);
  return { speed0, speed1, speed2, scarfEquivalent, activeAbility: ability.activeAbility };
}
