import { useMemo } from 'react'
import type { RosterPokemon } from '@/lib/types'
import type { PokemonType } from '@/lib/pokemon'
import type { TeamSource } from '@/pages/matchup-center/use-matchup-state'
import { RosterRow } from '../components/roster-row'
import { SpeedLadder } from '../components/speed-ladder'
import { sitePokemonUrl, siteTeamUrl } from '../lib/links'
import { computeSummary, type MatchupSummary } from '../lib/summary'

interface OverviewTabProps {
  teamA: RosterPokemon[]
  teamB: RosterPokemon[]
  sourceA: TeamSource | null
  sourceB: TeamSource | null
}

/**
 * Overview: your roster (left, blue) · speed ladder (center) · opponent
 * roster (right, red), plus the computed summary bar when both sides are
 * populated. Same semantics as the site's overview tab, mockup layout.
 */
export function OverviewTab({ teamA, teamB, sourceA, sourceB }: OverviewTabProps) {
  const summary = useMemo(() => computeSummary(teamA, teamB), [teamA, teamB])

  return (
    <div className="matchup-overview">
      <div className="matchup-cmp">
        <div className="matchup-col matchup-col-a">
          <ColHead source={sourceA} fallback="Your team" count={teamA.length} />
          {teamA.length === 0 ? (
            <EmptySide side="a" source={sourceA} />
          ) : (
            teamA.map(p => <RosterRow key={p.name} pokemon={p} side="a" />)
          )}
        </div>

        <SpeedLadder teamA={teamA} teamB={teamB} />

        <div className="matchup-col matchup-col-b">
          <ColHead source={sourceB} fallback="Opponent" count={teamB.length} />
          {teamB.length === 0 ? (
            <EmptySide side="b" source={sourceB} />
          ) : (
            teamB.map(p => <RosterRow key={p.name} pokemon={p} side="b" />)
          )}
        </div>
      </div>

      {summary && <SummaryFoot summary={summary} />}
    </div>
  )
}

function ColHead({ source, fallback, count }: { source: TeamSource | null; fallback: string; count: number }) {
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
      <span className="matchup-col-h-count">{count} mons</span>
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
