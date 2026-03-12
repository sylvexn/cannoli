import type { RosterPokemon } from './types';
import type { MoveCategory, MoveCategoryEntry } from '@/data/move-categories';
import { POKEMON_LEARNSETS } from '@/data/pokemon-learnsets';
import { normalizeAbility } from './type-effectiveness';

export interface MoveCoverageResult {
  category: MoveCategory;
  entries: {
    entry: MoveCategoryEntry;
    teamA: string[]; // Pokemon names from team A that have this move/ability
    teamB: string[]; // Pokemon names from team B that have this move/ability
  }[];
}

/** Check if a Pokemon has access to a move category entry (move or ability) */
function pokemonHasEntry(pokemon: RosterPokemon, entry: MoveCategoryEntry): boolean {
  if (entry.isAbility) {
    return pokemon.abilities.some(a => normalizeAbility(a) === entry.moveId);
  }
  const learnset = POKEMON_LEARNSETS.get(pokemon.name);
  return learnset?.has(entry.moveId) ?? false;
}

/** Compute move coverage for two teams across all categories */
export function getTeamMoveCoverage(
  teamA: RosterPokemon[],
  teamB: RosterPokemon[],
  categories: MoveCategory[],
): MoveCoverageResult[] {
  return categories.map(category => ({
    category,
    entries: category.entries.map(entry => ({
      entry,
      teamA: teamA.filter(p => pokemonHasEntry(p, entry)).map(p => p.name),
      teamB: teamB.filter(p => pokemonHasEntry(p, entry)).map(p => p.name),
    })),
  }));
}
