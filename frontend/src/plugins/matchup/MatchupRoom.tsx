import { Component, type ReactNode } from 'react'
import { useMatchupState, type MatchupTab } from '@/pages/matchup-center/use-matchup-state'
import { TeamPicker } from './components/team-picker'
import { apiHost } from './lib/api-plugin'
import { ComingSoonTab } from './tabs/coming-soon'
import { OverviewTab } from './tabs/overview'

// Tab strip order matches the mockup. Only Overview has a real body in P2;
// the others render a small placeholder until P3/P4.
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

  return (
    <div className="matchup-panel">
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
          <span className="matchup-vs">VS</span>
          <TeamPicker
            side="b"
            source={state.teamBSource}
            onSelect={(roster, source) => dispatch({ type: 'SET_TEAM_B', roster, source })}
          />
        </div>
      </header>

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
            teamA={activeTeamA}
            teamB={activeTeamB}
            sourceA={state.teamASource}
            sourceB={state.teamBSource}
          />
        ) : (
          <ComingSoonTab tab={state.activeTab} />
        )}
      </div>

      <footer className="matchup-brand">
        <span className="matchup-brand-mark">CANNOLI</span> · matchup center · data from {apiHost()}
      </footer>
    </div>
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
