import type { MatchupTab } from '@/pages/matchup-center/use-matchup-state'

const TAB_TITLES: Record<MatchupTab, string> = {
  overview: 'Overview',
  typechart: 'Type Chart',
  speed: 'Speed',
  stats: 'Stats',
  moves: 'Moves',
}

/** Placeholder body for the analysis tabs that land in P3/P4. */
export function ComingSoonTab({ tab }: { tab: MatchupTab }) {
  return (
    <div className="matchup-soon">
      <div className="matchup-soon-title">{TAB_TITLES[tab]} — coming soon</div>
      <p className="matchup-soon-sub">
        This analysis is on its way. Overview is live now; the rest of the
        Matchup Center lands in upcoming updates.
      </p>
    </div>
  )
}
