import { getTypeColors, TYPE_LABELS } from '@/lib/constants'
import type { PokemonType } from '@/lib/pokemon'
import { useCb } from '../lib/colorblind'

/** Colored 3-letter type pills (site TYPE_COLORS + TYPE_LABELS; the
 *  deuteranopia-safe palette when colorblind mode is on). */
export function TypeChips({ types }: { types: PokemonType[] }) {
  const colors = getTypeColors(useCb())
  return (
    <span className="matchup-chips">
      {types.map(t => (
        <span
          key={t}
          className="matchup-chip"
          style={{ backgroundColor: colors[t] ?? '#555' }}
          title={t}
        >
          {TYPE_LABELS[t] ?? t}
        </span>
      ))}
    </span>
  )
}

/** Tera-captain marker: small pink "T" + the captain's tera types as mini chips. */
export function TeraMark({ teraTypes }: { teraTypes?: PokemonType[] }) {
  const colors = getTypeColors(useCb())
  return (
    <span className="matchup-tera" title="Tera Captain">
      <span className="matchup-tera-mark">T</span>
      {teraTypes?.map(t => (
        <span
          key={t}
          className="matchup-tera-chip"
          style={{ backgroundColor: colors[t] ?? '#555' }}
          title={`Tera ${t}`}
        >
          {TYPE_LABELS[t] ?? t}
        </span>
      ))}
    </span>
  )
}
