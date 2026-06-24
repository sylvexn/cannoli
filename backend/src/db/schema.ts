import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ─── Users ──────────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['dev', 'admin', 'user', 'bot'] }).notNull().default('user'),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(true),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  /** Hex #RRGGBB — accent color used in user avatars, mention pills, etc. */
  primaryColor: text('primary_color'),
  secondaryColor: text('secondary_color'),
  tertiaryColor: text('tertiary_color'),
  /** Optional preferred display name (overrides username in UI) */
  displayName: text('display_name'),
  /** Short profile bio — ≤ 280 chars enforced at API layer */
  bio: text('bio'),
  /** One-liner status, ≤ 80 chars (e.g. "looking for water-types"). */
  statusMessage: text('status_message'),
  /** Path to uploaded profile banner (relative to backend/uploads/). When
   *  null, the profile page falls back to the gemstone gradient generated
   *  from the user's accent colors. */
  bannerUrl: text('banner_url'),
  /** Last time we observed an authenticated request from this user.
   *  Touched by the heartbeat middleware on /api/* hits; powers the
   *  who's-online sidebar widget. */
  lastSeenAt: text('last_seen_at'),
  /** Path to uploaded user avatar (relative to backend/uploads/) */
  avatarPath: text('avatar_path'),
  /** Short user-set string ≤ 40 chars — e.g. "The Garchomp Curse",
   *  "Late-Round Loyalist". Displayed under display_name on the profile
   *  page and inside the CoachLink hover popover. */
  title: text('title'),
  /** User-chosen Showdown username (raw as entered; normalized via toUserid()
   *  before use as a PS identity). When set, this overrides `username` as the
   *  PS userid — so battles and the PS chat show the chosen name (e.g. PPG,
   *  SSS, EGD). NULL falls back to `username`. Max 18 chars after normalization
   *  (PS userid length limit). */
  psUsername: text('ps_username'),
});

// ─── Sessions ───────────────────────────────────────────────────────────────

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // UUID token
  userId: integer('user_id').notNull().references(() => users.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  expiresAt: text('expires_at').notNull(),
});

// ─── Seasons ─────────────────────────────────────────────────────────────────

export const seasons = sqliteTable('seasons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seasonNumber: integer('season_number').notNull(),
  pointCap: integer('point_cap').notNull().default(110),
  teraCaptainSlots: integer('tera_captain_slots').notNull().default(2),
  scheduleType: text('schedule_type', { enum: ['round_robin', 'manual'] }).default('round_robin'),
  /** Marks a season as historical/read-only. Distinct from `phase = offseason`
   *  on the leagues row: offseason just means "no active matches", whereas
   *  archived means "writes targeting this season require explicit ?force=1".
   *  Tier-list edits are also blocked for any league belonging to an
   *  archived season. */
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
});

// ─── Leagues ─────────────────────────────────────────────────────────────────

export const leagues = sqliteTable('leagues', {
  id: text('id').primaryKey(), // 'sapphire', 'ruby', 'emerald'
  name: text('name').notNull(),
  color: text('color').notNull(),
  seasonId: integer('season_id').notNull().references(() => seasons.id),
  /** JSON array of team IDs in draft order */
  draftOrder: text('draft_order'),
  /** ISO datetime for the league's draft date/time */
  draftDate: text('draft_date'),
  /** Bracket size for this league's playoffs (2/4/6/8). */
  playoffTeamCount: integer('playoff_team_count').notNull().default(6),
  /** Lifecycle phase for THIS league (3 leagues per season run independently). */
  phase: text('phase', { enum: ['predraft', 'draft', 'regular', 'playoffs', 'offseason'] }).notNull().default('predraft'),
  /** Current regular-season week for this league (0 outside regular play). */
  currentWeek: integer('current_week').notNull().default(0),
  /** Schedule length for this league. Set when the schedule is generated. */
  totalWeeks: integer('total_weeks').notNull().default(11),
  /** JSON object mapping week number to ISO date string, e.g. {"1":"2026-04-14"} */
  weekDates: text('week_dates'),
  /** Set true once the wizard has auto-filled weeks 2..N from week 1.
   *  Once true (or once the admin manually edits any week), the
   *  one-time auto-fill never runs again — manual edits are sticky. */
  weekDatesAutoFilled: integer('week_dates_auto_filled', { mode: 'boolean' }).notNull().default(false),
  /** When 1, scheduler skips auto-advance + auto-forfeit for THIS league only. */
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
  /** What happens when a match deadline passes without a result. */
  forfeitPolicy: text('forfeit_policy', { enum: ['double_forfeit', 'admin_review'] }).notNull().default('double_forfeit'),
  /** Last week trades may be accepted (0 = no deadline). */
  tradeDeadlineWeek: integer('trade_deadline_week').notNull().default(7),
  /** Number of draft rounds (= per-team roster slots). Per-league config so
   *  three concurrent leagues in a season can run different formats. Default
   *  10 mirrors the historic hardcoded value. Surfaced in the season wizard
   *  and per-league admin UI. */
  rosterSize: integer('roster_size').notNull().default(10),
  /** Optional per-league roster BAND (min/max number of Pokemon a team may
   *  hold post-draft). NULL = unset → fall back to rosterSize, i.e. the roster
   *  must hold exactly rosterSize mons (historic behavior). When set (e.g.
   *  min 10, max 12) free-agency adds/drops and trades must keep each team's
   *  roster within [effMin, effMax] where effMin = minRosterSize ?? rosterSize
   *  and effMax = maxRosterSize ?? rosterSize. Editable in any phase. */
  minRosterSize: integer('min_roster_size'),
  maxRosterSize: integer('max_roster_size'),
  /** Battle format for THIS league. Drives the draft board's moveset display
   *  + matchup-center coverage scan: a gen9-only format hides past-gen-only
   *  moves (Hidden Power, etc), gen9natdex shows the full sheet. See
   *  frontend/src/data/pokemon-learnsets.ts → DraftFormat for the canonical
   *  list. Default 'gen9natdex' preserves pre-#12 behavior. */
  format: text('format').notNull().default('gen9natdex'),
  /** Canonical IANA timezone for THIS league's deadline cutoffs (e.g.
   *  'America/New_York'). The auto-forfeit job computes a match's effective
   *  deadline as end-of-day in this zone. Per-user display labeling is a
   *  frontend concern; the API exposes this field for that purpose. */
  timezone: text('timezone').notNull().default('America/New_York'),
  /** Which COST FORMAT this league prices its pool against — 'natdex' (Emerald:
   *  legendaries/paradoxes/mythicals banned, megas + pseudos +1pt) or 'natdexplus'
   *  (Ruby/Sapphire: fuller pool). Many leagues share one format; the per-format
   *  cost sheet lives in `formatCosts`. Default 'natdexplus' mirrors the historic
   *  single global tier list. See lib/league-costs.ts for resolution. */
  costFormat: text('cost_format').notNull().default('natdexplus'),
  /** Admin-controlled "results reveal gate" for THIS league.
   *  NULL = gate OFF — results fully visible (the only per-user veil is the
   *  separate spoiler-free preference). This is the default for every league,
   *  so nothing changes until an admin opts in.
   *  An integer N = gate ON — completed results for weeks > N are hidden for
   *  EVERYONE, and standings/records are computed only through week N. 0 hides
   *  every week's results. Set via POST /api/admin/leagues/:id/results-reveal. */
  resultsRevealedThrough: integer('results_revealed_through'),
});

