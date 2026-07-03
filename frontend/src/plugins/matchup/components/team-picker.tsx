import { useEffect, useRef, useState } from 'react'
import { rosterFromApi } from '@/lib/roster-from-api'
import type { RosterPokemon } from '@/lib/types'
import type { TeamSource } from '@/pages/matchup-center/use-matchup-state'
import { apiHost, type ApiLeague, type ApiTeam } from '../lib/api-plugin'
import { getCurrentBuild } from '../lib/ps-bridge'
import { builderSourceLabel } from '../lib/use-builder-sync'
import { reloadLeagueTeams, useLeagueTeams } from '../lib/use-league-teams'
import { CustomTeamPanel } from './custom-team'

interface TeamPickerProps {
  side: 'a' | 'b'
  source: TeamSource | null
  onSelect: (roster: RosterPokemon[], source: TeamSource) => void
}

/**
 * Native dropdown team picker (mockup `.picker`, blue You / red Opponent).
 * Mirrors the site team picker's semantics: leagues → `TeamName (W-L)` rows,
 * selection loads the roster through the shared rosterFromApi mapping. The
 * "You" side also lists "Your build (teambuilder)" — selecting it hands side
 * A to the teambuilder bridge (live sync; MatchupRoom's useBuilderSync fills
 * and keeps the roster fresh).
 */
export function TeamPicker({ side, source, onSelect }: TeamPickerProps) {
  const state = useLeagueTeams()
  const [open, setOpen] = useState(false)
  // "Custom team…" swaps the dropdown for the paste/search panel. It only
  // closes explicitly (X / Use team / Escape) — never on outside click, so a
  // stray click can't eat a half-built team.
  const [customOpen, setCustomOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // Snapshot the current teambuilder build when the menu opens (cheap read;
  // only drives the "n mons" tag on the builder entry).
  const build = open && side === 'a' ? getCurrentBuild() : null

  // Close on outside click / Escape. The keydown listener MUST be capture-
  // phase: the PS client's own document-level Escape handler (js/client.js:23)
  // calls stopImmediatePropagation() and its jQuery listener was registered
  // first, so a bubble-phase listener here never fires.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  function pick(league: ApiLeague, team: ApiTeam) {
    onSelect(rosterFromApi(team.roster), {
      type: 'league',
      leagueId: league.id,
      teamId: team.id,
      label: `${team.teamName} (${league.name.replace(' League', '')})`,
    })
    setOpen(false)
  }

  const placeholder = side === 'a' ? 'Select your team…' : 'Select opponent…'
  const role = side === 'a' ? 'You' : 'Opponent'

  return (
    <div className={side === 'a' ? 'matchup-picker matchup-picker-a' : 'matchup-picker matchup-picker-b'} ref={rootRef}>
      <button
        type="button"
        className="matchup-picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setCustomOpen(false)
          setOpen(o => !o)
        }}
      >
        <span className="matchup-picker-role">{role}</span>
        <span className={source ? 'matchup-picker-value' : 'matchup-picker-value matchup-picker-placeholder'}>
          {source?.label ?? placeholder}
        </span>
        <svg className="matchup-picker-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="matchup-picker-menu" role="listbox">
          {side === 'a' && (
            <button
              type="button"
              role="option"
              aria-selected={source?.type === 'builder'}
              className={
                source?.type === 'builder'
                  ? 'matchup-menu-item matchup-menu-item-active'
                  : 'matchup-menu-item'
              }
              onClick={() => {
                // Hand side A to the teambuilder bridge; useBuilderSync
                // resolves the roster (or shows the "open a team" hint).
                onSelect([], { type: 'builder', label: builderSourceLabel(build?.name ?? null) })
                setOpen(false)
              }}
            >
              <span className="matchup-menu-item-name">Your build (teambuilder)</span>
              <span className="matchup-menu-tag">
                {build && build.sets.length > 0
                  ? `${build.sets.length} mon${build.sets.length === 1 ? '' : 's'}`
                  : 'sync'}
              </span>
            </button>
          )}

          <button
            type="button"
            role="option"
            aria-selected={source?.type === 'custom'}
            className={
              source?.type === 'custom'
                ? 'matchup-menu-item matchup-menu-item-active'
                : 'matchup-menu-item'
            }
            onClick={() => {
              setOpen(false)
              setCustomOpen(true)
            }}
          >
            <span className="matchup-menu-item-name">Custom team&hellip;</span>
            <span className="matchup-menu-tag">paste</span>
          </button>
          <div className="matchup-menu-sep" />

          {state.status === 'loading' && (
            <div className="matchup-menu-note">
              <span className="matchup-loading-dot" aria-hidden="true" /> Loading league teams&hellip;
            </div>
          )}

          {state.status === 'error' && (
            <div className="matchup-menu-note matchup-menu-error">
              Couldn't reach {apiHost()}
              <button type="button" className="matchup-menu-retry" onClick={() => void reloadLeagueTeams()}>
                Retry
              </button>
            </div>
          )}

          {state.status === 'ready' && state.leagues.map(({ league, teams }) => (
            teams.length > 0 && (
              <div key={league.id} className="matchup-menu-group">
                <div className="matchup-menu-group-label">{league.name}</div>
                {teams.map(team => {
                  const active = source?.type === 'league' && source.teamId === team.id
                  return (
                    <button
                      key={team.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={active ? 'matchup-menu-item matchup-menu-item-active' : 'matchup-menu-item'}
                      onClick={() => pick(league, team)}
                    >
                      <span className="matchup-menu-item-name">{team.teamName}</span>
                      <span className="matchup-menu-item-record">
                        {team.record.wins}-{team.record.losses}
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          ))}
        </div>
      )}

      {customOpen && (
        <CustomTeamPanel
          side={side}
          onUse={(roster, src) => {
            onSelect(roster, src)
            setCustomOpen(false)
          }}
          onClose={() => setCustomOpen(false)}
        />
      )}
    </div>
  )
}
