/**
 * Build the route path for a Pokemon detail page.
 * Route is `/pokemon/:name`; the page decodes the param via decodeURIComponent,
 * so callers must URL-encode here. Names are stored as displayed (e.g.
 * "Mr. Mime", "Tapu Lele", "Ho-Oh") — no slugging.
 */
export function pokemonRoute(name: string): string {
  return `/pokemon/${encodeURIComponent(name)}`;
}
