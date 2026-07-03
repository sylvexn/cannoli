import { useMemo, useState } from 'react'
import { TYPE_COLORS, TYPE_LABELS } from '@/lib/constants'
import { POKEMON_TYPES, type PokemonType } from '@/lib/pokemon'
import { getDefensiveMatchups } from '@/lib/type-effectiveness'
import type { RosterPokemon } from '@/lib/types'
import { PokeSprite } from '../components/sprite'
import { sitePokemonUrl } from '../lib/links'

// Parity port of the site's typechart-tab.tsx: per-mon defensive matchups via
// the shared getDefensiveMatchups (types + first ability), defensive/offensive
// color-flip toggle, multiplier labels, per-type favorable/unfavorable footer.
// Layout is native-fit: the two grids stack vertically (you blue, opponent
// red) and each scrolls horizontally inside its own container — the room
// itself never scrolls sideways.

type ChartMode = 'defensive' | 'offensive'

interface TypeChartTabProps {
  teamA: RosterPokemon[]
  teamB: RosterPokemon[]
}

/** Same label set as the site: blank for x1, 0 for immune. */
function multLabel(m: number): string {
  if (m === 0) return '0'
  if (m === 0.25) return '¼'
  if (m === 0.5) return '½'
  if (m > 0 && m < 0.5) return '¼'
  if (m > 0.5 && m < 1) return '¾'
  if (m === 1) return ''
  if (m > 1 && m < 2) return '1½'
  if (m === 2) return '2'
  if (m > 2 && m < 4) return '3'
  if (m >= 4) return '4'
  return String(m)
}

/**
 * Cell class for a multiplier. Same green/red ramp semantics as the site,
 * adapted to the plugin palette: defensive = green resists / red weak;
 * offensive flips (green super-effective / red resisted). Immunity keeps one
 * muted style in both modes. Class names encode the hue (-g* green, -r* red)
 * so the offensive toggle is a pure green<->red class flip per cell.
 */
function multClass(m: number, mode: ChartMode): string {
  if (m === 0) return 'matchup-tc-x'
  if (m === 1) return ''
  const low = m < 1 // resisted-side multipliers
  const cls =
    m <= 0.25 ? 2 // strongest resist tier
    : low ? 1
    : m >= 4 ? 3
    : m >= 2 ? 2
    : 1 // 1 < m < 2 (e.g. 1.5 from Filter)
  if (mode === 'defensive') return low ? `matchup-tc-g${cls}` : `matchup-tc-r${cls}`
  return low ? `matchup-tc-r${cls}` : `matchup-tc-g${cls}`
}

export function TypeChartTab({ teamA, teamB }: TypeChartTabProps) {
  const [mode, setMode] = useState<ChartMode>('defensive')

  const chartA = useMemo(() => toChart(teamA), [teamA])
  const chartB = useMemo(() => toChart(teamB), [teamB])

  return (
    <div className="matchup-tc">
      <div className="matchup-tc-modebar">
        <span className="matchup-tc-modelabel">View:</span>
        <div className="matchup-tc-toggle" role="group" aria-label="Chart mode">
          <button
            type="button"
            className={mode === 'defensive' ? 'matchup-tc-mode matchup-tc-mode-active' : 'matchup-tc-mode'}
            onClick={() => setMode('defensive')}
          >
            Defensive
          </button>
          <button
            type="button"
            className={mode === 'offensive' ? 'matchup-tc-mode matchup-tc-mode-active' : 'matchup-tc-mode'}
            onClick={() => setMode('offensive')}
          >
            Offensive
          </button>
        </div>
        <span className="matchup-tc-modehint">
          {mode === 'defensive'
            ? '— green = resists, red = weak'
            : '— green = super-effective, red = resisted'}
        </span>
      </div>

      <TypeGrid title="Your team" side="a" chart={chartA} mode={mode} />
      <TypeGrid title="Opponent" side="b" chart={chartB} mode={mode} />
    </div>
  )
}

