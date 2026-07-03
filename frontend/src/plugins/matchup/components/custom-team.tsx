import { useEffect, useRef, useState } from 'react'
import { parseShowdownPaste } from '@/lib/showdown-paste'
import { rosterMonFromPokemonRow } from '@/lib/roster-from-api'
import type { RosterPokemon } from '@/lib/types'
import type { TeamSource } from '@/pages/matchup-center/use-matchup-state'
import { pluginApi } from '../lib/api-plugin'
import { PokeSprite } from './sprite'

// Plugin port of the site's custom-team-builder.tsx: paste a Showdown /
// PokePaste export, or search-add mons one at a time, into a 12-slot grid,
// then hand the roster to the matchup state as a `custom` source. Rendered as
// an anchored panel in place of the picker dropdown. Differences from the
// site: no tier-format toggle (league-format tier badges aren't part of the
// plugin's custom flow — search results show the API tier), and inline
// warning notes instead of toasts.

const SLOT_COUNT = 12

interface CustomTeamPanelProps {
  side: 'a' | 'b'
  onUse: (roster: RosterPokemon[], source: TeamSource) => void
  onClose: () => void
}

/** Look up a Pokemon by name from the API and convert to RosterPokemon. */
async function lookupPokemon(name: string): Promise<RosterPokemon | null> {
  try {
    const data = await pluginApi.getPokemonByName(name)
    if (!data) return null
    return rosterMonFromPokemonRow(data)
  } catch {
    return null
  }
}

export function CustomTeamPanel({ side, onUse, onClose }: CustomTeamPanelProps) {
  const [slots, setSlots] = useState<(RosterPokemon | null)[]>(Array(SLOT_COUNT).fill(null))
  const [pasteText, setPasteText] = useState('')
  const [importing, setImporting] = useState(false)
  const [notFound, setNotFound] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ name: string; tier: number }[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [targetSlot, setTargetSlot] = useState<number | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const filledCount = slots.filter(Boolean).length

  // Close on Escape. Capture-phase for the same reason as the picker menu:
  // the PS client's own document-level Escape handler stops propagation.
  // Deliberately NO outside-click close — a stray click must not eat a paste.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Debounced search (250ms), same as the site.
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const results = await pluginApi.getPokemonList({ search: searchQuery, limit: 20 })
        setSearchResults(results.map(p => ({ name: p.name, tier: p.tier })))
      } catch {
        setSearchResults([])
      }
      setSearchLoading(false)
    }, 250)
    return () => clearTimeout(searchTimeout.current)
  }, [searchQuery])

  async function handlePasteImport() {
    if (!pasteText.trim() || importing) return
    setImporting(true)
    setNotFound([])
    const names = parseShowdownPaste(pasteText)
    if (names.length === 0) {
      setNotFound(['(no Pokemon found in paste)'])
      setImporting(false)
      return
    }

    const capped = names.slice(0, SLOT_COUNT)
    const results = await Promise.all(capped.map(lookupPokemon))
    setSlots(prev => {
      const next = [...prev]
      for (const mon of results) {
        if (!mon) continue
        const emptyIdx = next.findIndex(s => s === null)
        if (emptyIdx === -1) break
        next[emptyIdx] = mon
      }
      return next
    })
    setNotFound(capped.filter((_, i) => results[i] === null))
    setPasteText('')
    setImporting(false)
  }

  async function handleAddFromSearch(name: string) {
    const idx = targetSlot ?? slots.findIndex(s => s === null)
    if (idx === -1 || idx >= SLOT_COUNT) {
      setNotFound(['(all 12 slots full)'])
      return
    }
    const mon = await lookupPokemon(name)
    if (!mon) {
      setNotFound([name])
      return
    }
    setSlots(prev => {
      const next = [...prev]
      next[idx] = mon
      return next
    })
    setTargetSlot(null)
    setSearchQuery('')
    setSearchResults([])
  }

  function handleRemoveSlot(idx: number) {
    setSlots(prev => {
      const next = [...prev]
      next[idx] = null
      return next
    })
  }

  function handleUse() {
    const roster = slots.filter(Boolean) as RosterPokemon[]
    if (roster.length === 0) return
    onUse(roster, { type: 'custom', label: `Custom (${roster.length})` })
  }

  return (
    <div className={`matchup-ct matchup-ct-${side}`} role="dialog" aria-label="Custom team">
      <div className="matchup-ct-head">
        <span className="matchup-ct-title">
          Custom team <span className="matchup-ct-count">{filledCount}/{SLOT_COUNT}</span>
        </span>
        <button
          type="button"
          className="matchup-ct-use"
          onClick={handleUse}
          disabled={filledCount === 0}
        >
          Use team
        </button>
        <button type="button" className="matchup-ct-x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <textarea
        className="matchup-ct-paste"
        value={pasteText}
        onChange={e => setPasteText(e.target.value)}
        placeholder="Paste Showdown / PokePaste team export here…"
        spellCheck={false}
      />
      <button
        type="button"
        className="matchup-btn matchup-ct-import"
        onClick={() => void handlePasteImport()}
        disabled={!pasteText.trim() || importing}
      >
        {importing ? 'Importing…' : 'Import paste'}
      </button>

      {notFound.length > 0 && (
        <div className="matchup-ct-warn" role="status">
          Not found: {notFound.join(', ')}
        </div>
      )}

      <div className="matchup-ct-grid">
        {slots.map((mon, i) => (
          <div
            key={i}
            className={
              mon
                ? 'matchup-ct-slot matchup-ct-slot-filled'
                : targetSlot === i
                  ? 'matchup-ct-slot matchup-ct-slot-target'
                  : 'matchup-ct-slot'
            }
            onClick={() => {
              if (!mon) setTargetSlot(targetSlot === i ? null : i)
            }}
            title={mon ? mon.name : 'Empty slot — search below to fill'}
          >
            {mon ? (
              <>
                <PokeSprite name={mon.name} shiny={mon.isShiny} />
                <button
                  type="button"
                  className="matchup-ct-remove"
                  onClick={e => {
                    e.stopPropagation()
                    handleRemoveSlot(i)
                  }}
                  aria-label={`Remove ${mon.name}`}
                >
                  ×
                </button>
                <span className="matchup-ct-slotname">{mon.name}</span>
              </>
            ) : (
              <span className="matchup-ct-plus" aria-hidden="true">+</span>
            )}
          </div>
        ))}
      </div>

      <input
        className="matchup-ct-search"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        placeholder="Search Pokemon to add…"
      />
      {searchLoading && <div className="matchup-ct-searchnote">Searching…</div>}
      {searchResults.length > 0 && (
        <div className="matchup-ct-results">
          {searchResults.map(p => (
            <button
              key={p.name}
              type="button"
              className="matchup-menu-item"
              onClick={() => void handleAddFromSearch(p.name)}
            >
              <span className="matchup-ct-result">
                <PokeSprite name={p.name} />
                <span className="matchup-menu-item-name">{p.name}</span>
              </span>
              {p.tier > 0 && <span className="matchup-menu-item-record">T{p.tier}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
