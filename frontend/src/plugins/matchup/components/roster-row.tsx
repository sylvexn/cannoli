import type { RosterPokemon } from '@/lib/types'
import { sitePokemonUrl } from '../lib/links'
import { PokeSprite } from './sprite'
import { TeraMark, TypeChips } from './type-chips'

/**
 * One Overview roster row (mockup `.crow`): sprite · name (linked, tera
 * marker + tera chips for captains, nickname in italics) · type chips ·
 * tier badge · abilities line · base speed. The opponent side mirrors
 * horizontally via `.matchup-crow-b`.
 */
export function RosterRow({ pokemon, side }: { pokemon: RosterPokemon; side: 'a' | 'b' }) {
  return (
    <div className={side === 'a' ? 'matchup-crow' : 'matchup-crow matchup-crow-b'}>
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
