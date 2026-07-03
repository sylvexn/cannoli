// Teambuilder bridge — reads the team currently being built in the PS
// client's teambuilder and resolves it to Cannoli RosterPokemon.
//
// Source of truth: `app.rooms['teambuilder'].curSetList` is the LIVE
// in-progress set list while a team is open for editing
// (js/client-teambuilder.js:764 — `Storage.activeSetList = this.curSetList =
// Storage.unpackTeam(this.curTeam.team)`), with `Storage.activeSetList` as
// the fallback mirror. Each set carries `species` as a Showdown display name
// ("Great Tusk", "Rotom-Wash"); we never parse packed teams ourselves — the
// client's own Storage.unpackTeam already produced these sets.
//
// Change detection is two-layer:
// - `app.user.on('saveteams')` — fired by the client on team save / delete /
//   back / blur (js/client-teambuilder.js:42,120,783,803,1037). Catches every
//   committed edit immediately.
// - a light 1s poll of a cheap fingerprint (team name + species list), gated
//   to ticks where the Matchup room is the focused room — the teambuilder
//   only fires 'saveteams' on blur/save, so edits made mid-session are picked
//   up the moment the user flips over to the Matchup tab.

import { rosterMonFromPokemonRow } from '@/lib/roster-from-api'
import type { RosterPokemon } from '@/lib/types'
import { pluginApi } from './api-plugin'

const MATCHUP_ROOM_ID = 'view-matchup'
const POLL_MS = 1000

export interface CurrentBuild {
  /** Team name from the teambuilder, null when unnamed. */
  name: string | null
  /** Distinct species display names, teambuilder order, empty slots skipped. */
  species: string[]
}

/** The PS client shadows the DOM `Storage` constructor with its own plain
 *  object; read it through a cast so lib.dom's typing stays untouched. */
function psStorage(): PSStorage | undefined {
  return (window as unknown as { Storage?: PSStorage }).Storage
}

/**
 * The team currently open in the teambuilder, or null when no team is open
 * (team-list view / teambuilder never opened).
 */
export function getCurrentBuild(): CurrentBuild | null {
  const tb = window.app?.rooms?.['teambuilder'] as PSTeambuilderRoom | undefined
  const setList = tb?.curSetList ?? psStorage()?.activeSetList ?? null
  if (!setList) return null

  const seen = new Set<string>()
  const species: string[] = []
  for (const set of setList) {
    const s = (set?.species || set?.name || '').trim()
    if (!s) continue // in-progress empty slot
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    species.push(s)
  }
  const name = (tb?.curTeam?.name ?? '').trim() || null
  return { name, species }
}

/** Cheap change fingerprint: team name + joined species list. */
export function buildFingerprint(build: CurrentBuild | null): string {
  return build ? `${build.name ?? ''}|${build.species.join(',')}` : ''
}

/**
 * Notify `cb` whenever the current build (may have) changed. Fingerprint-
 * deduped, so `cb` only fires on real changes. Returns an unsubscribe that
 * clears both the 'saveteams' listener and the poll interval — call it on
 * room destroy / effect cleanup.
 */
export function subscribeToBuild(cb: () => void): () => void {
  const user = window.app?.user
  const ctx = {} // Backbone off() context handle
  let lastFp = buildFingerprint(getCurrentBuild())

  const check = () => {
    const fp = buildFingerprint(getCurrentBuild())
    if (fp === lastFp) return
    lastFp = fp
    cb()
  }

  user?.on('saveteams', check, ctx)
  const timer = window.setInterval(() => {
    // Poll only while the Matchup room is focused — per-keystroke freshness
    // for the teambuilder -> matchup flow without permanent background work.
    if (window.app?.curRoom?.id !== MATCHUP_ROOM_ID) return
    check()
  }, POLL_MS)

  return () => {
    window.clearInterval(timer)
    user?.off('saveteams', check, ctx)
  }
}

/** name(lowercased) -> resolved mon. `null` = confirmed miss (API returned
 *  no row); network errors are NOT cached so a flaky fetch can retry. */
const monCache = new Map<string, RosterPokemon | null>()
const warnedMisses = new Set<string>()

/**
 * Resolve teambuilder species names to Cannoli RosterPokemon via
 * `GET /api/pokemon/:name` (exact-name match, same lookup the site's custom
 * team builder uses). Unknown species are skipped, warned once per name, and
 * returned in `missing` for the UI's inline note.
 */
export async function resolveToRoster(
  species: string[],
): Promise<{ roster: RosterPokemon[]; missing: string[] }> {
  const results = await Promise.all(
    species.map(async name => {
      const key = name.toLowerCase()
      if (monCache.has(key)) return { name, mon: monCache.get(key) ?? null }
      try {
        const row = await pluginApi.getPokemonByName(name)
        const mon = row ? rosterMonFromPokemonRow(row) : null
        monCache.set(key, mon)
        return { name, mon }
      } catch {
        // Network/API failure — treat as missing for this pass, don't cache.
        return { name, mon: null }
      }
    }),
  )

  const missing = results.filter(r => !r.mon).map(r => r.name)
  for (const name of missing) {
    const key = name.toLowerCase()
    if (warnedMisses.has(key)) continue
    warnedMisses.add(key)
    console.warn(`[cannoli-matchup] teambuilder species not found in Cannoli: ${name}`)
  }

  return { roster: results.flatMap(r => (r.mon ? [r.mon] : [])), missing }
}
