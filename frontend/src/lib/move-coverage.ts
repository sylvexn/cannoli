import type { RosterPokemon } from './types';
import type { MoveCategory, MoveCategoryEntry } from '@/data/move-categories';
import { POKEMON_LEARNSETS_BY_FORMAT, DEFAULT_FORMAT, type DraftFormat } from '@/data/pokemon-learnsets';
import { normalizeAbility } from './type-effectiveness';

export interface MoveCoverageResult {
  category: MoveCategory;
  entries: {
    entry: MoveCategoryEntry;
    teamA: string[]; // Pokemon names from team A that have this move/ability
    teamB: string[]; // Pokemon names from team B that have this move/ability
  }[];
}

/** Check if a Pokemon has access to a move category entry (move or ability)
 *  in the given format's learnset. Format defaults to NatDex (the historic
 *  "every move legal" pool) so older callsites keep working until they pass
 *  league.format explicitly. */
function pokemonHasEntry(pokemon: RosterPokemon, entry: MoveCategoryEntry, format: DraftFormat): boolean {
  if (entry.isAbility) {
    return pokemon.abilities.some(a => normalizeAbility(a) === entry.moveId);
  }
  const map = POKEMON_LEARNSETS_BY_FORMAT[format] ?? POKEMON_LEARNSETS_BY_FORMAT[DEFAULT_FORMAT];
  const learnset = map.get(pokemon.name);
  return learnset?.has(entry.moveId) ?? false;
}

/** Compute move coverage for two teams across all categories.
 *  Pass `format` to scope move legality (e.g. league.format from the
 *  matchup-center context). Defaults to NatDex. */
export function getTeamMoveCoverage(
  teamA: RosterPokemon[],
  teamB: RosterPokemon[],
  categories: MoveCategory[],
  format: DraftFormat = DEFAULT_FORMAT,
): MoveCoverageResult[] {
  return categories.map(category => ({
    category,
    entries: category.entries.map(entry => ({
      entry,
      teamA: teamA.filter(p => pokemonHasEntry(p, entry, format)).map(p => p.name),
      teamB: teamB.filter(p => pokemonHasEntry(p, entry, format)).map(p => p.name),
    })),
  }));
}
