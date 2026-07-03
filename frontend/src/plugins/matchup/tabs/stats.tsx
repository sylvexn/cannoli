import { useMemo, useState } from 'react'
import type { RosterPokemon } from '@/lib/types'
import { PokeSprite } from '../components/sprite'
import { sitePokemonUrl } from '../lib/links'

// Parity port of the site's stats-tab.tsx: one sortable base-stat table per
// team (default Spe desc; clicking a header toggles desc -> asc), stat values
// colored by the same thresholds (>=130 / >=100 / >=80 neutral / >=60 amber /
// below red, palette-adapted), Team Average footer row (rounded).

interface StatsTabProps {
  teamA: RosterPokemon[]
  teamB: RosterPokemon[]
}

type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe'
const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP', atk: 'ATK', def: 'DEF', spa: 'SPA', spd: 'SPD', spe: 'SPE',
}

/** Same thresholds as the site's statColor, plugin palette classes. */
function statClass(val: number): string {
  if (val >= 130) return 'matchup-stat-hi'
  if (val >= 100) return 'matchup-stat-good'
  if (val >= 80) return ''
  if (val >= 60) return 'matchup-stat-mid'
  return 'matchup-stat-low'
}

export function StatsTab({ teamA, teamB }: StatsTabProps) {
  return (
    <div className="matchup-stats">
      <StatsTable team={teamA} side="a" />
      <StatsTable team={teamB} side="b" />
    </div>
  )
}

function StatsTable({ team, side }: { team: RosterPokemon[]; side: 'a' | 'b' }) {
  const [sortKey, setSortKey] = useState<StatKey>('spe')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(
    () =>
      [...team].sort((a, b) => {
        const diff = a.stats[sortKey] - b.stats[sortKey]
        return sortDir === 'desc' ? -diff : diff
      }),
    [team, sortKey, sortDir],
  )

  const averages = useMemo(() => {
    if (team.length === 0) return null
    const avg: Record<StatKey, number> = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
    for (const p of team) {
      for (const k of STAT_KEYS) avg[k] += p.stats[k]
    }
    for (const k of STAT_KEYS) avg[k] = Math.round(avg[k] / team.length)
    return avg
  }, [team])

  function handleSort(key: StatKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  if (team.length === 0) {
    return (
      <div className="matchup-empty">
        <div className="matchup-empty-title">No team selected</div>
        <div className="matchup-empty-hint">
          Pick a team from the {side === 'a' ? 'You' : 'Opponent'} menu above.
        </div>
      </div>
    )
  }

  return (
    <div className={side === 'a' ? 'matchup-stats-card matchup-stats-a' : 'matchup-stats-card matchup-stats-b'}>
      <div className="matchup-stats-scroll">
        <table className="matchup-stats-table">
          <thead>
            <tr className="matchup-stats-headrow">
              <th className="matchup-stats-monhead" colSpan={2}>Pokemon</th>
              {STAT_KEYS.map(key => (
                <th
                  key={key}
                  className={sortKey === key ? 'matchup-stats-th matchup-stats-th-active' : 'matchup-stats-th'}
                  onClick={() => handleSort(key)}
                  role="button"
                  aria-sort={sortKey === key ? (sortDir === 'desc' ? 'descending' : 'ascending') : undefined}
                >
                  {STAT_LABELS[key]}
                  <span className="matchup-stats-arrow" aria-hidden="true">
                    {sortKey === key ? (sortDir === 'desc' ? '▾' : '▴') : ''}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(pokemon => (
              <tr key={pokemon.name} className="matchup-stats-row">
                <td className="matchup-stats-mon">
                  <a
                    href={sitePokemonUrl(pokemon.name)}
                    target="_blank"
                    rel="noopener"
                    className="matchup-stats-monlink"
                    title={pokemon.nickname ? `${pokemon.name} — "${pokemon.nickname}"` : pokemon.name}
                  >
                    {pokemon.name}
                  </a>
                  {pokemon.nickname && (
                    <span className="matchup-stats-nick">"{pokemon.nickname}"</span>
                  )}
                </td>
                <td className="matchup-stats-sprite">
                  <PokeSprite name={pokemon.name} shiny={pokemon.isShiny} />
                </td>
                {STAT_KEYS.map(key => (
                  <td key={key} className={`matchup-stats-val ${statClass(pokemon.stats[key])}`}>
                    {pokemon.stats[key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {averages && (
            <tfoot>
              <tr className="matchup-stats-avgrow">
                <td className="matchup-stats-avglabel" colSpan={2}>Team Average</td>
                {STAT_KEYS.map(key => (
                  <td key={key} className={`matchup-stats-val ${statClass(averages[key])}`}>
                    {averages[key]}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
