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
  phase: text('phase', { enum: ['draft', 'regular', 'playoffs', 'offseason'] }).notNull(),
  currentWeek: integer('current_week').notNull().default(0),
  totalWeeks: integer('total_weeks').notNull().default(11),
  pointCap: integer('point_cap').notNull().default(110),
  teraCaptainSlots: integer('tera_captain_slots').notNull().default(2),
  tradeDeadlineWeek: integer('trade_deadline_week').notNull().default(7),
  scheduleType: text('schedule_type', { enum: ['round_robin', 'manual'] }).default('round_robin'),
});

// ─── Leagues ─────────────────────────────────────────────────────────────────

export const leagues = sqliteTable('leagues', {
  id: text('id').primaryKey(), // 'sapphire', 'ruby', 'emerald'
  name: text('name').notNull(),
  color: text('color').notNull(),
  seasonId: integer('season_id').notNull().references(() => seasons.id),
  /** JSON array of team IDs in draft order */
  draftOrder: text('draft_order'),
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
});

// ─── Rosters (team ↔ pokemon for a season) ──────────────────────────────────

export const rosters = sqliteTable('rosters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: text('team_id').notNull().references(() => teams.id),
  pokemonName: text('pokemon_name').notNull(),
  tier: integer('tier').notNull(),
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
  phase: text('phase', { enum: ['regular', 'playoffs'] }).notNull().default('regular'),
  /** For playoffs: 'qf', 'sf', 'f' */
  playoffRound: text('playoff_round'),
  /** Seed of home team (1st, 2nd, etc.) */
  homeSeed: integer('home_seed'),
  /** Seed of away team */
  awaySeed: integer('away_seed'),
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
  status: text('status', { enum: ['pending', 'accepted', 'rejected', 'expired'] }).notNull().default('pending'),
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
});

// ─── Activity Log ───────────────────────────────────────────────────────────

export const activityLog = sqliteTable('activity_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  category: text('category', { enum: ['admin', 'auth', 'config', 'draft', 'trade', 'match', 'team'] }).notNull(),
  actor: text('actor').notNull(),
  leagueId: text('league_id'),
  description: text('description').notNull(),
  /** JSON blob for event-specific data */
  metadata: text('metadata'),
  timestamp: text('timestamp').default(sql`(datetime('now'))`),
});
