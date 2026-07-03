// Plugin-local colorblind mode.
//
// The site stores colorblind preference on the user's account (auth-context);
// the plugin has no auth, so it keeps its own persisted toggle in
// localStorage. When on, MatchupRoom adds the `matchup-cb` class to the room
// root (flipping the side-B accent CSS variable red -> orange, mirroring
// MATCHUP_COLORS_CB) and this context lets leaf components pick the
// deuteranopia-safe palettes (getTypeColors(true) / getMatchupColors(true))
// for colors passed as inline styles, where CSS vars don't reach.

import { createContext, useContext } from 'react'

const STORAGE_KEY = 'cannoli-matchup-cb'

/** Provided by MatchupRoom; defaults to off so components render standalone. */
export const CbContext = createContext(false)

/** Whether colorblind mode is on. */
export function useCb(): boolean {
  return useContext(CbContext)
}

export function loadCbPref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function saveCbPref(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage unavailable — toggle still works for the session
  }
}
