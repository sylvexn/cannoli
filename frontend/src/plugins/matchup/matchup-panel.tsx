// P0 placeholder panel — the real Matchup Center UI replaces this in later
// phases (header pickers + tab strip + analysis tabs, per the mockups).

export function MatchupPanel() {
  return (
    <div className="matchup-panel">
      <header className="matchup-header">
        <span className="matchup-wordmark">
          <span className="matchup-wordmark-accent">CANNOLI</span> MATCHUP CENTER
        </span>
      </header>
      <div className="matchup-body">
        <div className="matchup-placeholder-title">Harness online</div>
        <p className="matchup-placeholder-sub">
          The Matchup Center is under construction. Scouting, type charts,
          speed ladders, and coverage analysis will live here.
        </p>
      </div>
    </div>
  )
}
