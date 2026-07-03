// React glue for the teambuilder bridge: keeps "your team" (side A) in sync
// with the build currently open in the PS teambuilder.
//
// Modes (derived from the current TeamSource by MatchupRoom):
// - 'active' — source is 'builder': every build change dispatches a fresh
//   roster (including an EMPTY one when the teambuilder has no open team, so
//   the panel can show the "waiting for a team" hint).
// - 'auto'   — nothing selected yet: silently watch the teambuilder and adopt
//   the build as soon as it has >=1 resolvable mon. This is the plugin's
//   auto-default for side A (replaces the site's userId-based auto-populate).
// - 'off'    — a league/custom team was picked: do nothing.

import { useEffect, useRef, useState } from 'react'
import type { RosterPokemon } from '@/lib/types'
import type { TeamSource } from '@/pages/matchup-center/use-matchup-state'
import { buildFingerprint, getCurrentBuild, resolveToRoster, subscribeToBuild } from './ps-bridge'

export type BuilderSyncMode = 'off' | 'auto' | 'active'

export interface BuilderSyncState {
  /** Teambuilder currently has an open build with >=1 mon. */
  hasBuild: boolean
  buildName: string | null
  /** Species in the build that don't resolve to a Cannoli Pokemon row. */
  missing: string[]
}

const IDLE: BuilderSyncState = { hasBuild: false, buildName: null, missing: [] }

export function builderSourceLabel(buildName: string | null): string {
  return buildName ? `Your build (${buildName})` : 'Your build'
}

export function useBuilderSync(
  mode: BuilderSyncMode,
  onRoster: (roster: RosterPokemon[], source: TeamSource) => void,
): BuilderSyncState {
  const [snap, setSnap] = useState<BuilderSyncState>(IDLE)
  const onRosterRef = useRef(onRoster)
  onRosterRef.current = onRoster

  useEffect(() => {
    if (mode === 'off') return

    let disposed = false
    let applyToken = 0
    let lastAppliedFp: string | null = null

    const apply = async () => {
      const token = ++applyToken
      const build = getCurrentBuild()
      const fp = buildFingerprint(build)
      if (fp === lastAppliedFp) return

      const sets = build?.sets ?? []
      const { roster, missing } = await resolveToRoster(sets)
      // A newer apply superseded this one (build changed mid-resolve) — drop.
      if (disposed || token !== applyToken) return
      lastAppliedFp = fp

      const buildName = build?.name ?? null
      setSnap({ hasBuild: sets.length > 0, buildName, missing })

      // Auto mode only ADOPTS a real build; it never clears/claims side A
      // while the teambuilder is empty or nothing resolved.
      if (mode === 'auto' && roster.length === 0) return
      onRosterRef.current(roster, { type: 'builder', label: builderSourceLabel(buildName) })
      // Minimal debug marker: lets the verification harness observe syncs
      // that don't change the visible roster (e.g. a move edit).
      ;(window as unknown as { __cannoliMatchupLastSyncFp?: string }).__cannoliMatchupLastSyncFp = fp
    }

    void apply()
    const unsubscribe = subscribeToBuild(() => void apply())
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [mode])

  return mode === 'off' ? IDLE : snap
}
