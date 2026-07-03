import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_MOVE_CATEGORIES, type MoveCategory } from '@/data/move-categories'
import { getMoveColor } from '@/data/move-type-map'
import { getTypeColors } from '@/lib/constants'
import type { RosterPokemon } from '@/lib/types'
import type { MoveCoverageResult } from '@/lib/move-coverage'
import { PokeSprite } from '../components/sprite'
import { pluginApi } from '../lib/api-plugin'
import { useCb } from '../lib/colorblind'
import { sitePokemonUrl } from '../lib/links'

// Parity port of the site's moves-tab.tsx. The coverage math is the shared
// getTeamMoveCoverage — but that module statically drags in the ~1.5MB
// pokemon-learnsets data, so it is loaded via dynamic import() the first time
// this tab renders (Vite splits it into a separate chunk; the room boots
// without paying for it). Categories come from the API with a silent fallback
// to the bundled defaults, exactly like the site.

type CoverageFn = (
  teamA: RosterPokemon[],
  teamB: RosterPokemon[],
  categories: MoveCategory[],
) => MoveCoverageResult[]

// Module-level cache: once the chunk is in, re-opening the tab never flashes
// the loading state again.
let coverageFnCache: CoverageFn | null = null

interface MovesTabProps {
  teamA: RosterPokemon[]
  teamB: RosterPokemon[]
}

export function MovesTab({ teamA, teamB }: MovesTabProps) {
  const cb = useCb()
  const typeColors = getTypeColors(cb)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<MoveCategory[]>(DEFAULT_MOVE_CATEGORIES)
  const [coverageFn, setCoverageFn] = useState<CoverageFn | null>(() => coverageFnCache)
  const [loadFailed, setLoadFailed] = useState(false)

  // Lazy-load the learnsets-heavy coverage module on first activation.
  useEffect(() => {
    if (coverageFn) return
    let cancelled = false
    import('@/lib/move-coverage')
      .then(mod => {
        coverageFnCache = mod.getTeamMoveCoverage
        if (!cancelled) setCoverageFn(() => coverageFnCache)
      })
      .catch(err => {
        console.error('[cannoli-matchup] failed to load move data:', err)
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [coverageFn])

  // Same as the site: API categories win when present, defaults otherwise.
  useEffect(() => {
    let cancelled = false
    pluginApi
      .getMoveCategories()
      .then(cats => {
        if (!cancelled && cats.length > 0) setCategories(cats)
      })
      .catch(() => {
        // Fall back to defaults silently
      })
    return () => {
      cancelled = true
    }
  }, [])

  const coverage = useMemo(
    () => (coverageFn ? coverageFn(teamA, teamB, categories) : null),
    [coverageFn, teamA, teamB, categories],
  )

  function toggleCategory(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (teamA.length === 0 && teamB.length === 0) {
    return (
      <div className="matchup-mv">
        <div className="matchup-empty">
          <div className="matchup-empty-title">No teams selected</div>
          <div className="matchup-empty-hint">Select teams to see move coverage.</div>
        </div>
      </div>
    )
  }

  if (loadFailed) {
    return (
      <div className="matchup-mv">
        <div className="matchup-empty">
          <div className="matchup-empty-title">Move data unavailable</div>
          <div className="matchup-empty-hint">
            Couldn't load the learnset data. Check your connection and reopen this tab.
          </div>
        </div>
      </div>
    )
  }

  if (!coverage) {
    return (
      <div className="matchup-mv">
        <div className="matchup-mv-loading" role="status">
          <span className="matchup-loading-dot" aria-hidden="true" /> Loading move data&hellip;
        </div>
      </div>
    )
  }

  return (
    <div className="matchup-mv">
      <div className="matchup-mv-scroll">
        {/* sticky sprite header: label corner | team A | divider | team B */}
        <div className="matchup-mv-head">
          <div className="matchup-mv-label matchup-mv-corner">Move / Ability</div>
          <SpriteZone team={teamA} side="a" />
          <div className="matchup-mv-div" />
          <SpriteZone team={teamB} side="b" />
        </div>

        {coverage.map(({ category, entries }) => {
          const isCollapsed = collapsed.has(category.id)
          const aCount = entries.filter(e => e.teamA.length > 0).length
          const bCount = entries.filter(e => e.teamB.length > 0).length
          return (
            <div key={category.id}>
              <button
                type="button"
                className="matchup-mv-cat"
                onClick={() => toggleCategory(category.id)}
                aria-expanded={!isCollapsed}
              >
                <span className="matchup-mv-cat-in">
                  <svg
                    className={isCollapsed ? 'matchup-mv-chev matchup-mv-chev-closed' : 'matchup-mv-chev'}
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                  <span className="matchup-mv-cat-name">{category.name}</span>
                  <span className="matchup-mv-count matchup-mv-count-a">
                    {aCount}/{entries.length}
                  </span>
                  <span className="matchup-mv-count-sep">·</span>
                  <span className="matchup-mv-count matchup-mv-count-b">
                    {bCount}/{entries.length}
                  </span>
                </span>
              </button>

              {!isCollapsed &&
                entries.map(({ entry, teamA: matchesA, teamB: matchesB }) => {
                  const typeColor = entry.isAbility ? undefined : getMoveColor(entry.name, typeColors)
                  return (
                    <div key={entry.moveId} className="matchup-mv-row">
                      <div className="matchup-mv-label">
                        {entry.isAbility ? (
                          <span className="matchup-mv-abil" title={`Ability: ${entry.name}`}>
                            {entry.name}
                          </span>
                        ) : (
                          <span
                            className="matchup-mv-move"
                            title={`Move: ${entry.name}`}
                            style={typeColor ? { color: typeColor } : undefined}
                          >
                            {entry.name}
                          </span>
                        )}
                      </div>
                      <DotZone team={teamA} side="a" matches={matchesA} entryName={entry.name} />
                      <div className="matchup-mv-div" />
                      <DotZone team={teamB} side="b" matches={matchesB} entryName={entry.name} />
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SpriteZone({ team, side }: { team: RosterPokemon[]; side: 'a' | 'b' }) {
  return (
    <div className={`matchup-mv-side matchup-mv-side-${side}`}>
      {team.map(p => (
        <div key={p.name} className="matchup-mv-cell matchup-mv-spritecell">
          <a
            href={sitePokemonUrl(p.name)}
            target="_blank"
            rel="noopener"
            title={p.nickname ? `${p.name} — "${p.nickname}"` : p.name}
            className="matchup-mv-spritelink"
          >
            <PokeSprite name={p.name} shiny={p.isShiny} />
          </a>
        </div>
      ))}
    </div>
  )
}

function DotZone({
  team,
  side,
  matches,
  entryName,
}: {
  team: RosterPokemon[]
  side: 'a' | 'b'
  matches: string[]
  entryName: string
}) {
  return (
    <div className={`matchup-mv-side matchup-mv-side-${side}`}>
      {team.map(p => {
        const has = matches.includes(p.name)
        return (
          <div key={p.name} className={has ? 'matchup-mv-cell matchup-mv-cell-has' : 'matchup-mv-cell'}>
            {has ? (
              <span className={`matchup-mv-dot matchup-mv-dot-${side}`} title={`${p.name} has ${entryName}`} />
            ) : (
              <span className="matchup-mv-dot" />
            )}
          </div>
        )
      })}
    </div>
  )
}
