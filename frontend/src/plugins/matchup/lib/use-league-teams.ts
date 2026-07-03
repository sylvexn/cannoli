// Shared "all league teams" loader for the plugin's team pickers.
//
// Fetches /api/leagues then /api/leagues/:id/teams per league, once, into a
// module-level cache — both the You and Opponent pickers read the same data.
// A tiny subscriber list keeps every mounted hook in sync (retry from one
// picker recovers both). Deliberately not a data library: three states, one
// cache, one inflight promise.

import { useEffect, useState } from 'react'
import { pluginApi, type ApiLeague, type ApiTeam } from './api-plugin'

export interface LeagueWithTeams {
  league: ApiLeague
  teams: ApiTeam[]
}

export type LeagueTeamsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; leagues: LeagueWithTeams[] }

let current: LeagueTeamsState = { status: 'loading' }
let inflight: Promise<void> | null = null
const listeners = new Set<(s: LeagueTeamsState) => void>()

function publish(next: LeagueTeamsState) {
  current = next
  for (const fn of listeners) fn(next)
}

function load(): Promise<void> {
  if (inflight) return inflight
  publish({ status: 'loading' })
  inflight = (async () => {
    try {
      const leagues = await pluginApi.getLeagues()
      const withTeams = await Promise.all(
        leagues.map(async league => ({ league, teams: await pluginApi.getTeams(league.id) })),
      )
      publish({ status: 'ready', leagues: withTeams })
    } catch (err) {
      publish({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Re-fetch after an error (or to refresh rosters). */
export function reloadLeagueTeams(): Promise<void> {
  if (inflight) return inflight
  return load()
}

export function useLeagueTeams(): LeagueTeamsState {
  const [state, setState] = useState<LeagueTeamsState>(current)

  useEffect(() => {
    listeners.add(setState)
    setState(current)
    if (current.status === 'loading' && !inflight) void load()
    return () => {
      listeners.delete(setState)
    }
  }, [])

  return state
}
