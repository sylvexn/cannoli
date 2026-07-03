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
// SIDE-ROOM semantics (client.js updateLayout/_addRoom, client-chat.js:1362):
// the room is a side room like a chat room — `isSideRoom: true` puts it in
// `app.sideRoomList` (right-hand tab group, client-topbar.js renderRooms) and
// `app.focusRoom`/`updateLayout` dock it in the RIGHT panel while the left
// main room (teambuilder/lobby) stays visible and focused. Width fields
// mirror ChatRoom: minWidth 320 (right-panel minimum), minMainWidth 580 and
// maxWidth 1024 (only used when it's ever shown as the left room).
//
// Open/close behavior:
// - Auto-docks on the right once per browser session (sessionStorage guard)
//   right after registration, without touching the focused left room; later
//   loads just register the tab undocked.
// - Closing the tab does NOT destroy the room: `requestLeave` returns false
//   (client.js:1960 aborts removal) and instead UNDOCKS — the pane hides, the
//   left room reflows to full width, and the tab stays in the side group with
//   all React state preserved. While undocked the instance's `isSideRoom` is
//   cleared so `app.updateSideRoom()`'s auto-pick scan (client.js:1949) can't
//   resurrect the pane when other rooms are focused; a capture-phase click
//   listener restores it just before the client's own tab-click handler runs,
//   so clicking the tab re-docks it natively.
// - destroy() (only reachable via forced removal, e.g. addRoom type
//   replacement) unmounts React and quietly re-registers undocked on the next
//   tick, so the Matchup tab always survives.
//
// Showdex coexistence: registration is deferred until Showdex (if its
// injector is present) has created its Hellodex room, so Showdex always
// bootstraps against pristine app state — it hooks app internals at load and
// moves its room between app.roomList/sideRoomList with push/pop, which must
// not interleave with our registration. When no Showdex script is detected
// the wait resolves fast; a hard cap keeps a broken Showdex from blocking us.

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MatchupRoom } from './MatchupRoom'
import matchupStyles from './styles.css?inline'
import matchupTabStyles from './styles-tabs.css?inline'

const ROOM_ID = 'view-matchup'
const ROOM_TITLE = 'Matchup'
const STYLE_ID = 'cannoli-matchup-styles'
const AUTO_OPEN_KEY = 'cannoli-matchup-auto-opened'
const POLL_INTERVAL_MS = 50
const POLL_MAX_TRIES = 200 // ~10s cap, mirrors the Showdex injector
const SHOWDEX_TICK_MS = 100
const SHOWDEX_ABSENT_MS = 800 // no /showdex/ script tag by then -> not installed
const SHOWDEX_MAX_WAIT_MS = 10000 // present but never booted -> proceed anyway

// The Cannoli API origin lives in lib/api-plugin.ts (baked default +
// window.CANNOLI_MATCHUP_API_BASE runtime override).

type MatchupPSRoom = PSRoom & {
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
    // Chat-room-parity layout contract (see header comment).
    isSideRoom: true,
    minWidth: 320,
    minMainWidth: 580,
    bestWidth: 659,
    maxWidth: 1024,
    initialize(this: MatchupPSRoom) {
      this._isCannoliMatchup = true
      this.el.classList.add('cannoli-matchup-room')
      const host = document.createElement('div')
      host.className = 'matchup-host'
      this.el.appendChild(host)
      this._matchupReactRoot = createRoot(host)
      this._matchupReactRoot.render(<MatchupRoom />)
    },
    // Never talk to the sim server — this room only exists client-side.
    join() {},
    leave() {},
    // Tab close (X) -> undock instead of removal; returning false makes
    // app.leaveRoom bail before removeRoom/destroy (client.js:1960).
    requestLeave(this: MatchupPSRoom) {
      undockRoom(this)
      return false
    },
    focus(this: MatchupPSRoom) {
      // Fallback re-dock for non-click focus paths (keyboard room cycling):
      // restore side semantics so the next layout pass treats us as a side
      // room again. The capture-phase click listener handles the normal path
      // BEFORE the client lays us out, so this rarely fires.
      if (!this.isSideRoom) this.isSideRoom = true
    },
    destroy(this: MatchupPSRoom) {
      this._matchupReactRoot?.unmount()
      this._matchupReactRoot = undefined
      Room.prototype.destroy.call(this, /* alreadyLeft */ true)
      scheduleReRegister()
    },
  })
  return matchupRoomClass
}

/** Hide the pane and release the right-panel slot, keeping the tab (and the
 *  mounted React tree) alive. Clearing the INSTANCE's isSideRoom hides us
 *  from updateSideRoom()'s auto-pick scan until the user reopens the tab. */