// ─── Format Costs (per-cost-format Pokemon prices / bans) ───────────────────
//
// The per-league cost authority. A row overrides the global `pokemon` reference
// table's tier/banned/teraBanned FOR A GIVEN COST FORMAT. Resolution at read
// time (lib/league-costs.ts): formatCosts[(league.costFormat, name)] ?? pokemon.
// Populated from backend/imports/Costs.xlsx by scripts/apply-cost-formats.ts.

export const formatCosts = sqliteTable('format_costs', {
  /** Cost-format id, e.g. 'natdex' | 'natdexplus'. Free-form so new formats need
   *  no schema change. */
  costFormat: text('cost_format').notNull(),
  pokemonName: text('pokemon_name').notNull(),
  /** Draft point cost (1-20). 99 = legacy "not draftable" sentinel (we also set
   *  banned=1, so either signal works). */
  tier: integer('tier').notNull().default(0),
  banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
  teraBanned: integer('tera_banned', { mode: 'boolean' }).notNull().default(false),
}, (t) => ({
  pk: primaryKey({ columns: [t.costFormat, t.pokemonName] }),
}));

// ─── Draft Templates (saved {format, captain count, banlist, tier snapshot}) ─

export const draftTemplates = sqliteTable('draft_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  /** Battle format the template targets — same enum as `leagues.format`. */
  format: text('format').notNull().default('gen9natdex'),
  /** Frozen tier list at save time. JSON: [{ tier: number, names: string[] }, ...].
   *  We snapshot rather than reference so future tier-list edits don't mutate
   *  templates that are still in use. */
  tierListSnapshot: text('tier_list_snapshot').notNull(),
  /** JSON array of pokemon display names that are draft-banned. */
  banlist: text('banlist').notNull().default('[]'),
  /** JSON array of pokemon display names that are tera-captain-banned. */
  teraBanlist: text('tera_banlist').notNull().default('[]'),
  captainCount: integer('captain_count').notNull().default(2),
  pointCap: integer('point_cap').notNull().default(110),
  rosterSize: integer('roster_size').notNull().default(11),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  createdBy: integer('created_by').references(() => users.id),
});

// ─── Teams ───────────────────────────────────────────────────────────────────

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(), // abbreviation: 'sas', 'pow', etc.
  leagueId: text('league_id').notNull().references(() => leagues.id),
  /** FK to users table — null until auth system is built */
  userId: integer('user_id'),
  coachName: text('coach_name').notNull(),
  teamName: text('team_name').notNull(),
  teamAbbrev: text('team_abbrev').notNull(),
  teamColor: text('team_color').notNull().default('#888888'),
  rank: integer('rank'),
  /** Path to uploaded team logo (relative to backend/uploads/) */
  logoPath: text('logo_path'),
  /** Path to uploaded team banner (relative to backend/uploads/) */
  bannerPath: text('banner_path'),
  /** Short team description — ≤ 280 chars enforced at API layer */
  bio: text('bio'),
  /** Owner-authored captain note — ≤ 280 chars. Surfaced on the team
   *  profile under the captain strip; intended for trash talk + flavor. */
  captainNote: text('captain_note'),
  /**
   * Set true once the team owner (or staff) saves their tera captains for
   * this draft cycle. Draft → regular advance is gated on every team in the
   * league having this flag set. Reset to false on draft restart / undo of
   * the last pick (which kicks the league back to phase=draft).
   * `false` for teams in seasons predating this column (default).
   */
  captainsLocked: integer('captains_locked', { mode: 'boolean' }).notNull().default(false),
  /**
   * Final placement for the team's league run. NULL for teams whose league
   * has not yet finished (regular/playoffs in progress). Filled in once the
   * league wraps:
   *   1 = Champion, 2 = Runner-up, 3 = Semifinalist (tied 3rd/4th when no
   *   3rd-place game), 5 = Quarterfinalist (tied 5th-8th), and so on.
   * Profile pages and history widgets read this directly so finishing-badge
   * rendering doesn't have to recompute from the playoff bracket.
   */
  finishPosition: integer('finish_position'),
  /**
   * Human label that pairs with `finishPosition` — e.g. 'Champion',
   * 'Runner-up', 'Semifinalist', 'Quarterfinalist', 'Regular Season'.
   * Stored alongside the numeric position so frontend can render badges
   * without a position→label table.
   */
  finishLabel: text('finish_label'),
}, (t) => ({
  leagueIdx: index('teams_league_idx').on(t.leagueId),
}));

