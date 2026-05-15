import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ─── Users ──────────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['dev', 'admin', 'user'] }).notNull().default('user'),
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
  // ─── Coach Flair (passive identity expressions) ──────────────────────────
  /** FK → pokemon.id. Mini sprite renders next to the coach's name in
   *  CoachLink everywhere (feeds, draft order, trades, standings, etc.). */
  signaturePokemonId: integer('signature_pokemon_id').references(() => pokemon.id),
  /** Short user-set string ≤ 40 chars — e.g. "The Garchomp Curse",
   *  "Late-Round Loyalist". Displayed under display_name on the profile
   *  page and inside the CoachLink hover popover. */
  title: text('title'),
  /** Pokemon type that subtly accents the coach's identity. Renders as a
   *  small TYPE_COLORS-tinted chip near the coach name on profile/team
   *  detail; also feeds the optional `typeAccent` prop on CoachAvatar.
   *  Validated against the canonical 18-type list at the API layer. */
  signatureType: text('signature_type'),
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
  showdownUsername: text('showdown_username'),
  rank: integer('rank'),
  /** Path to uploaded team logo (relative to backend/uploads/) */
  logoPath: text('logo_path'),
  /** Path to uploaded team banner (relative to backend/uploads/) */
  bannerPath: text('banner_path'),
  /** Short team description — ≤ 280 chars enforced at API layer */
  bio: text('bio'),
  /** Short team motto — ≤ 80 chars (e.g. "fortune favors the bold"). */
  motto: text('motto'),
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
});

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
});

// ─── Draft Picks ─────────────────────────────────────────────────────────────

export const draftPicks = sqliteTable('draft_picks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leagueId: text('league_id').notNull().references(() => leagues.id),
  teamId: text('team_id').notNull().references(() => teams.id),
  pickNumber: integer('pick_number').notNull(), // 1-10+
  pokemonName: text('pokemon_name').notNull(),
  tier: integer('tier').notNull(),
});

// ─── Matches ─────────────────────────────────────────────────────────────────

export const matches = sqliteTable('matches', {
  id: text('id').primaryKey(), // 'sapphire-w1m1'
  leagueId: text('league_id').notNull().references(() => leagues.id),
  week: integer('week').notNull(),
  homeTeamId: text('home_team_id').notNull().references(() => teams.id),
  awayTeamId: text('away_team_id').notNull().references(() => teams.id),
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
});

// ─── Bye Weeks (one row per team-week sit-out for odd-team leagues) ─────────

export const byeWeeks = sqliteTable('bye_weeks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leagueId: text('league_id').notNull().references(() => leagues.id),
  week: integer('week').notNull(),
  teamId: text('team_id').notNull().references(() => teams.id),
});

// ─── Match Pokemon (per-match K/D for each Pokemon) ─────────────────────────

export const matchPokemon = sqliteTable('match_pokemon', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  matchId: text('match_id').notNull().references(() => matches.id),
  teamId: text('team_id').notNull().references(() => teams.id),
  pokemonName: text('pokemon_name').notNull(),
  kills: integer('kills').notNull().default(0),
  deaths: integer('deaths').notNull().default(0),
  teraUsed: integer('tera_used', { mode: 'boolean' }).notNull().default(false),
  teraType: text('tera_type'),
});

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
});

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
  announcement: text('announcement'),
  announcementType: text('announcement_type', { enum: ['info', 'warning', 'success'] }).default('info'),
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
  /** Notify when a trade involves this user */
  notifyTrades: integer('notify_trades', { mode: 'boolean' }).notNull().default(true),
  /** Notify when a match is ready / completed */
  notifyMatches: integer('notify_matches', { mode: 'boolean' }).notNull().default(true),
  /** Notify on site announcements */
  notifyAnnouncements: integer('notify_announcements', { mode: 'boolean' }).notNull().default(true),
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
// achievements, S1 alum). NULL participates in the unique check in SQLite, so
// season-less pins can only be awarded once per user.
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
