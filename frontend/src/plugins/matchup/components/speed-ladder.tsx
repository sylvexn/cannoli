import { useMemo } from 'react'
import type { RosterPokemon } from '@/lib/types'

/**
 * Base-speed ladder (mockup `.mid`): both teams merged, sorted by base Spe
 * descending, blue bars left (you) / red bars right (opponent). Shared by the
 * Overview center column and the Speed tab.
 */
export function SpeedLadder({
  teamA,
  teamB,
  title = 'Speed',
}: {
  teamA: RosterPokemon[]
  teamB: RosterPokemon[]
  title?: string
}) {
  const ladder = useMemo(
    () =>
      [
        ...teamA.map(p => ({ p, side: 'a' as const })),
        ...teamB.map(p => ({ p, side: 'b' as const })),
      ].sort((x, y) => y.p.stats.spe - x.p.stats.spe),
    [teamA, teamB],
  )
  const maxSpe = ladder.length > 0 ? ladder[0].p.stats.spe : 0

  return (
    <div className="matchup-mid">
      <div className="matchup-mid-h">{title}</div>
      {ladder.length === 0 ? (
        <div className="matchup-mid-hint">&mdash;</div>
      ) : (
        ladder.map(({ p, side }, i) => (
          <div key={`${side}-${p.name}-${i}`} className={`matchup-mrow matchup-mrow-${side}`} title={`${p.name} — ${p.stats.spe}`}>
            {/* Name gets its own full-width line so it uses the whole center
                column instead of fighting the speed bar for room. */}
            <span className="matchup-mname">{p.name}</span>
            <span className="matchup-mbarline">
              {side === 'a' ? (
                <span className="matchup-mside matchup-mside-a">
                  <span className="matchup-mbar matchup-mbar-a" style={{ width: barWidth(p.stats.spe, maxSpe) }} />
                </span>
              ) : (
                <span />
              )}
              <span className="matchup-tick">{p.stats.spe}</span>
              {side === 'b' ? (
                <span className="matchup-mside matchup-mside-b">
                  <span className="matchup-mbar matchup-mbar-b" style={{ width: barWidth(p.stats.spe, maxSpe) }} />
                </span>
              ) : (
                <span />
              )}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

function barWidth(spe: number, maxSpe: number): string {
  if (maxSpe <= 0) return '0%'
  // Fastest mon spans ~85% of its half-column (mockup scale), floor at 5%.
  return `${Math.max(5, Math.round((spe / maxSpe) * 85))}%`
}
