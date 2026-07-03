// Matchup plugin harness (P0).
//
// Loaded into the legacy Backbone PS client (`window.app`) as a deferred
// <script type="module"> from /cannoli-matchup/matchup.js. It polls for the
// client app (mirroring the Showdex injector's hardening), registers a
// `view-matchup` room via `app.addRoom(...)` — no monkey-patching — and
// mounts the React UI into the room's element.
//
// Room class choice: a custom `Room.extend({...})` subclass rather than the
// built-in HTMLRoom. HTMLRoom's join()/leave() send `/join view-matchup` /
// `/leave view-matchup` to the sim server (the room doesn't exist server-side)
// and its initialize() paints a "Page unavailable" body we'd immediately
// overwrite. The subclass no-ops join/leave and owns its DOM from the start;
// `type: 'html'` is kept so the topbar renders the standard page-style tab.
//
// Open/close behavior:
// - Auto-focuses once per browser session (sessionStorage guard) right after
//   registration; later loads just register the tab without stealing focus.
// - Closing the tab runs the client's removeRoom -> room.destroy(). Our
//   destroy override unmounts React and quietly re-registers the room
//   (unfocused) on the next tick, so the Matchup tab survives close and can
//   always be reopened from the topbar.

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MatchupPanel } from './matchup-panel'
import matchupStyles from './styles.css?inline'

const ROOM_ID = 'view-matchup'
const ROOM_TITLE = 'Matchup'
const STYLE_ID = 'cannoli-matchup-styles'
const AUTO_OPEN_KEY = 'cannoli-matchup-auto-opened'
const POLL_INTERVAL_MS = 50
const POLL_MAX_TRIES = 200 // ~10s cap, mirrors the Showdex injector

/** Absolute Cannoli API origin, baked in at build time (consumed from P2 on). */
export const MATCHUP_API_BASE = __MATCHUP_API_BASE__

type MatchupRoom = PSRoom & {
  _isCannoliMatchup?: boolean
  _matchupReactRoot?: Root
}

let matchupRoomClass: PSRoomClass | null = null

function getMatchupRoomClass(): PSRoomClass {
  if (matchupRoomClass) return matchupRoomClass
  const Room = window.Room
  if (!Room) throw new Error('[cannoli-matchup] window.Room missing')
  matchupRoomClass = Room.extend({
    type: 'html', // topbar renders the standard page-style tab for 'html'
    title: ROOM_TITLE,
    isSideRoom: false,
    // Left-room width is capped at maxWidth || bestWidth (default 659);
    // let the analysis panel grow when the viewport allows.
    bestWidth: 659,
    maxWidth: 1180,
    initialize(this: MatchupRoom) {
      this._isCannoliMatchup = true
      this.el.classList.add('cannoli-matchup-room')
      const host = document.createElement('div')
      host.className = 'matchup-host'
      this.el.appendChild(host)
      this._matchupReactRoot = createRoot(host)
      this._matchupReactRoot.render(<MatchupPanel />)
    },
    // Never talk to the sim server — this room only exists client-side.
    join() {},
    leave() {},
    destroy(this: MatchupRoom) {
      this._matchupReactRoot?.unmount()
      this._matchupReactRoot = undefined
      Room.prototype.destroy.call(this, /* alreadyLeft */ true)
      scheduleReRegister()
    },
  })
  return matchupRoomClass
}

let reRegisterPending = false

/** After the client destroys the room (tab closed), re-add it unfocused so
 *  the Matchup tab stays available in the topbar. */
function scheduleReRegister() {
  if (reRegisterPending) return
  reRegisterPending = true
  setTimeout(() => {
    reRegisterPending = false
    const app = window.app
    if (!app || app.rooms[ROOM_ID]) return
    registerRoom(app, false)
  }, 0)
}

function registerRoom(app: PSApp, focus: boolean) {
  const existing = app.rooms[ROOM_ID] as MatchupRoom | undefined
  if (!existing?._isCannoliMatchup) {
    // addRoom replaces a room of a different type in place — e.g. the plain
    // HTMLRoom the URL router auto-creates when loading /view-matchup — and
    // appends ours to roomList (which is what the topbar tab renders from).
    app.addRoom(ROOM_ID, getMatchupRoomClass(), /* nojoin */ true, ROOM_TITLE)
    app.topbar.updateTabbar()
  }
  if (focus) app.focusRoom(ROOM_ID)
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = matchupStyles
  document.head.appendChild(style)
}

/** Auto-open only once per browser session. */
function shouldAutoFocus(): boolean {
  try {
    if (sessionStorage.getItem(AUTO_OPEN_KEY)) return false
    sessionStorage.setItem(AUTO_OPEN_KEY, '1')
    return true
  } catch {
    return false // sessionStorage unavailable — register without focusing
  }
}

function tryBoot(): boolean {
  const app = window.app
  if (!app?.topbar || !window.Room) return false
  injectStyles()
  registerRoom(app, shouldAutoFocus())
  return true
}

;(function start() {
  if (window.__cannoliMatchupLoaded) return // guard against double injection
  window.__cannoliMatchupLoaded = true
  if (tryBoot()) return
  let tries = 0
  const timer = setInterval(() => {
    if (tryBoot() || ++tries >= POLL_MAX_TRIES) clearInterval(timer)
  }, POLL_INTERVAL_MS)
})()
