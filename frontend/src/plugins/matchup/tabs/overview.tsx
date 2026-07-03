import { useMemo } from 'react'
import type { RosterPokemon } from '@/lib/types'
import type { PokemonType } from '@/lib/pokemon'
import type { TeamSource } from '@/pages/matchup-center/use-matchup-state'
import { RosterRow } from '../components/roster-row'
import { SpeedLadder } from '../components/speed-ladder'
import { sitePokemonUrl, siteTeamUrl } from '../lib/links'
import { computeSummary, type MatchupSummary } from '../lib/summary'

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
  const summary = useMemo(() => computeSummary(activeTeamA, activeTeamB), [activeTeamA, activeTeamB])

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

      {summary && <SummaryFoot summary={summary} />}
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
      {hasSub && (
        <div className="matchup-col-subnote">analyzing {subTeam.size}/{team.length}</div>
      )}
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

function PokeLink({ name, className }: { name: string; className?: string }) {
  return (
    <a href={sitePokemonUrl(name)} target="_blank" rel="noopener" className={className}>
      {name}
    </a>
  )
}

function capType(t: PokemonType): string {
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function SummaryFoot({ summary }: { summary: MatchupSummary }) {
  const { speed, sharedWeaknesses, threats } = summary
  return (
    <div className="matchup-foot">
      <span>
        <span className="matchup-foot-k">Speed:</span> <PokeLink name={speed.fastest.name} />{' '}
        {speed.notOutsped.length === 0 ? (
          'outspeeds everything'
        ) : speed.notOutsped.length <= 2 ? (
          <>
            outspeeds all but{' '}
            {speed.notOutsped.map((p, i) => (
              <span key={p.name}>
                {i > 0 && ', '}
                <PokeLink name={p.name} />
              </span>
            ))}
          </>
        ) : (
          `outspeeds all but ${speed.notOutsped.length} opponents`
        )}
      </span>

      <span>
        <span className="matchup-foot-k">Shared weaknesses:</span>{' '}
        {sharedWeaknesses.length === 0
          ? 'none shared'
          : sharedWeaknesses.map(w => `${capType(w.type)} ×${w.count}`).join(' · ')}
      </span>

      {threats && (
        <span>
          <span className="matchup-foot-k">Threats:</span>{' '}
          {threats.names.map((name, i) => (
            <span key={name}>
              {i > 0 && ', '}
              <PokeLink name={name} className="matchup-foot-threat" />
            </span>
          ))}{' '}
          pressure {threats.count}/{threats.total}
        </span>
      )}
    </div>
  )
}
