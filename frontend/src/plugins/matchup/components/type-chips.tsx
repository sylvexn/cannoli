import { TYPE_COLORS, TYPE_LABELS } from '@/lib/constants'
import type { PokemonType } from '@/lib/pokemon'

/** Colored 3-letter type pills (site TYPE_COLORS + TYPE_LABELS). */
export function TypeChips({ types }: { types: PokemonType[] }) {
  return (
    <span className="matchup-chips">
      {types.map(t => (
        <span
          key={t}
          className="matchup-chip"
          style={{ backgroundColor: TYPE_COLORS[t] ?? '#555' }}
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
  return (
    <span className="matchup-tera" title="Tera Captain">
      <span className="matchup-tera-mark">T</span>
      {teraTypes?.map(t => (
        <span
          key={t}
          className="matchup-tera-chip"
          style={{ backgroundColor: TYPE_COLORS[t] ?? '#555' }}
          title={`Tera ${t}`}
        >
          {TYPE_LABELS[t] ?? t}
        </span>
      ))}
    </span>
  )
}
