import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { useMatchupState, type MatchupTab } from '@/pages/matchup-center/use-matchup-state'
import { TeamPicker } from './components/team-picker'
import { apiHost } from './lib/api-plugin'
import { CbContext, loadCbPref, saveCbPref } from './lib/colorblind'
import { useBuilderSync, type BuilderSyncMode } from './lib/use-builder-sync'
import { MovesTab } from './tabs/moves'
import { OverviewTab } from './tabs/overview'
import { SpeedTab } from './tabs/speed'
import { StatsTab } from './tabs/stats'
import { TypeChartTab } from './tabs/typechart'

// Tab strip order matches the mockup.
const TABS: { id: MatchupTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'typechart', label: 'Type Chart' },
  { id: 'speed', label: 'Speed' },
  { id: 'stats', label: 'Stats' },
  { id: 'moves', label: 'Moves' },
]

/** Root of the Matchup room UI: header (wordmark + You/Opponent pickers),
 *  tab strip, tab body, footer brand line — wrapped in an error boundary so
 *  a render bug degrades to a message instead of blanking the PS room. */
export function MatchupRoom() {
  return (
    <RoomErrorBoundary>
      <MatchupRoomInner />
    </RoomErrorBoundary>
  )
}

function MatchupRoomInner() {
  const { state, dispatch, activeTeamA, activeTeamB } = useMatchupState()

  // Colorblind mode: persisted plugin-locally. The `matchup-cb` root class
  // flips the side-B accent CSS variable (red -> orange) for everything
  // var-driven; CbContext lets inline-style colors (type chips, move names,
  // stat thresholds) pick the deuteranopia-safe palettes.
  const [cb, setCb] = useState(loadCbPref)
  function toggleCb() {
    setCb(prev => {
      const next = !prev
      saveCbPref(next)
      return next
    })
  }

  // Teambuilder bridge: 'active' while side A is sourced from the builder,
  // 'auto' while nothing is selected yet (adopts the current build on room
  // open — the plugin's replacement for the site's userId auto-populate),
  // 'off' once a league/custom team is picked.
  const builderMode = state.teamASource?.type === 'builder'
  const syncMode: BuilderSyncMode = builderMode ? 'active' : state.teamASource ? 'off' : 'auto'
  const builderSync = useBuilderSync(syncMode, (roster, source) =>
    dispatch({ type: 'SET_TEAM_A', roster, source }),
  )

  // Same as the site's index.tsx effect: seed the speed-calc slots once,
  // the first time both teams are non-empty.
  const speedInitRef = useRef(false)
  useEffect(() => {
    if (!speedInitRef.current && state.teamA.length > 0 && state.teamB.length > 0) {
      speedInitRef.current = true
      dispatch({ type: 'INIT_SPEED_SLOTS', teamA: state.teamA, teamB: state.teamB })
    }
  }, [state.teamA, state.teamB, dispatch])

  return (
    <CbContext.Provider value={cb}>
    <div className={cb ? 'matchup-panel matchup-cb' : 'matchup-panel'}>
      <header className="matchup-head">
        <span className="matchup-wordmark">
          <span className="matchup-wordmark-accent">CANNOLI</span> MATCHUP CENTER
          <span className="matchup-wordmark-ver">v0.1</span>
        </span>
        <div className="matchup-pickers">
          <TeamPicker
            side="a"
            source={state.teamASource}
            onSelect={(roster, source) => dispatch({ type: 'SET_TEAM_A', roster, source })}
          />
          {builderMode &&
            (builderSync.hasBuild ? (
              <span className="matchup-sync" title="Live-synced from your teambuilder">
                <span className="matchup-sync-dot" aria-hidden="true" />
                synced
              </span>
            ) : (
              <span className="matchup-sync-hint">
                Open a team in the teambuilder to sync your build
              </span>
            ))}
          <span className="matchup-vs">VS</span>
          <TeamPicker
            side="b"
            source={state.teamBSource}
            onSelect={(roster, source) => dispatch({ type: 'SET_TEAM_B', roster, source })}
          />
        </div>
      </header>

      {builderMode && builderSync.missing.length > 0 && (
        <div className="matchup-note" role="status">
          {builderSync.missing.length} not found: {builderSync.missing.join(', ')}
        </div>
      )}

      <nav className="matchup-rtabs">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={state.activeTab === t.id ? 'matchup-rtab matchup-rtab-active' : 'matchup-rtab'}
            onClick={() => dispatch({ type: 'SET_TAB', tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="matchup-body">
        {state.activeTab === 'overview' ? (
          <OverviewTab
            teamA={state.teamA}
            teamB={state.teamB}
            activeTeamA={activeTeamA}
            activeTeamB={activeTeamB}
            subTeamA={state.subTeamA}
            subTeamB={state.subTeamB}
            onToggleSub={(side, name) =>
              dispatch({ type: side === 'a' ? 'TOGGLE_SUB_A' : 'TOGGLE_SUB_B', name })
            }
            onResetSubs={() => dispatch({ type: 'RESET_SUB_TEAMS' })}
            sourceA={state.teamASource}
            sourceB={state.teamBSource}
          />
        ) : state.activeTab === 'typechart' ? (
          <TypeChartTab teamA={activeTeamA} teamB={activeTeamB} />
        ) : state.activeTab === 'speed' ? (
          <SpeedTab
            teamA={activeTeamA}
            teamB={activeTeamB}
            slots={state.speedCalcSlots}
            onAddSlot={() => dispatch({ type: 'ADD_SPEED_SLOT' })}
            onRemoveSlot={id => dispatch({ type: 'REMOVE_SPEED_SLOT', id })}
            onUpdateSlot={(id, updates) => dispatch({ type: 'UPDATE_SPEED_SLOT', id, updates })}
          />
        ) : state.activeTab === 'stats' ? (
          <StatsTab teamA={activeTeamA} teamB={activeTeamB} />
        ) : (
          <MovesTab teamA={activeTeamA} teamB={activeTeamB} />
        )}
      </div>

      <footer className="matchup-brand">
        <span className="matchup-brand-mark">CANNOLI</span> · matchup center · data from {apiHost()}
        <button
          type="button"
          className={cb ? 'matchup-cb-pill matchup-cb-pill-on' : 'matchup-cb-pill'}
          onClick={toggleCb}
          aria-pressed={cb}
          title="Colorblind-friendly palette (deuteranopia-safe: opponent red becomes orange)"
        >
          CB
        </button>
      </footer>
    </div>
    </CbContext.Provider>
  )
}

class RoomErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[cannoli-matchup] room crashed:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="matchup-panel">
          <div className="matchup-soon">
            <div className="matchup-soon-title">Something broke</div>
            <p className="matchup-soon-sub">
              The Matchup panel hit an error. Close and reopen the tab to reset it.
            </p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
