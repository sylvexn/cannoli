// Thin API layer for the Showdown-native matchup plugin.
//
// The plugin reuses the SITE's api client (`@/lib/api`) verbatim — same
// fetch wrappers, same types, same `credentials: 'include'` — so the data
// layer never drifts from cannoli.live/matchup. The only difference is the
// base URL: the site resolves `import.meta.env.VITE_API_URL` (usually '' +
// the dev proxy), while the plugin build (vite.plugin.config.ts) `define`s
// that read as a runtime expression:
//
//   (window.CANNOLI_MATCHUP_API_BASE || "<baked VITE_MATCHUP_API_BASE>")
//
// so every api call goes to an absolute Cannoli origin, overridable at
// runtime by setting `window.CANNOLI_MATCHUP_API_BASE` BEFORE the plugin
// module executes (api.ts reads the base once at module scope).

import { api } from '@/lib/api'

export type { ApiLeague, ApiTeam, ApiRosterPokemon, ApiMoveCategory } from '@/lib/api'

/** Absolute Cannoli API origin baked in at build time. */
export const MATCHUP_API_BASE = __MATCHUP_API_BASE__

/**
 * The API origin the plugin is actually talking to: the runtime override
 * (`window.CANNOLI_MATCHUP_API_BASE`) when present, else the baked default.
 * Mirrors the expression the build splices into `@/lib/api`, so links built
 * from this always point at the same origin the data came from.
 */
export function resolveApiBase(): string {
  return (typeof window !== 'undefined' && window.CANNOLI_MATCHUP_API_BASE) || MATCHUP_API_BASE
}

/** Hostname of the active API origin — for footer/branding copy. */
export function apiHost(): string {
  try {
    return new URL(resolveApiBase()).host
  } catch {
    return resolveApiBase()
  }
}

/** The subset of the site's api client the plugin consumes. */
export const pluginApi = {
  getLeagues: api.getLeagues,
  getTeams: api.getTeams,
  getPokemonByName: api.getPokemonByName,
  getPokemonList: api.getPokemonList,
  getMoveCategories: api.getMoveCategories,
}
