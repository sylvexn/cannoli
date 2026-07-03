import { useMemo } from 'react'
import { calcSpeed } from '@/lib/speed'
import type { RosterPokemon } from '@/lib/types'
import type { SpeedCalcSlot } from '@/pages/matchup-center/use-matchup-state'
import { PokeSprite } from '../components/sprite'
import { SpeedLadder } from '../components/speed-ladder'

// Parity port of the site's speed-tab.tsx: configurable speed-calc slots
// (mon / level / EVs / IVs / boosts / nature / Scarf / Sticky Web) computed
// through the shared calcSpeed, beside the same base-speed ladder the
// Overview center column uses. Numeric fields are plugin-native steppers
// (small +/- buttons), never native number spinners.

interface SpeedTabProps {
  teamA: RosterPokemon[]
  teamB: RosterPokemon[]
  slots: SpeedCalcSlot[]
  onAddSlot: () => void
  onRemoveSlot: (id: string) => void
  onUpdateSlot: (id: string, updates: Partial<SpeedCalcSlot>) => void
}

export function SpeedTab({ teamA, teamB, slots, onAddSlot, onRemoveSlot, onUpdateSlot }: SpeedTabProps) {
  const allPokemon = useMemo(() => [...teamA, ...teamB].sort((a, b) => b.stats.spe - a.stats.spe), [teamA, teamB])

  return (
    <div className="matchup-speed">
      <div className="matchup-speed-calcs">
        <div className="matchup-speed-head">
          <span className="matchup-sec-label">Speed calculator</span>
          <button type="button" className="matchup-btn" onClick={onAddSlot}>
            + Add slot
          </button>
        </div>
        <div className="matchup-speed-grid">
          {slots.map(slot => (
            <SpeedCalcCard
              key={slot.id}
              slot={slot}
              allPokemon={allPokemon}
              onUpdate={updates => onUpdateSlot(slot.id, updates)}
              onRemove={slots.length > 1 ? () => onRemoveSlot(slot.id) : undefined}
            />
          ))}
        </div>
      </div>

      <div className="matchup-speed-ladder">
        <SpeedLadder teamA={teamA} teamB={teamB} title="Base speed" />
      </div>
    </div>
  )
}

function SpeedCalcCard({
  slot,
  allPokemon,
  onUpdate,
  onRemove,
}: {
  slot: SpeedCalcSlot
  allPokemon: RosterPokemon[]
  onUpdate: (updates: Partial<SpeedCalcSlot>) => void
  onRemove?: () => void
}) {
  const pokemon = allPokemon.find(p => p.name === slot.pokemonName)
  const baseSpe = pokemon?.stats.spe ?? 0
  const computed = pokemon
    ? calcSpeed(baseSpe, slot.level, slot.evs, slot.ivs, slot.nature, slot.boosts, slot.scarf, slot.stickyWeb)
    : 0

  return (
    <div className="matchup-scard">
      <div className="matchup-scard-top">
        <span className="matchup-scard-id">
          {pokemon && <PokeSprite name={pokemon.name} shiny={pokemon.isShiny} />}
          <span className="matchup-scard-num">{computed}</span>
        </span>
        {onRemove && (
          <button type="button" className="matchup-scard-x" onClick={onRemove} title="Remove slot" aria-label="Remove slot">
            ×
          </button>
        )}
      </div>

      <select
        className="matchup-select"
        value={slot.pokemonName}
        onChange={e => {
          if (e.target.value) onUpdate({ pokemonName: e.target.value })
        }}
      >
        <option value="" disabled>
          Select…
        </option>
        {allPokemon.map((p, i) => (
          <option key={`${p.name}-${i}`} value={p.name}>
            {p.name} ({p.stats.spe})
          </option>
        ))}
      </select>

      <div className="matchup-scard-fields">
        <StepField label="Lv" value={slot.level} min={1} max={100} onChange={v => onUpdate({ level: v })} />
        <StepField label="EVs" value={slot.evs} min={0} max={252} step={4} onChange={v => onUpdate({ evs: v })} />
        <StepField label="IVs" value={slot.ivs} min={0} max={31} onChange={v => onUpdate({ ivs: v })} />
        <StepField label="Boost" value={slot.boosts} min={-6} max={6} onChange={v => onUpdate({ boosts: v })} />
      </div>

      <div className="matchup-seg" role="group" aria-label="Speed nature">
        {(['positive', 'neutral', 'negative'] as const).map(n => (
          <button
            key={n}
            type="button"
            className={
              slot.nature === n
                ? `matchup-seg-btn matchup-seg-btn-active matchup-seg-${n}`
                : 'matchup-seg-btn'
            }
            onClick={() => onUpdate({ nature: n })}
          >
            {n === 'positive' ? '+Spe' : n === 'negative' ? '-Spe' : 'Neutral'}
          </button>
        ))}
      </div>

      <div className="matchup-seg" role="group" aria-label="Modifiers">
        <button
          type="button"
          className={slot.scarf ? 'matchup-seg-btn matchup-seg-btn-active matchup-seg-scarf' : 'matchup-seg-btn'}
          onClick={() => onUpdate({ scarf: !slot.scarf })}
        >
          Scarf
        </button>
        <button
          type="button"
          className={slot.stickyWeb ? 'matchup-seg-btn matchup-seg-btn-active matchup-seg-web' : 'matchup-seg-btn'}
          onClick={() => onUpdate({ stickyWeb: !slot.stickyWeb })}
        >
          Sticky Web
        </button>
      </div>

      {pokemon && <div className="matchup-scard-base">Base: {baseSpe}</div>}
    </div>
  )
}

/** Labeled numeric field with plugin-native −/+ steppers (repo convention:
 *  never native type="number" spinners). Typed input is clamped to range. */
function StepField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  return (
    <label className="matchup-num">
      <span className="matchup-num-label">{label}</span>
      <span className="matchup-num-ctl">
        <button type="button" onClick={() => onChange(clamp(value - step))} aria-label={`Decrease ${label}`}>
          −
        </button>
        <input
          inputMode="numeric"
          value={value}
          onChange={e => {
            const n = parseInt(e.target.value, 10)
            if (!Number.isNaN(n)) onChange(clamp(n))
          }}
          aria-label={label}
        />
        <button type="button" onClick={() => onChange(clamp(value + step))} aria-label={`Increase ${label}`}>
          +
        </button>
      </span>
    </label>
  )
}