// ─── Pokemon (reference table — full national dex) ──────────────────────────

export const pokemon = sqliteTable('pokemon', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  type1: text('type1').notNull(),
  type2: text('type2'),
  hp: integer('hp').notNull(),
  atk: integer('atk').notNull(),
  def: integer('def').notNull(),
  spa: integer('spa').notNull(),
  spd: integer('spd').notNull(),
  spe: integer('spe').notNull(),
  ability1: text('ability1'),
  ability2: text('ability2'),
  hiddenAbility: text('hidden_ability'),
  tier: integer('tier').notNull().default(0),
  teraBanned: integer('tera_banned', { mode: 'boolean' }).notNull().default(false),
  banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
  /** National Dex number — used to enforce "no two Pokemon with same dex# on same roster" */
  nationalDexNumber: integer('national_dex_number'),
  /** Form classification: 'base', 'mega', 'regional' (alolan/galarian/hisuian/paldean), 'other' */
  formCategory: text('form_category', { enum: ['base', 'mega', 'regional', 'other'] }).notNull().default('base'),
});

// ─── Rosters (team ↔ pokemon for a season) ──────────────────────────────────

export const rosters = sqliteTable('rosters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: text('team_id').notNull().references(() => teams.id),
  pokemonName: text('pokemon_name').notNull(),
  tier: integer('tier').notNull(),
  /**
   * Raw tier-cost snapshot at acquisition time (draft pick / FA pickup / trade).
   * Decouples team-cost aggregation from later admin tier-list edits — once a
   * Pokemon is on a roster, changing pokemon.tier in the tier list does NOT
   * retroactively shift point totals or break point-cap math.
   * Captain markup is NOT included here — apply effectiveCost(costAtDraft, isTeraCaptain)
   * at read time. Preserved across trades.
   */
  costAtDraft: integer('cost_at_draft').notNull().default(0),
  isTeraCaptain: integer('is_tera_captain', { mode: 'boolean' }).notNull().default(false),
  teraType1: text('tera_type1'),
  teraType2: text('tera_type2'),
  teraType3: text('tera_type3'),
  isShiny: integer('is_shiny', { mode: 'boolean' }).notNull().default(false),
  acquiredVia: text('acquired_via', { enum: ['draft', 'trade', 'fa'] }).notNull().default('draft'),
  acquiredWeek: integer('acquired_week'),
  nickname: text('nickname'),
}, (t) => ({
  teamIdx: index('rosters_team_idx').on(t.teamId),
  teamPokemonUnique: uniqueIndex('rosters_team_pokemon_unique').on(t.teamId, t.pokemonName),
}));

// ─── Draft Picks ─────────────────────────────────────────────────────────────

export const draftPicks = sqliteTable('draft_picks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leagueId: text('league_id').notNull().references(() => leagues.id),
  teamId: text('team_id').notNull().references(() => teams.id),
  pickNumber: integer('pick_number').notNull(), // 1-10+
  pokemonName: text('pokemon_name').notNull(),
  tier: integer('tier').notNull(),
}, (t) => ({
  leagueTeamIdx: index('draft_picks_league_team_idx').on(t.leagueId, t.teamId),
  leaguePokemonUnique: uniqueIndex('draft_picks_league_pokemon_unique').on(t.leagueId, t.pokemonName),
  leaguePicknumUnique: uniqueIndex('draft_picks_league_picknum_unique').on(t.leagueId, t.pickNumber),
}));

// ─── Matches ─────────────────────────────────────────────────────────────────

export const matches = sqliteTable('matches', {
  id: text('id').primaryKey(), // 'sapphire-w1m1'
  leagueId: text('league_id').notNull().references(() => leagues.id),
  week: integer('week').notNull(),
  /** Home team. NULL for a not-yet-determined playoff bracket slot (e.g. an SF
   *  whose feeding QF hasn't been played). Rendered as "TBD" at the
   *  presentation layer — never stored as a 'TBD' sentinel (that violated the
   *  FK onto teams.id under PRAGMA foreign_keys=ON). */
  homeTeamId: text('home_team_id').references(() => teams.id),
  /** Away team. NULL = not-yet-determined bracket slot (see homeTeamId). */
  awayTeamId: text('away_team_id').references(() => teams.id),
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  replayUrl: text('replay_url'),
  /** Match lifecycle: scheduled → ready → in_progress → completed (or disputed) */
  status: text('status', { enum: ['scheduled', 'ready', 'in_progress', 'completed', 'disputed'] }).notNull().default('scheduled'),
  /** Whether home team has readied up */
  readyHome: integer('ready_home', { mode: 'boolean' }).notNull().default(false),
  /** Whether away team has readied up */
  readyAway: integer('ready_away', { mode: 'boolean' }).notNull().default(false),
  /** ISO timestamp when match started on PS */
  startedAt: text('started_at'),
  /** ISO timestamp when match completed */
  completedAt: text('completed_at'),
  /** Pokemon Showdown room ID */
  psRoomId: text('ps_room_id'),
  /** Full replay protocol log (JSON) */
  replayLog: text('replay_log'),
  /**
   * Derived cache of the 6 brought (team-preview) species per side as JSON
   * `{home: string[], away: string[]}` in Cannoli naming, recovered from
   * replayLog. Null for legacy/sim rows. Used only to render the full 12-mon
   * replay-card grid (incl. benched mons); never feeds usage/award/stats
   * aggregates — those stay sourced from match_pokemon (appeared-only).
   */
  broughtPreview: text('brought_preview'),
  /** JSON array of warning strings from post-match validation */
  warnings: text('warnings'),
  phase: text('phase', { enum: ['regular', 'playoffs'] }).notNull().default('regular'),
  /** For playoffs: 'qf', 'sf', 'f' */
  playoffRound: text('playoff_round'),
  /** Seed of home team (1st, 2nd, etc.) */
  homeSeed: integer('home_seed'),
  /** Seed of away team */
  awaySeed: integer('away_seed'),
  /** ISO timestamp by which a result must be recorded (auto-forfeit after) */
  deadline: text('deadline'),
  /** Marks a forfeited match: 'home', 'away', or 'both' (double-forfeit) */
  forfeitedBy: text('forfeited_by', { enum: ['home', 'away', 'both'] }),
  /**
   * Explicit winner team id, set from the Showdown `|win|` flag (or the
   * adjudicated forfeit survivor). Decouples W/L from the KO score: a forfeit
   * at full health emits equal KO scores (e.g. 2-2) but a real winner. When
   * present, standings/playoff advancement use this; when null (legacy rows,
   * sim matches), they fall back to score comparison. Null for ties/draws.
   */
  winnerTeamId: text('winner_team_id').references(() => teams.id),
}, (t) => ({
  leagueWeekIdx: index('matches_league_week_idx').on(t.leagueId, t.week),
  statusIdx: index('matches_status_idx').on(t.status),
}));