interface ChartRow {
  name: string
  nickname?: string | null
  isShiny?: boolean
  matchups: { type: PokemonType; multiplier: number }[]
}

function toChart(team: RosterPokemon[]): ChartRow[] {
  return team.map(p => ({
    name: p.name,
    nickname: p.nickname,
    isShiny: p.isShiny,
    matchups: getDefensiveMatchups(p.types as PokemonType[], p.abilities?.[0]),
  }))
}

function TypeGrid({
  title,
  side,
  chart,
  mode,
}: {
  title: string
  side: 'a' | 'b'
  chart: ChartRow[]
  mode: ChartMode
}) {
  const summary = useMemo(
    () =>
      POKEMON_TYPES.map(type => {
        let favorable = 0
        let unfavorable = 0
        for (const p of chart) {
          const mult = p.matchups.find(m => m.type === type)?.multiplier ?? 1
          if (mode === 'defensive') {
            if (mult < 1) favorable++
            else if (mult > 1) unfavorable++
          } else {
            if (mult > 1) favorable++
            else if (mult < 1 && mult > 0) unfavorable++
          }
        }
        return { type, favorable, unfavorable }
      }),
    [chart, mode],
  )

  const footerLabel = mode === 'defensive' ? 'Resist / Weak' : 'SE / Resisted'
  const favorableTitle = mode === 'defensive' ? 'resist' : 'super-effective'
  const unfavorableTitle = mode === 'defensive' ? 'weak' : 'resisted'

  return (
    <section className={side === 'a' ? 'matchup-tc-sec matchup-tc-sec-a' : 'matchup-tc-sec matchup-tc-sec-b'}>
      <div className="matchup-tc-sec-title">{title}</div>
      {chart.length === 0 ? (
        <div className="matchup-empty">
          <div className="matchup-empty-title">No team selected</div>
          <div className="matchup-empty-hint">
            Pick a team from the {side === 'a' ? 'You' : 'Opponent'} menu above.
          </div>
        </div>
      ) : (
        <div className="matchup-tc-scroll">
          <table className="matchup-tc-table">
            <thead>
              <tr>
                <th className="matchup-tc-mon matchup-tc-monhead">Pokemon</th>
                {POKEMON_TYPES.map(type => (
                  <th key={type} className="matchup-tc-th">
                    <span className="matchup-tc-typechip" style={{ backgroundColor: TYPE_COLORS[type] }} title={type}>
                      {TYPE_LABELS[type] ?? type.slice(0, 3)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.map(p => (
                <tr key={p.name}>
                  <td className="matchup-tc-mon">
                    <a
                      href={sitePokemonUrl(p.name)}
                      target="_blank"
                      rel="noopener"
                      className="matchup-tc-monlink"
                      title={p.nickname ? `${p.name} — "${p.nickname}"` : p.name}
                    >
                      <PokeSprite name={p.name} shiny={p.isShiny} />
                      <span className="matchup-tc-monname">{p.name}</span>
                    </a>
                  </td>
                  {p.matchups.map(({ type, multiplier }) => (
                    <td key={type} className={`matchup-tc-cell ${multClass(multiplier, mode)}`}>
                      {multLabel(multiplier)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="matchup-tc-mon matchup-tc-footlabel">{footerLabel}</td>
                {summary.map(({ type, favorable, unfavorable }) => (
                  <td
                    key={type}
                    className="matchup-tc-foot"
                    title={`${type}: ${favorable} ${favorableTitle}, ${unfavorable} ${unfavorableTitle}`}
                  >
                    <span className={favorable > 0 ? 'matchup-tc-fav' : 'matchup-tc-none'}>{favorable}</span>
                    <span className={unfavorable > 0 ? 'matchup-tc-unfav' : 'matchup-tc-none'}>{unfavorable}</span>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
