import type { RosterPokemon } from '@/lib/types'
import type { TeamSource } from '@/pages/matchup-center/use-matchup-state'
import { RosterRow } from '../components/roster-row'
import { SpeedLadder } from '../components/speed-ladder'
import { siteTeamUrl } from '../lib/links'

interface OverviewTabProps {
  /** Full rosters — the selection UI needs every row visible. */
  teamA: RosterPokemon[]
  teamB: RosterPokemon[]
  /** Sub-team-narrowed rosters — drive the ladder + summary, matching what
   *  the analysis tabs compute on. */
  activeTeamA: RosterPokemon[]
  activeTeamB: RosterPokemon[]
  subTeamA: Set<string>
  subTeamB: Set<string>
  onToggleSub: (side: 'a' | 'b', name: string) => void
  onResetSubs: () => void
  sourceA: TeamSource | null
  sourceB: TeamSource | null
}

/**
 * Overview: your roster (left, blue) · speed ladder (center) · opponent
 * roster (right, red), plus the computed summary bar when both sides are
 * populated. Same semantics as the site's overview tab, mockup layout.
 * Each row carries a sub-team toggle dot; with a selection active the ladder,
 * summary, and every analysis tab narrow to the selected mons.
 */
export function OverviewTab({
  teamA, teamB, activeTeamA, activeTeamB,
  subTeamA, subTeamB, onToggleSub, onResetSubs,
  sourceA, sourceB,
}: OverviewTabProps) {
  return (
    <div className="matchup-overview">
      <div className="matchup-cmp">
        <RosterColumn
          side="a"
          team={teamA}
          subTeam={subTeamA}
          source={sourceA}
          fallback="Your team"
          onToggle={name => onToggleSub('a', name)}
          onReset={onResetSubs}
        />

        <SpeedLadder teamA={activeTeamA} teamB={activeTeamB} />

        <RosterColumn
          side="b"
          team={teamB}
          subTeam={subTeamB}
          source={sourceB}
          fallback="Opponent"
          onToggle={name => onToggleSub('b', name)}
          onReset={onResetSubs}
        />
      </div>
    </div>
  )
}

function RosterColumn({
  side, team, subTeam, source, fallback, onToggle, onReset,
}: {
  side: 'a' | 'b'
  team: RosterPokemon[]
  subTeam: Set<string>
  source: TeamSource | null
  fallback: string
  onToggle: (name: string) => void
  onReset: () => void
}) {
  const hasSub = subTeam.size > 0
  return (
    <div className={side === 'a' ? 'matchup-col matchup-col-a' : 'matchup-col matchup-col-b'}>
      <ColHead
        source={source}
        fallback={fallback}
        count={team.length}
        subCount={subTeam.size}
        onReset={onReset}
      />
      {team.length === 0 ? (
        <EmptySide side={side} source={source} />
      ) : (
        team.map(p => (
          <RosterRow
            key={p.name}
            pokemon={p}
            side={side}
            selected={subTeam.has(p.name)}
            dimmed={hasSub && !subTeam.has(p.name)}
            onToggleSelect={() => onToggle(p.name)}
          />
        ))
      )}
    </div>
  )
}

function ColHead({
  source, fallback, count, subCount, onReset,
}: {
  source: TeamSource | null
  fallback: string
  count: number
  subCount: number
  onReset: () => void
}) {
  const label = source?.label ?? fallback
  return (
    <div className="matchup-col-h">
      {source?.type === 'league' && source.leagueId && source.teamId ? (
        <a href={siteTeamUrl(source.leagueId, source.teamId)} target="_blank" rel="noopener">
          {label}
        </a>
      ) : (
        <span>{label}</span>
      )}
      {subCount > 0 ? (
        <span className="matchup-col-h-count">
          {subCount} selected ·{' '}
          <button type="button" className="matchup-col-h-reset" onClick={onReset}>
            Reset
          </button>
        </span>
      ) : (
        <span className="matchup-col-h-count">{count} mons</span>
      )}
    </div>
  )
}

function EmptySide({ side, source }: { side: 'a' | 'b'; source: TeamSource | null }) {
  const builderIdle = side === 'a' && source?.type === 'builder'
  return (
    <div className="matchup-empty">
      <div className="matchup-empty-title">
        {builderIdle ? 'Waiting for your build' : 'No team selected'}
      </div>
      <div className="matchup-empty-hint">
        {builderIdle
          ? 'Open a team in the teambuilder to sync your build.'
          : `Pick a league team from the ${side === 'a' ? 'You' : 'Opponent'} menu above.`}
      </div>
    </div>
  )
}