// ─── Bye Weeks (one row per team-week sit-out for odd-team leagues) ─────────

export const byeWeeks = sqliteTable('bye_weeks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leagueId: text('league_id').notNull().references(() => leagues.id),
  week: integer('week').notNull(),
  teamId: text('team_id').notNull().references(() => teams.id),
}, (t) => ({
  leagueWeekIdx: index('bye_weeks_league_week_idx').on(t.leagueId, t.week),
  teamIdx: index('bye_weeks_team_idx').on(t.teamId),
}));

// ─── Match Pokemon (per-match K/D for each Pokemon) ─────────────────────────

export const matchPokemon = sqliteTable('match_pokemon', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id),
  pokemonName: text('pokemon_name').notNull(),
  kills: integer('kills').notNull().default(0),
  deaths: integer('deaths').notNull().default(0),
  teraUsed: integer('tera_used', { mode: 'boolean' }).notNull().default(false),
  teraType: text('tera_type'),
}, (t) => ({
  matchIdx: index('match_pokemon_match_idx').on(t.matchId),
}));

// ─── Move Categories (admin-configurable, for matchup analysis) ─────────────

export const moveCategories = sqliteTable('move_categories', {
  id: text('id').primaryKey(), // 'hazards', 'healing', etc.
  name: text('name').notNull(),
  /** Display order */
  sortOrder: integer('sort_order').notNull().default(0),
});

export const moveCategoryEntries = sqliteTable('move_category_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  categoryId: text('category_id').notNull().references(() => moveCategories.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // 'Stealth Rock', 'Regenerator'
  moveId: text('move_id').notNull(), // 'stealthrock', 'regenerator' (showdown ID)
  isAbility: integer('is_ability', { mode: 'boolean' }).notNull().default(false),
});

// ─── Transactions (trades + FA pickups + tera changes) ──────────────────────

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leagueId: text('league_id').notNull().references(() => leagues.id),
  week: integer('week').notNull(),
  type: text('type', { enum: ['trade', 'fa', 'tera_change'] }).notNull(),
  teamId: text('team_id').notNull().references(() => teams.id),
  /** For trades: the other team. For FA: null */
  otherTeamId: text('other_team_id').references(() => teams.id),
  /** Pokemon given away (or dropped to FA pool) */
  pokemonOut: text('pokemon_out'),
  pointsOut: integer('points_out'),
  /** Pokemon received (or picked up from FA pool) */
  pokemonIn: text('pokemon_in'),
  pointsIn: integer('points_in'),
  /** For tera changes: the pokemon whose tera types changed */
  teraPokemon: text('tera_pokemon'),
}, (t) => ({
  leagueWeekIdx: index('transactions_league_week_idx').on(t.leagueId, t.week),
}));

// ─── Trades (proposal lifecycle — separate from completed transactions) ─────

export const trades = sqliteTable('trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leagueId: text('league_id').notNull().references(() => leagues.id),
  week: integer('week').notNull(),
  status: text('status', { enum: ['pending', 'awaiting_admin', 'accepted', 'rejected', 'expired'] }).notNull().default('pending'),
  proposerId: text('proposer_id').notNull().references(() => teams.id),
  recipientId: text('recipient_id').notNull().references(() => teams.id),
  /** JSON array of pokemon names */
  offering: text('offering').notNull(),
  /** JSON array of pokemon names */
  requesting: text('requesting').notNull(),
  proposedAt: text('proposed_at').default(sql`(datetime('now'))`),
  resolvedAt: text('resolved_at'),
  resolvedBy: text('resolved_by'),
  rejectReason: text('reject_reason'),
});

