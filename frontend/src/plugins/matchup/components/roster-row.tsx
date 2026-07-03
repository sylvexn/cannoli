import type { RosterPokemon } from '@/lib/types'
import { sitePokemonUrl } from '../lib/links'
import { PokeSprite } from './sprite'
import { TeraMark, TypeChips } from './type-chips'

interface RosterRowProps {
  pokemon: RosterPokemon
  side: 'a' | 'b'
  /** Sub-team state: row is part of the analyzed subset. */
  selected?: boolean
  /** Another row on this side is selected and this one is not. */
  dimmed?: boolean
  /** Toggle this mon in/out of the side's sub-team (dedicated dot — the
   *  name link stays a plain link). */
  onToggleSelect?: () => void
}

/**
 * One Overview roster row (mockup `.crow`): sub-team toggle dot on the outer
 * edge · sprite · name (linked, tera marker + tera chips for captains,
 * nickname in italics) · type chips · tier badge · abilities line · base
 * speed. The opponent side mirrors horizontally via `.matchup-crow-b`.
 */
export function RosterRow({ pokemon, side, selected, dimmed, onToggleSelect }: RosterRowProps) {
  const classes = [
    'matchup-crow',
    side === 'b' && 'matchup-crow-b',
    selected && 'matchup-crow-selected',
    dimmed && 'matchup-crow-dim',
  ].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      {onToggleSelect && (
        <button
          type="button"
          className={selected ? 'matchup-crow-sel matchup-crow-sel-on' : 'matchup-crow-sel'}
          onClick={onToggleSelect}
          aria-pressed={selected}
          title={
            selected
              ? `Remove ${pokemon.name} from the analyzed sub-team`
              : `Analyze only selected — add ${pokemon.name}`
          }
        />
      )}
      <PokeSprite name={pokemon.name} shiny={pokemon.isShiny} />
      <div className="matchup-crow-info">
        <div className="matchup-crow-name">
          <a
            href={sitePokemonUrl(pokemon.name)}
            target="_blank"
            rel="noopener"
            className={pokemon.isTeraCaptain ? 'matchup-name matchup-name-tera' : 'matchup-name'}
          >
            {pokemon.name}
          </a>
          {pokemon.isTeraCaptain && <TeraMark teraTypes={pokemon.teraTypes} />}
          <span className="matchup-tier">T{pokemon.tier}</span>
        </div>
        {pokemon.nickname && <div className="matchup-crow-nick">"{pokemon.nickname}"</div>}
        <TypeChips types={pokemon.types} />
        {pokemon.abilities.length > 0 && (
          <div className="matchup-crow-abilities">{pokemon.abilities.join(' · ')}</div>
        )}
      </div>
      <span className="matchup-crow-spe" title={`Base Speed ${pokemon.stats.spe}`}>
        {pokemon.stats.spe}
      </span>
    </div>
  )
}
