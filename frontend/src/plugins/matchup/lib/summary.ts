// Deterministic Overview summary-bar computation (mockup `.cmp-foot`).
// Pure functions over the two active rosters — no fetches, no randomness.

import { getDefensiveMatchups } from '@/lib/type-effectiveness'
import { POKEMON_TYPES, type PokemonType } from '@/lib/pokemon'
import type { RosterPokemon } from '@/lib/types'

export interface SpeedSummary {
  /** Your fastest mon (highest base spe; earlier roster slot wins ties). */
  fastest: RosterPokemon
  /** Opponent mons your fastest does NOT outspeed (spe >= yours — speed
   *  ties are 50/50, so a tie counts as "not outsped"), fastest first. */
  notOutsped: RosterPokemon[]
}

export interface SharedWeakness {
  type: PokemonType
  count: number
}

export interface ThreatSummary {
  /** Up to two top threats, highest pressure first. */
  names: string[]
  /** Mons-hit count of the top threat. */
  count: number
  /** Your active team size. */
  total: number
}

export interface MatchupSummary {
  speed: SpeedSummary
  /** Top 3 attacking types ≥2 of YOUR mons are weak to (count desc). */
  sharedWeaknesses: SharedWeakness[]
  /** null — no opponent mon pressures ≥ half your team with STAB. */
  threats: ThreatSummary | null
}

/** Defensive multipliers per mon, keyed by attacking type. Same ability
 *  convention as the site's typechart tab: first listed ability. */
function defenseMaps(team: RosterPokemon[]): Map<PokemonType, number>[] {
  return team.map(p =>
    new Map(getDefensiveMatchups(p.types, p.abilities?.[0]).map(m => [m.type, m.multiplier])),
  )
}

/** Compute the Overview summary. Returns null unless BOTH sides have mons. */
export function computeSummary(teamA: RosterPokemon[], teamB: RosterPokemon[]): MatchupSummary | null {
  if (teamA.length === 0 || teamB.length === 0) return null

  // — Speed —
  const fastest = teamA.reduce((best, p) => (p.stats.spe > best.stats.spe ? p : best))
  const notOutsped = teamB
    .filter(o => o.stats.spe >= fastest.stats.spe)
    .sort((a, b) => b.stats.spe - a.stats.spe)

  // — Shared weaknesses (defense side: your team, abilities considered) —
  const aDefense = defenseMaps(teamA)
  const weakCounts = POKEMON_TYPES.map(type => ({
    type,
    count: aDefense.filter(dm => (dm.get(type) ?? 1) > 1).length,
  }))
  const sharedWeaknesses = weakCounts
    .filter(w => w.count >= 2)
    .sort((a, b) => b.count - a.count || POKEMON_TYPES.indexOf(a.type) - POKEMON_TYPES.indexOf(b.type))
    .slice(0, 3)

  // — Threats (attack side: opponent STAB vs your defense; attacker ability
  //   NOT considered, defender ability is — same convention as above) —
  const need = Math.ceil(teamA.length / 2)
  const threats = teamB
    .map(o => ({
      name: o.name,
      count: aDefense.filter(dm => o.types.some(t => (dm.get(t) ?? 1) > 1)).length,
    }))
    .filter(t => t.count >= need)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 2)

  return {
    speed: { fastest, notOutsped },
    sharedWeaknesses,
    threats: threats.length > 0
      ? { names: threats.map(t => t.name), count: threats[0].count, total: teamA.length }
      : null,
  }
}