function undockRoom(room: MatchupPSRoom) {
  const app = window.app
  if (!app) return
  room.isSideRoom = false
  if (app.sideRoom === room) app.sideRoom = null
  if (app.curSideRoom === room) app.curSideRoom = null
  room.hide()
  app.updateLayout()
  app.topbar.updateTabbar()
}

/** Capture-phase listener: when the user clicks the Matchup tab (topbar or
 *  the overflow tab list) while the room is undocked, restore isSideRoom
 *  BEFORE the client's own click handler runs app.joinRoom -> focusRoom, so
 *  the room docks back into the right panel instead of taking over the left.
 *  Purely additive — no client function is wrapped or replaced. */
let dockIntentInstalled = false
function installDockIntentListener() {
  if (dockIntentInstalled) return
  dockIntentInstalled = true
  document.addEventListener(
    'click',
    e => {
      const target = e.target as Element | null
      const anchor = target?.closest?.('a[href]')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      if (!href.endsWith(ROOM_ID)) return
      const room = window.app?.rooms[ROOM_ID] as MatchupPSRoom | undefined
      if (room?._isCannoliMatchup && !room.isSideRoom) room.isSideRoom = true
    },
    true,
  )
}

let reRegisterPending = false

/** After a forced destroy (e.g. addRoom type replacement), re-add the room
 *  undocked so the Matchup tab stays available in the topbar. */
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

function registerRoom(app: PSApp, dock: boolean) {
  const existing = app.rooms[ROOM_ID] as MatchupPSRoom | undefined
  if (!existing?._isCannoliMatchup) {
    // addRoom replaces a room of a different type in place — e.g. the plain
    // HTMLRoom the URL router auto-creates when loading /view-matchup — and
    // appends ours to sideRoomList (isSideRoom at construction, client.js
    // _addRoom:1733), which is what the topbar's side tab group renders from.
    app.addRoom(ROOM_ID, getMatchupRoomClass(), /* nojoin */ true, ROOM_TITLE)
  }
  const room = app.rooms[ROOM_ID] as MatchupPSRoom | undefined
  if (!room?._isCannoliMatchup) return
  if (dock) {
    // Claim the RIGHT panel without ever touching the focused left room:
    // updateSideRoom(id) + updateLayout is focusRoom's side-room path
    // (client.js:1750) minus its narrow-viewport fallback that would take
    // over the LEFT panel when both rooms don't fit — on a narrow window
    // this leaves us docked-but-hidden (like a chat autojoin) until the
    // viewport widens or the user clicks the tab.
    room.isSideRoom = true
    app.updateSideRoom(ROOM_ID)
    app.updateLayout()
  } else if (app.sideRoom === room || app.curSideRoom === room) {
    // addRoom's updateSideRoom() auto-picked us for the empty right slot —
    // undo it: tab-only registration must not surface the pane.
    undockRoom(room)
  }
  app.topbar.updateTabbar()
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `${matchupStyles}\n${matchupTabStyles}`
  document.head.appendChild(style)
}

/** Auto-dock only once per browser session. */
function shouldAutoDock(): boolean {
  try {
    if (sessionStorage.getItem(AUTO_OPEN_KEY)) return false
    sessionStorage.setItem(AUTO_OPEN_KEY, '1')
    return true
  } catch {
    return false // sessionStorage unavailable — register without docking
  }
}

/** Resolve once Showdex (if installed alongside) has finished bootstrapping,
 *  detected by its Hellodex room appearing. Resolves fast when no /showdex/
 *  script tag exists, and unconditionally after SHOWDEX_MAX_WAIT_MS. */
function waitForShowdex(app: PSApp): Promise<void> {
  if (app.rooms['view-hellodex']) return Promise.resolve()
  return new Promise(resolve => {
    const started = Date.now()
    const timer = setInterval(() => {
      const elapsed = Date.now() - started
      const booted = !!window.app?.rooms['view-hellodex']
      const scriptPresent = !!document.querySelector('script[src*="/showdex/"]')
      if (booted || elapsed >= SHOWDEX_MAX_WAIT_MS || (!scriptPresent && elapsed >= SHOWDEX_ABSENT_MS)) {
        clearInterval(timer)
        resolve()
      }
    }, SHOWDEX_TICK_MS)
  })
}

function tryBoot(): boolean {
  const app = window.app
  if (!app?.topbar || !window.Room) return false
  injectStyles()
  installDockIntentListener()
  void waitForShowdex(app).then(() => {
    const liveApp = window.app
    if (!liveApp) return
    registerRoom(liveApp, shouldAutoDock())
  })
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
