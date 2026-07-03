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
  hide(): void
}

/** The PS client's `Room` constructor (`window.Room`), Backbone-extendable. */
interface PSRoomClass {
  new (options: PSRoomOptions): PSRoom
  extend(protoProps: Record<string, unknown>): PSRoomClass
  prototype: PSRoom
}

/**
 * One teambuilder set (`Storage.unpackTeam` output / `curSetList` entry,
 * js/storage.js:1000). Only the fields the bridge reads; a brand-new
 * in-progress slot can be `{}` with no species yet.
 */
interface PSPokemonSet {
  /** Nickname slot — falls back to the species name when unset. */
  name?: string
  species?: string
  item?: string
  ability?: string
  moves?: string[]
  level?: number
  teraType?: string
}

/** A saved team row in `Storage.teams` (js/storage.js importTeam/packTeam). */
interface PSTeam {
  name: string
  format: string
  /** Packed team string (or a set list before re-packing). */
  team: string | PSPokemonSet[]
  capacity: number
  folder: string
  iconCache?: string
  gen?: number
}

/** The teambuilder room (`app.rooms['teambuilder']`, js/client-teambuilder.js).
 *  `curSetList` is the LIVE set list while a team is open for editing;
 *  `curTeam` the team being edited (null on the team-list view). */
interface PSTeambuilderRoom extends PSRoom {
  curSetList?: PSPokemonSet[] | null
  curTeam?: PSTeam | null
  edit?(i: number): void
}

/** `app.user` — Backbone model; fires 'saveteams' on team save/delete/back. */
interface PSUser {
  get(key: string): unknown
  on(event: string, cb: (...args: unknown[]) => void, context?: unknown): void
  off(event: string, cb?: (...args: unknown[]) => void, context?: unknown): void
  trigger(event: string, ...args: unknown[]): void
}

/** The legacy Backbone client app (`window.app`). */
interface PSApp {
  rooms: Record<string, PSRoom | undefined>
  roomList: PSRoom[]
  sideRoomList: PSRoom[]
  curRoom?: PSRoom | null
  /** Intended right-panel room (client.js:1629). */
  sideRoom?: PSRoom | null
  /** Right-panel room currently shown, null when it doesn't fit. */
  curSideRoom?: PSRoom | null
  user?: PSUser
  topbar: { updateTabbar(): void }
  /** Two-panel layout pass (client.js:1821). */
  updateLayout(): void
  /** Pick the intended right-panel room (client.js:1940). */
  updateSideRoom(id?: string): void
  /** `type` may be a shorthand string ('html' | 'battle' | 'chat') or a Room subclass. */
  addRoom(id: string, type?: string | PSRoomClass | null, nojoin?: boolean, title?: string): void
  focusRoom(id: string, focusTextbox?: boolean): boolean | void
  joinRoom(id: string, type?: string | PSRoomClass | null, nojoin?: boolean): PSRoom
  leaveRoom(id: string): boolean
  removeRoom(id: string, alreadyLeft?: boolean): boolean
}

/** The PS client's global `Storage` (js/storage.js) — bridge surface only.
 *  NOTE: the client SHADOWS the DOM `Storage` constructor with this plain
 *  object. Not declared on `Window` (it would conflict with lib.dom's
 *  `Storage` typing) — ps-bridge.ts reads it through a cast helper. */
interface PSStorage {
  /** Mirrors `curSetList` while a team is open in the teambuilder. */
  activeSetList?: PSPokemonSet[] | null
  teams?: PSTeam[]
  saveTeams(): void
  packTeam(team: PSPokemonSet[]): string
  unpackTeam(buf: string): PSPokemonSet[]
  importTeam(buffer: string, teams?: boolean): PSPokemonSet[]
}

interface Window {
  app?: PSApp
  Room?: PSRoomClass
  __cannoliMatchupLoaded?: boolean
  /** Optional runtime override for the Cannoli API origin. Must be set by a
   *  page-level script BEFORE the plugin module executes — the module reads
   *  it once at load (the vite.plugin.config.ts define splices this global
   *  into the api client's baked base URL). */
  CANNOLI_MATCHUP_API_BASE?: string
}