// ─── Free-Agency Requests (admin approval queue) ────────────────────────────
// Non-staff FA pickups land here as `pending` instead of mutating rosters
// immediately; an admin approves (applies) or rejects them (feedback #42).
export const faRequests = sqliteTable('fa_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leagueId: text('league_id').notNull().references(() => leagues.id),
  week: integer('week').notNull(),
  teamId: text('team_id').notNull().references(() => teams.id),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  /** Distinguishes an FA pickup request from a tera-captain change request
   *  (feedback #51). Tera requests carry `teraChanges` instead of pickups/drops. */
  requestType: text('request_type', { enum: ['pickup', 'tera_change'] }).notNull().default('pickup'),
  /** JSON array of pokemon names to pick up */
  pickups: text('pickups').notNull(),
  /** JSON array of pokemon names to drop */
  drops: text('drops').notNull(),
  /** JSON of `{ pokemonName, teraTypes }[]` for a tera_change request (null otherwise). */
  teraChanges: text('tera_changes'),
  requestedBy: text('requested_by'),
  requestedAt: text('requested_at').default(sql`(datetime('now'))`),
  resolvedBy: text('resolved_by'),
  resolvedAt: text('resolved_at'),
  rejectReason: text('reject_reason'),
}, (t) => ({
  faRequestsLeagueWeekIdx: index('fa_requests_league_week_idx').on(t.leagueId, t.week),
  faRequestsStatusIdx: index('fa_requests_status_idx').on(t.status),
}));

// ─── Trade Block Listings ───────────────────────────────────────────────────

export const tradeBlockListings = sqliteTable('trade_block_listings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leagueId: text('league_id').notNull().references(() => leagues.id),
  teamId: text('team_id').notNull().references(() => teams.id),
  pokemonName: text('pokemon_name').notNull(),
  note: text('note'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ─── Site Settings (singleton) ──────────────────────────────────────────────

export const siteSettings = sqliteTable('site_settings', {
  id: integer('id').primaryKey().default(1),
  siteName: text('site_name').default('Cannoli'),
  defaultPointCap: integer('default_point_cap').default(110),
  defaultTeraCaptainSlots: integer('default_tera_captain_slots').default(2),
  defaultTradeDeadlineWeek: integer('default_trade_deadline_week').default(7),
  defaultRosterSize: integer('default_roster_size').default(10),
  defaultMaxTeams: integer('default_max_teams').default(12),
  defaultUserPassword: text('default_user_password').default('password'),
  /** Days a pending/awaiting_admin trade lives before auto-expiry */
  tradeExpiryDays: integer('trade_expiry_days').notNull().default(7),
  /** Whether the draft pick timer is enabled */
  draftTimerEnabled: integer('draft_timer_enabled', { mode: 'boolean' }).notNull().default(true),
  /** Whether the demo mode is visible on the draft board */
  draftDemoVisible: integer('draft_demo_visible', { mode: 'boolean' }).notNull().default(true),
  /** Last regular-season week during which free agent pickups are allowed.
   *  Pickups blocked once league.currentWeek > this value during 'regular',
   *  and always blocked during 'playoffs'. */
  faDeadlineWeek: integer('fa_deadline_week').notNull().default(7),
  /** Default playoff bracket size for newly-generated brackets (2/4/6/8). */
  defaultPlayoffTeamCount: integer('default_playoff_team_count').notNull().default(6),
  /** Max free-agent pickups a team may make in one season (each pokemon picked
   *  up costs 1 slot; drops are free). Enforced per-team against the fa
   *  transactions table. Default 6. */
  faPickupsPerSeason: integer('fa_pickups_per_season').notNull().default(6),
  /** DEPRECATED — superseded by the per-league `league_rules` table.
   *  Kept only so the column isn't dropped from existing DBs. */
  rulesText: text('rules_text'),
});

// ─── Per-League Rules ───────────────────────────────────────────────────────

/** Admin-authored, structured rules document for a single league. One row per
 *  league; absence means "use the cost-format default" (see lib/rules-defaults).
 *  `content` is a JSON-serialized RulesContent. */
export const leagueRules = sqliteTable('league_rules', {
  leagueId: text('league_id').primaryKey().references(() => leagues.id),
  content: text('content').notNull(),
  updatedAt: text('updated_at'),
  updatedBy: text('updated_by'),
});

// ─── Draft State (tracks active/completed drafts per league) ────────────────

export const draftState = sqliteTable('draft_state', {
  leagueId: text('league_id').primaryKey().references(() => leagues.id),
  status: text('status', { enum: ['not_started', 'in_progress', 'paused', 'completed'] }).notNull().default('not_started'),
  /** Index into the snake-order pick sequence (0-based) */
  currentPickIndex: integer('current_pick_index').notNull().default(0),
  /** Seconds per pick */
  timerDuration: integer('timer_duration').notNull().default(120),
  /** ISO timestamp when current pick timer started (null if paused/not started) */
  timerStartedAt: text('timer_started_at'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  /** Team ID whose timer expired (pause-at-1s behavior) — null when no expiry pending */
  timerExpiredForTeam: text('timer_expired_for_team'),
});

// ─── Draft Queue (per-team auto-pick preference list) ────────────────────────
// A coach can pre-set an ordered list of Pokemon. When their pick timer expires
// and an auto-pick fires, the engine walks this queue top-down and picks the
// first still-eligible/affordable entry, falling back to highest-affordable
// when the queue is empty or every entry is invalid. One row per queued mon;
// `position` is the 0-based order. Replaced wholesale when a coach re-sets it.
export const draftQueue = sqliteTable('draft_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leagueId: text('league_id').notNull().references(() => leagues.id),
  teamId: text('team_id').notNull().references(() => teams.id),
  position: integer('position').notNull(),
  pokemonName: text('pokemon_name').notNull(),
});

// ─── Activity Log ───────────────────────────────────────────────────────────

export const activityLog = sqliteTable('activity_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  category: text('category', { enum: ['admin', 'auth', 'config', 'draft', 'trade', 'fa', 'match', 'team', 'scrim'] }).notNull(),
  actor: text('actor').notNull(),
  // Nullable on purpose: cross-league events (auth, profile updates, season-wide
  // admin actions) have no single league context.
  leagueId: text('league_id'),
  description: text('description').notNull(),
  /** JSON blob for event-specific data */
  metadata: text('metadata'),
  timestamp: text('timestamp').default(sql`(datetime('now'))`),
});

// ─── Match Ready Log (audit trail for ready-up events) ─────────────────

export const matchReadyLog = sqliteTable('match_ready_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  matchId: text('match_id').notNull().references(() => matches.id),
  teamId: text('team_id').notNull().references(() => teams.id),
  event: text('event', { enum: ['ready', 'unready', 'timeout', 'disconnect'] }).notNull(),
  timestamp: text('timestamp').default(sql`(datetime('now'))`),
});

