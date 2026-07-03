// Ambient types for the legacy Pokemon Showdown client globals (Backbone
// `window.app`) — only the minimal surface the Matchup plugin touches.
// These exist solely so the repo-root `bun run build` (tsc -b) type-checks
// the plugin sources; the real objects come from the PS client at runtime.

/** Baked in by frontend/vite.plugin.config.ts from VITE_MATCHUP_API_BASE. */
declare const __MATCHUP_API_BASE__: string

/** Minimal jQuery-wrapped element surface used by PS rooms. */
interface PSJQuery {
  [index: number]: HTMLElement
  addClass(className: string): PSJQuery
  show(): PSJQuery
  hide(): PSJQuery
}

interface PSRoomOptions {
  id: string
  el?: unknown
  nojoin?: boolean
  title?: string
}

/** An instance of the PS client's `Room` Backbone view. */
interface PSRoom {
  id: string
  type: string
  title: string
  el: HTMLElement
  $el: PSJQuery
  isSideRoom?: boolean
  join(): void
  leave(): void
  destroy(alreadyLeft?: boolean): void
  remove(): void
  focus(): void
  blur(): void
}

/** The PS client's `Room` constructor (`window.Room`), Backbone-extendable. */
interface PSRoomClass {
  new (options: PSRoomOptions): PSRoom
  extend(protoProps: Record<string, unknown>): PSRoomClass
  prototype: PSRoom
}

/** The legacy Backbone client app (`window.app`). */
interface PSApp {
  rooms: Record<string, PSRoom | undefined>
  roomList: PSRoom[]
  sideRoomList: PSRoom[]
  curRoom?: PSRoom | null
  topbar: { updateTabbar(): void }
  /** `type` may be a shorthand string ('html' | 'battle' | 'chat') or a Room subclass. */
  addRoom(id: string, type?: string | PSRoomClass | null, nojoin?: boolean, title?: string): void
  focusRoom(id: string, focusTextbox?: boolean): boolean | void
  joinRoom(id: string, type?: string | PSRoomClass | null, nojoin?: boolean): PSRoom
  leaveRoom(id: string): boolean
  removeRoom(id: string, alreadyLeft?: boolean): boolean
}

interface Window {
  app?: PSApp
  Room?: PSRoomClass
  __cannoliMatchupLoaded?: boolean
}
