// Sprite URL helpers for the plugin.
//
// Inside the PS client the origin serves /sprites/ itself (prod nginx
// 302-redirects the whole prefix to play.pokemonshowdown.com), so prefer
// SAME-ORIGIN relative URLs there — no third-party request when the client
// has the assets. Outside the client (or when the relative URL 404s, e.g.
// the local python dev server ships no sprites) fall back to the absolute
// CDN URL from the site's shared helper. Both use the site's `toSpriteId`
// normalizer so forme names resolve identically everywhere.

import { spriteUrl, toSpriteId } from '@/lib/pokemon'

type SpriteDir = 'gen5' | 'gen5-shiny'

function dirFor(shiny?: boolean): SpriteDir {
  return shiny ? 'gen5-shiny' : 'gen5'
}

/** True when running inside the PS client (its origin serves /sprites/). */
function inPSClient(): boolean {
  return typeof window !== 'undefined' && !!window.app
}

/** Preferred sprite URL — same-origin inside the PS client, CDN otherwise. */
export function matchupSpriteUrl(name: string, shiny?: boolean): string {
  if (inPSClient()) return `/sprites/${dirFor(shiny)}/${toSpriteId(name)}.png`
  return spriteUrl(name, dirFor(shiny))
}

/** Absolute CDN fallback for when the same-origin sprite is missing. */
export function matchupSpriteFallbackUrl(name: string, shiny?: boolean): string {
  return spriteUrl(name, dirFor(shiny))
}
