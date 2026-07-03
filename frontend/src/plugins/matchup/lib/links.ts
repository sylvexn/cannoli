// Cross-links from the plugin to the Cannoli site (repo convention: every
// entity name is a clickable link). The site origin is the API origin —
// cannoli.live serves both — so links follow whatever base the data came from.

import { pokemonRoute } from '@/lib/pokemon-route'
import { resolveApiBase } from './api-plugin'

/** Absolute URL of a Pokemon detail page on the Cannoli site. */
export function sitePokemonUrl(name: string): string {
  return `${resolveApiBase()}${pokemonRoute(name)}`
}

/** Absolute URL of a team profile page on the Cannoli site. */
export function siteTeamUrl(leagueId: string, teamId: string): string {
  return `${resolveApiBase()}/league/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(teamId)}`
}
