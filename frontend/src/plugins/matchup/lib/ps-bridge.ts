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
// - a continuous ~600ms poll that runs whenever the Matchup room EXISTS and
//   the document is visible — the whole point of the side-by-side layout is
//   editing in the teambuilder while the Matchup pane watches, so the poll
//   must not depend on the Matchup room having focus. `document.hidden`
//   pauses it (no background-tab work); a visibilitychange listener re-checks
//   immediately on return.
//
// The change FINGERPRINT covers the entire build — species, chosen ability,
// item, moves, teraType, level, nickname per set, plus team name and set
// order — so any teambuilder edit re-syncs within one poll tick, not just
// adds/removes.

import { resolvePokemonByName } from '@/lib/pokemon-name-resolver'
import { rosterMonFromPokemonRow } from '@/lib/roster-from-api'
import type { RosterPokemon } from '@/lib/types'
import { pluginApi } from './api-plugin'

const MATCHUP_ROOM_ID = 'view-matchup'
const POLL_MS = 600

/** One teambuilder set, normalized down to the fields the pane analyses. */
export interface BuildSet {
  /** Species display name ("Great Tusk", "Rotom-Wash"). */
  species: string
  /** Nickname when it differs from the species name, else null. */
  nickname: string | null
  ability: string | null
  item: string | null
  moves: string[]
  teraType: string | null
  level: number | null
}

export interface CurrentBuild {
  /** Team name from the teambuilder, null when unnamed. */
  name: string | null
  /** All non-empty sets, teambuilder order (duplicates preserved). */
  sets: BuildSet[]
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

  const sets: BuildSet[] = []
  for (const set of setList) {
    const species = (set?.species || set?.name || '').trim()
    if (!species) continue // in-progress empty slot
    const nick = (set?.name ?? '').trim()
    sets.push({
      species,
      nickname: nick && nick !== species ? nick : null,
      ability: (set?.ability ?? '').trim() || null,
      item: (set?.item ?? '').trim() || null,
      moves: (set?.moves ?? []).filter(Boolean),
      teraType: (set?.teraType ?? '').trim() || null,
      level: typeof set?.level === 'number' ? set.level : null,
    })
  }
  const name = (tb?.curTeam?.name ?? '').trim() || null
  return { name, sets }
}

/** Whole-build change fingerprint: team name + per-set species/ability/item/
 *  moves/teraType/level/nickname, order-sensitive. '' = no team open. */
export function buildFingerprint(build: CurrentBuild | null): string {
  if (!build) return ''
  const sets = build.sets
    .map(
      s =>
        `${s.species}^${s.ability ?? ''}^${s.item ?? ''}^${s.moves.join('~')}^${
          s.teraType ?? ''
        }^${s.level ?? ''}^${s.nickname ?? ''}`,
    )
    .join(';')
  return `${build.name ?? ''}||${sets}`
}

/** Executed (non-gated) poll ticks — read by the Playwright verification
 *  harness to assert the poll pauses while document.hidden. */
let pollTicks = 0
function bumpPollDebug() {
  pollTicks++
  ;(window as unknown as { __cannoliMatchupPolls?: number }).__cannoliMatchupPolls = pollTicks
}

/**
 * Notify `cb` whenever the current build (may have) changed. Fingerprint-
 * deduped, so `cb` only fires on real changes. Returns an unsubscribe that
 * clears the 'saveteams' listener, the poll interval, and the visibility
 * listener — call it on room destroy / effect cleanup.
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

  const tick = () => {
    // Poll while the Matchup room exists and the tab is visible — edits made
    // with the TEAMBUILDER focused (the side-by-side flow) propagate within
    // one tick; hidden tabs do no work.
    if (document.visibilityState === 'hidden') return
    if (!window.app?.rooms?.[MATCHUP_ROOM_ID]) return
    bumpPollDebug()
    check()
  }

  user?.on('saveteams', check, ctx)
  const timer = window.setInterval(tick, POLL_MS)
  const onVisibility = () => {
    if (document.visibilityState === 'visible') tick()
  }
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    user?.off('saveteams', check, ctx)
  }
}

const warnedMisses = new Set<string>()

/** Overlay the ACTUAL build onto the API mon where it matters for analysis:
 *  the set's chosen ability goes first in `abilities` (falling back to the
 *  full API list when the set has none) so the Type Chart's `abilities[0]`
 *  override tracks the real build. Applied per-sync to a clone — the cache
 *  keeps pristine rows, so set-detail edits never require a refetch.
 *  Deliberately does NOT mark builder mons as tera captains: a paste-level
 *  teraType carries no captain semantics. */
function overlayBuild(base: RosterPokemon, set: BuildSet): RosterPokemon {
  if (!set.ability) return base
  const chosen = set.ability
  const rest = base.abilities.filter(a => a.toLowerCase() !== chosen.toLowerCase())
  return { ...base, abilities: [chosen, ...rest] }
}

/**
 * Resolve teambuilder sets to Cannoli RosterPokemon via the shared
 * Showdown→Cannoli name resolver (lib/pokemon-name-resolver.ts — ordered
 * candidate walk over `GET /api/pokemon/:name`, so Showdown species names
 * like "Gardevoir-Mega" or bare "Urshifu" land on their DB rows), then apply
 * the per-set build overlay. The resolver caches per-candidate hits AND
 * misses (network errors stay retryable). Duplicate species keep the FIRST
 * set; unknown species are skipped, warned once per name, and returned in
 * `missing` for the UI's inline note.
 */
export async function resolveToRoster(
  sets: BuildSet[],
): Promise<{ roster: RosterPokemon[]; missing: string[] }> {
  const seen = new Set<string>()
  const distinct = sets.filter(s => {
    const key = s.species.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const results = await Promise.all(
    distinct.map(async set => {
      const row = await resolvePokemonByName(set.species, pluginApi.getPokemonByName)
      const base = row ? rosterMonFromPokemonRow(row) : null
      return { name: set.species, mon: base ? overlayBuild(base, set) : null }
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
