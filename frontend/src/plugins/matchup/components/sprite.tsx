import { useState } from 'react'
import { matchupSpriteFallbackUrl, matchupSpriteUrl } from '../lib/sprites'

/**
 * Pokemon sprite with a graceful degradation chain:
 * same-origin /sprites/ (inside the PS client) → absolute CDN URL → hidden
 * placeholder square. Keyed remount via `key` isn't required — stage resets
 * when the name changes.
 */
export function PokeSprite({ name, shiny }: { name: string; shiny?: boolean }) {
  // stage 0 = preferred URL, 1 = CDN fallback, 2 = hide (placeholder)
  const [state, setState] = useState<{ name: string; stage: number }>({ name, stage: 0 })
  const stage = state.name === name ? state.stage : 0

  if (stage >= 2) return <span className="matchup-sprite matchup-sprite-empty" aria-hidden="true" />

  const preferred = matchupSpriteUrl(name, shiny)
  const fallback = matchupSpriteFallbackUrl(name, shiny)
  const src = stage === 0 ? preferred : fallback

  return (
    <img
      className="matchup-sprite"
      src={src}
      alt={name}
      loading="lazy"
      onError={() => {
        // Skip the CDN retry when preferred === fallback (already absolute).
        const next = stage === 0 && preferred !== fallback ? 1 : 2
        setState({ name, stage: next })
      }}
    />
  )
}