// ─── Scrims (unofficial practice matches — tracked but not in standings) ───

export const scrims = sqliteTable('scrims', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Optional league context (null for cross-league scrims) */
  leagueId: text('league_id'),
  homeTeamId: text('home_team_id').notNull().references(() => teams.id),
  awayTeamId: text('away_team_id').notNull().references(() => teams.id),
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  replayUrl: text('replay_url'),
  psRoomId: text('ps_room_id'),
  playedAt: text('played_at').default(sql`(datetime('now'))`),
});

// ─── Feedback Submissions (tracks who submitted which GitHub issues) ───────
// DEPRECATED: superseded by the `feedback` table (full in-app storage) + the
// `notifications` system. Still read by the legacy GitHub-close polling path
// until that is retired; new submissions no longer write here. Do not drop yet.

export const feedbackSubmissions = sqliteTable('feedback_submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  issueNumber: integer('issue_number').notNull(),
  issueUrl: text('issue_url').notNull(),
  title: text('title').notNull(),
  /** ISO timestamp when user acknowledged the resolution notification */
  acknowledgedAt: text('acknowledged_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ─── User Preferences (one row per user, lazy-upserted) ───────────────────

export const userPreferences = sqliteTable('user_preferences', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  /** UI theme — 'dark' | 'light' (light deferred, default dark) */
  theme: text('theme', { enum: ['dark', 'light'] }).notNull().default('dark'),
  /** UI density */
  density: text('density', { enum: ['compact', 'comfortable'] }).notNull().default('comfortable'),
  /** Where to land when navigating to '/' */
  defaultLandingPath: text('default_landing_path').notNull().default('/'),
  /** IANA timezone string (e.g. 'America/New_York'). Null = use browser-detected zone. */
  timezone: text('timezone'),
  /** Deuteranopia-safe palette swap — retargets red/green tokens to orange/blue. */
  colorblindMode: integer('colorblind_mode', { mode: 'boolean' }).notNull().default(false),
  /** Spoiler-free mode — when true, the frontend blurs match results (scores,
   *  winners, result badges) on standings/replays behind a click-to-reveal veil.
   *  Defaults ON: results are hidden until the viewer reveals them per week. */
  spoilerFreeMode: integer('spoiler_free_mode', { mode: 'boolean' }).notNull().default(true),
  /** Per-week spoiler reveals — JSON map `{ [leagueId]: highestRevealedWeek }`.
   *  Revealing week N reveals weeks 1..N (catch-up), so a result for week W is
   *  veiled until W <= revealedThrough[leagueId]. */
  spoilerRevealedThrough: text('spoiler_revealed_through').notNull().default('{}'),
  /** Per-match spoiler reveals — JSON array of match IDs the user has revealed
   *  individually on schedule/replays. Persists a revealed match across reloads,
   *  independent of the per-week `spoilerRevealedThrough` high-water mark.
   *  NULL/absent = none revealed. */
  spoilerRevealedMatches: text('spoiler_revealed_matches'),
  /** ISO timestamp the user last opened the "What's New" changelog panel.
   *  Entries dated after this are "unread" and pulse the sidebar bell. Null =
   *  never opened (everything unread). */
  changelogSeenAt: text('changelog_seen_at'),
  /** ISO timestamp the user last opened the notifications pane. Announcements
   *  created after this are "unread" — mirrors changelogSeenAt for the broadcast
   *  announcements feed (see notifications table + announcements table). */
  announcementsSeenAt: text('announcements_seen_at'),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Player Availability ───────────────────────────────────────────────────

export const playerAvailability = sqliteTable('player_availability', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: text('team_id').notNull().references(() => teams.id),
  leagueId: text('league_id').notNull().references(() => leagues.id),
  week: integer('week').notNull(),
  /** ISO date string (YYYY-MM-DD) */
  day: text('day').notNull(),
  status: text('status', { enum: ['available', 'unavailable', 'maybe'] }).notNull().default('available'),
  note: text('note'),
});

// ─── Pin Definitions (catalog of awardable pins/achievements) ─────────────
//
// Two creation paths:
//   * `is_auto = true`  — seeded; awarded by the auto-award job at season-end
//                          or post-match. The slug `id` is the stable key the
//                          award job looks up.
//   * `is_auto = false` — admin-minted via the admin-pins UI; awarded by hand.
//
// Adding new auto pins is a code change (the rule has to live somewhere); new
// custom pins are pure data and need no deploy.

export const pinDefinitions = sqliteTable('pin_definitions', {
  /** Slug-style key, e.g. 'champion', 'mvp', 'kingslayer'. Stable across renames. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /** `lucide-react` icon name as a string, e.g. 'Crown', 'Star', 'Flame'. */
  iconName: text('icon_name').notNull().default('Award'),
  /** Hex #RRGGBB used for ring/icon tint. */
  color: text('color').notNull().default('#fbbf24'),
  category: text('category', {
    enum: ['career', 'season', 'week', 'draft', 'community', 'custom'],
  }).notNull().default('custom'),
  /** True for seeded pins handed out by the auto-award job. */
  isAuto: integer('is_auto', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ─── Pins (awarded instances — many users × many definitions) ──────────────
//
// Unique composite (user_id, pin_def_id, season_id) enforces "one Champion per
// season per user", while still letting a user collect distinct seasons of the
// same pin. season_id may be NULL for season-agnostic pins (e.g. lifetime
// achievements, S1 alum).
//
// IMPORTANT: SQLite treats every NULL as DISTINCT in a UNIQUE index, so the
// composite index does NOT dedupe lifetime (season_id = NULL) pins on its own.
// A separate PARTIAL unique index `pins_user_def_lifetime_idx` on
// (user_id, pin_def_id) WHERE season_id IS NULL enforces "one lifetime pin per
// user per definition" (migration 0041). Both indexes together give correct
// INSERT OR IGNORE idempotency for season-scoped AND lifetime pins.
//
// `awarded_by` is NULL for the auto-award job; otherwise the admin's user id.
// `metadata` is free-form JSON (e.g. `{ pokemon: 'Cinderace' }` for a pin like
// "Steal of the Draft") — admin authoring may attach context per-award.

export const pins = sqliteTable('pins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  pinDefId: text('pin_def_id').notNull().references(() => pinDefinitions.id, { onDelete: 'cascade' }),
  /** Season scope. NULL = lifetime / not season-specific. */
  seasonId: integer('season_id').references(() => seasons.id),
  awardedAt: text('awarded_at').default(sql`(datetime('now'))`),
  /** Admin user id if hand-awarded; NULL if auto-awarded. */
  awardedBy: integer('awarded_by').references(() => users.id),
  /** JSON blob — e.g. `{ pokemon: 'Cinderace', context: 'steal' }` */
  metadata: text('metadata'),
});

// ─── Request Logs (API observability — every /api/* call + its outcome) ──
//
// Lightweight per-request audit written by the logging middleware in
// src/index.ts (onAfterResponse / onError). Powers the admin "API Logs" tab:
// see what's being hit, response codes, latency, and stack traces for 5xx.
// Pruned opportunistically on insert (keep ~last N rows) so the table never
// grows unbounded. NOT the same as activity_log — that records business
// events ("trade approved"); this records raw HTTP traffic.

export const requestLogs = sqliteTable('request_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Origin of the row: 'server' (HTTP middleware) or 'client' (browser error
   *  posted to /api/client-errors). Lets the dev tab separate real traffic from
   *  frontend faults. */
  source: text('source', { enum: ['server', 'client'] }).notNull().default('server'),
  method: text('method').notNull(),
  path: text('path').notNull(),
  status: integer('status').notNull(),
  /** Wall-clock handler time in milliseconds. */
  durationMs: integer('duration_ms').notNull().default(0),
  /** Short correlation id surfaced to the user (error boundary "ref") and
   *  embedded in their feedback issue, so a report ties back to this row.
   *  Set for server 5xx and every client-error row. */
  errorId: text('error_id'),
  /** Resolved from the session cookie, when present. */
  userId: integer('user_id'),
  username: text('username'),
  /** Best-effort client IP (X-Forwarded-For first hop, else socket). */
  ip: text('ip'),
  /** Error class name (e.g. "ValidationError") — null on success. */
  errorName: text('error_name'),
  /** Error message — null on success. */
  errorMessage: text('error_message'),
  /** Stack trace for 5xx, truncated. Null otherwise. */
  errorStack: text('error_stack'),
  /** Stable hash grouping identical faults into an error_groups row. Set for
   *  rows that carry an error (server 5xx + every client row); null otherwise. */
  fingerprint: text('fingerprint'),
  /** Per-request correlation id (also echoed in the x-request-id response
   *  header) so a server log row ties to the response the client saw. */
  requestId: text('request_id'),
  /** Redacted request context captured on 5xx (JSON: role, redacted body). */
  context: text('context'),
  /** Client breadcrumb trail (JSON array) attached to source='client' rows. */
  breadcrumbs: text('breadcrumbs'),
  timestamp: text('timestamp').default(sql`(datetime('now'))`),
});

// ─── Error groups (observability) ─────────────────────────────────────────────
// One row per distinct fault, keyed by a normalized fingerprint. request_logs
// rows (which prune at ~5000) link back via their `fingerprint` column; this
// table never prunes, so counts/first-seen survive the raw occurrences. Powers
// the dev Observability dashboard triage queue + Discord alert dedupe.

export const errorGroups = sqliteTable('error_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** sha1(kind:name:normMessage:topFrame), 16 hex chars. */
  fingerprint: text('fingerprint').notNull().unique(),
  /** Origin class: server | client | render | window | unhandledrejection | ws | process. */
  kind: text('kind').notNull().default('server'),
  errorName: text('error_name'),
  /** Representative (first-seen) message/path/stack for display. */
  sampleMessage: text('sample_message'),
  samplePath: text('sample_path'),
  sampleStack: text('sample_stack'),
  count: integer('count').notNull().default(0),
  /** Distinct authenticated users hit (maintained via error_group_users). */
  affectedUsers: integer('affected_users').notNull().default(0),
  status: text('status', { enum: ['open', 'resolved', 'muted'] }).notNull().default('open'),
  firstSeen: text('first_seen').default(sql`(datetime('now'))`),
  lastSeen: text('last_seen').default(sql`(datetime('now'))`),
  /** Git SHA when first/last seen — powers "new in this deploy" + regression reopen. */
  firstVersion: text('first_version'),
  lastVersion: text('last_version'),
  resolvedAt: text('resolved_at'),
  /** Version a group was marked resolved at; if last_version moves past this the
   *  group auto-reopens (regression). */
  resolvedVersion: text('resolved_version'),
  /** Last Discord alert timestamp — per-fingerprint debounce/coalesce window. */
  notifiedAt: text('notified_at'),
});

// Distinct-user tracking for error_groups.affectedUsers. INSERT OR IGNORE on
// each occurrence with a userId; the count survives request_logs pruning.
export const errorGroupUsers = sqliteTable('error_group_users', {
  fingerprint: text('fingerprint').notNull(),
  userId: integer('user_id').notNull(),
});

// ─── Health checks (heartbeat self-monitor) ───────────────────────────────────
// Latest status per probe (DB / PS bot / WS / ...). One row per probe name,
// upserted by the in-process heartbeat; flips ok→down fire a Discord alert.

export const healthChecks = sqliteTable('health_checks', {
  name: text('name').primaryKey(),
  status: text('status', { enum: ['ok', 'degraded', 'down'] }).notNull(),
  detail: text('detail'),
  latencyMs: integer('latency_ms'),
  checkedAt: text('checked_at'),
  lastOkAt: text('last_ok_at'),
});

// ─── Scrim Pokemon (per-scrim K/D — mirrors matchPokemon but for scrims) ──

export const scrimPokemon = sqliteTable('scrim_pokemon', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scrimId: integer('scrim_id').notNull().references(() => scrims.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id),
  pokemonName: text('pokemon_name').notNull(),
  kills: integer('kills').notNull().default(0),
  deaths: integer('deaths').notNull().default(0),
  teraUsed: integer('tera_used', { mode: 'boolean' }).notNull().default(false),
  teraType: text('tera_type'),
});

// ─── Feedback (every submission across all 4 categories) ───────────────────
// Replaces the GitHub-only feedback flow. EVERY submission lands here; bug and
// feature additionally mirror to a GitHub issue (github_issue_* set). league
// and general are in-app only. Admin triage reads from this table; the resolve
// action emits a notification to the reporter (see notifications + notify.ts).

export const feedback = sqliteTable('feedback', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  category: text('category', { enum: ['bug', 'feature', 'league', 'general'] }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  /** Pathname the dialog was opened from (e.g. '/draft/sapphire'). */
  page: text('page'),
  /** Correlation ref from a captured crash; ties back to request_logs error id. */
  errorRef: text('error_ref'),
  /** Relative uploads key (e.g. 'feedback-screenshots/<uuid>.png') OR absolute R2 URL. Null = none. */
  screenshotPath: text('screenshot_path'),
  /** Set only for bug/feature when GitHub is configured and issue creation succeeds. */
  githubIssueNumber: integer('github_issue_number'),
  githubIssueUrl: text('github_issue_url'),
  status: text('status', { enum: ['open', 'resolved'] }).notNull().default('open'),
  /** Admin's optional reply, surfaced to the reporter via notification. */
  adminResponse: text('admin_response'),
  resolvedByUserId: integer('resolved_by_user_id').references(() => users.id),
  resolvedAt: text('resolved_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (t) => ({
  statusIdx: index('feedback_status_idx').on(t.status),
  categoryIdx: index('feedback_category_idx').on(t.category),
  userIdx: index('feedback_user_idx').on(t.userId),
}));

// ─── Notifications (DIRECTED — one row per recipient) ──────────────────────
// Persisted per-user events with independent read state. `type` is open-ended
// so future directed events reuse this table. `dedupeKey` + UNIQUE(user_id,
// dedupe_key) makes inserts idempotent: re-running the issue-close detector or
// the backfill never double-notifies. Nullable dedupeKey = always-distinct
// NULLs in SQLite, so free-form notifications are never blocked.

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['feedback', 'system'] }).notNull(),
  title: text('title').notNull(),
  body: text('body'),
  /** Client route or absolute URL the item links to (e.g. a GitHub issue). */
  link: text('link'),
  /** Free-form JSON for type-specific data (e.g. { issueNumber: 14 }). */
  metadata: text('metadata'),
  /** Idempotency key, e.g. 'feedback:issue:14'. Unique per user. */
  dedupeKey: text('dedupe_key'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  /** ISO timestamp when the user read this item; null = unread. */
  readAt: text('read_at'),
}, (t) => ({
  userIdx: index('notifications_user_idx').on(t.userId),
  dedupeIdx: uniqueIndex('notifications_user_dedupe_idx').on(t.userId, t.dedupeKey),
}));

// ─── Announcements (BROADCAST — one global row, seen via a per-user stamp) ──
// Admin-authored site-wide broadcasts. NOT the same as site_settings.announcement
// (that is the single persistent home-page banner). Unread per user = rows with
// created_at > user_preferences.announcements_seen_at. Future signups see all
// active announcements as unread automatically — no per-user write on publish.

export const announcements = sqliteTable('announcements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  category: text('category', { enum: ['info', 'feature', 'event', 'maintenance'] }).notNull().default('info'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  /** Soft-delete / retract without losing the audit trail. */
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  /** Where this announcement surfaces: bell feed, banner strip, or both. */
  surface: text('surface', { enum: ['bell', 'banner', 'both'] }).notNull().default('bell'),
  /** When set, announcement is scoped to members of this league. Null = all leagues. */
  leagueId: text('league_id').references(() => leagues.id),
  /** When set, restricts to this role. Null = all roles. */
  targetRole: text('target_role', { enum: ['admin', 'user'] }),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (t) => ({
  activeIdx: index('announcements_active_idx').on(t.active),
}));

export const announcementDismissals = sqliteTable('announcement_dismissals', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  announcementId: integer('announcement_id').notNull().references(() => announcements.id, { onDelete: 'cascade' }),
  dismissedAt: text('dismissed_at').default(sql`(datetime('now'))`),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.announcementId] }) }));
