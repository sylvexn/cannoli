/**
 * Seed the Cannoli database.
 *
 * Usage: bun run scripts/seed.ts
 *
 * Reads CANNOLI_MODE env var:
 *   - 'mock' (default): Full primary-season data + mock users, trades, activity log, trade block
 *   - 'live': primary + S9 historical data, minimal accounts (syl + root only)
 *
 * Reads CANNOLI_SEED_SEASON env var to pick which season config drives the primary import:
 *   - '10' (default): use S10_CONFIG — current shipped season with full data
 *   - '11': use S11_CONFIG — drop the 3 S11 XLSX files in backend/imports/ first
 *
 * The default points at whichever season currently has imports/ files committed; bump it
 * when S11 becomes the active season.
 */

import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { hashSync } from 'bcryptjs';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '../src/db/schema';
import {
  importSeason,
  rewindToFinalsPending,
  assignFinishPositions,
  fabricatePlayoffBracket,
  S9_CONFIG,
  S10_CONFIG,
  S11_CONFIG,
  IMPORTS_DIR,
} from './import-xlsx';
import { S9_AWARDS, S10_AWARDS, mintManualPins } from '../src/lib/pins/awards-data';
import { populateFormatCosts, refreshBaseline, assignLeagueCostFormats } from './apply-cost-formats';

const DB_PATH = resolve(import.meta.dir, '../data/cannoli.db');
const DRIZZLE_DIR = resolve(import.meta.dir, '../drizzle');
const MODE = process.env.CANNOLI_MODE || 'mock';
const SEASON = process.env.CANNOLI_SEED_SEASON || '10';

const SEASON_CONFIGS = { '10': S10_CONFIG, '11': S11_CONFIG } as const;
const PRIMARY_CONFIG = SEASON_CONFIGS[SEASON as keyof typeof SEASON_CONFIGS];
if (!PRIMARY_CONFIG) {
  console.error(`Unknown CANNOLI_SEED_SEASON='${SEASON}'. Valid values: ${Object.keys(SEASON_CONFIGS).join(', ')}`);
  process.exit(1);
}

// Verify expected XLSX files exist before touching the DB
const missingFiles = PRIMARY_CONFIG.files
  .map((f) => f.file)
  .filter((f) => !existsSync(resolve(IMPORTS_DIR, f)));
if (missingFiles.length > 0) {
  console.error(`\nCannot seed Season ${PRIMARY_CONFIG.seasonNumber}: missing XLSX file(s) in ${IMPORTS_DIR}`);
  for (const f of missingFiles) console.error(`  - ${f}`);
  console.error(`\nDrop the file(s) into backend/imports/ and re-run.`);
  process.exit(1);
}

console.log(`Seeding database in ${MODE} mode (Season ${PRIMARY_CONFIG.seasonNumber})...`);
console.log(`Database: ${DB_PATH}`);

// Init DB

const sqlite = new Database(DB_PATH, { create: true });
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Run migrations

console.log('Running migrations...');
migrate(db, { migrationsFolder: DRIZZLE_DIR });
console.log('Migrations complete.');

// Seed system accounts

function seedSystemAccounts() {
  console.log('\nSeeding system accounts...');

  const existing = sqlite.prepare('SELECT COUNT(*) as c FROM users WHERE username IN (?, ?)').get('syl', 'root') as any;
  if (existing.c > 0) {
    console.log('  System accounts already exist, skipping.');
    return;
  }

  // Dev account (syl)
  db.insert(schema.users).values({
    username: 'syl',
    passwordHash: hashSync('admin', 10),
    role: 'dev',
    mustChangePassword: false,
    active: true,
  }).run();

  // Root system/bot account — also the standing automation/service account for
  // backend API scripting. Password 'admin', no forced change so it stays
  // permanent and headless-usable. (The PS bot logs into Showdown with its own
  // CannoliBot/cannolibot env creds — unrelated to this password.)
  db.insert(schema.users).values({
    username: 'root',
    passwordHash: hashSync('admin', 10),
    role: 'bot',
    mustChangePassword: false,
    active: true,
  }).run();

  console.log('  Created: syl (dev), root (bot)');
}

// Seed site settings

function seedSiteSettings() {
  const existing = sqlite.prepare('SELECT COUNT(*) as c FROM site_settings').get() as any;
  if (existing.c > 0) {
    console.log('Site settings already exist, skipping.');
    return;
  }

  db.insert(schema.siteSettings).values({ id: 1, siteName: 'Cannoli' }).run();
  console.log('Site settings seeded.');
}

// Seed pin definitions
//
// Net-new auto-pin defs added when the archive feature shipped. The earlier
// award set (garchomp/cannoli/cynthia/kingslayer/flawless + manual pins) lives
// in migration 0022_real_awards.sql; that's where the canonical defs come
// from. These four close the gaps: Champion (was DELETEd in 0022, restored
// here for finals-winner recognition), High Score (single-game kill record),
// Steal of the Draft (auto-derived best K/point value, distinct from the
// manual `best-draft`), and Sweeper (most 6-0 sweeps, distinct from the
// per-match `flawless`). Mint logic lives in lib/pins/archive-mint.ts.

const ARCHIVE_PIN_DEFINITIONS = [
  {
    id: 'champion',
    name: 'Champion',
    description: 'Won the league finals',
    iconName: 'Crown',
    color: '#fbbf24',
  },
  {
    id: 'high-score',
    name: 'High Score',
    description: 'Most kills by a single Pokemon in a single match',
    iconName: 'Flame',
    color: '#ef4444',
  },
  {
    id: 'steal-of-the-draft',
    name: 'Steal of the Draft',
    description: 'Best kills-per-point value on a drafted Pokemon',
    iconName: 'TrendingUp',
    color: '#10b981',
  },
  {
    id: 'sweeper',
    name: 'Sweeper',
    description: 'Most 6-0 sweeps recorded across the season',
    iconName: 'Swords',
    color: '#a855f7',
  },
] as const;

function seedPinDefinitions() {
  let inserted = 0;
  for (const def of ARCHIVE_PIN_DEFINITIONS) {
    const existing = sqlite.prepare('SELECT id FROM pin_definitions WHERE id = ?').get(def.id) as any;
    if (existing) continue;
    db.insert(schema.pinDefinitions).values({
      ...def,
      category: 'season',
      isAuto: true,
    }).run();
    inserted++;
  }
  if (inserted > 0) console.log(`Pin definitions seeded (+${inserted}).`);
  else console.log('Pin definitions already exist, skipping.');
}

// Seed move categories

function seedMoveCategories() {
  const existing = sqlite.prepare('SELECT COUNT(*) as c FROM move_categories').get() as any;
  if (existing.c > 0) {
    console.log('Move categories already exist, skipping.');
    return;
  }

  const categories = [
    { id: 'hazards', name: 'Hazards', sortOrder: 1, entries: [
      { name: 'Stealth Rock', moveId: 'stealthrock' },
      { name: 'Spikes', moveId: 'spikes' },
      { name: 'Toxic Spikes', moveId: 'toxicspikes' },
      { name: 'Sticky Web', moveId: 'stickyweb' },
      { name: 'Ceaseless Edge', moveId: 'ceaselessedge' },
      { name: 'Stone Axe', moveId: 'stoneaxe' },
    ]},
    { id: 'hazard-removal', name: 'Hazard Removal', sortOrder: 2, entries: [
      { name: 'Rapid Spin', moveId: 'rapidspin' },
      { name: 'Defog', moveId: 'defog' },
      { name: 'Court Change', moveId: 'courtchange' },
      { name: 'Tidy Up', moveId: 'tidyup' },
      { name: 'Mortal Spin', moveId: 'mortalspin' },
      { name: 'Magic Bounce', moveId: 'magicbounce', isAbility: true },
    ]},
    { id: 'healing', name: 'Healing', sortOrder: 3, entries: [
      { name: 'Recover', moveId: 'recover' },
      { name: 'Roost', moveId: 'roost' },
      { name: 'Wish', moveId: 'wish' },
      { name: 'Synthesis', moveId: 'synthesis' },
      { name: 'Moonlight', moveId: 'moonlight' },
      { name: 'Soft-Boiled', moveId: 'softboiled' },
      { name: 'Slack Off', moveId: 'slackoff' },
      { name: 'Shore Up', moveId: 'shoreup' },
      { name: 'Regenerator', moveId: 'regenerator', isAbility: true },
    ]},
    { id: 'cleric', name: 'Cleric', sortOrder: 4, entries: [
      { name: 'Heal Bell', moveId: 'healbell' },
      { name: 'Aromatherapy', moveId: 'aromatherapy' },
      { name: 'Natural Cure', moveId: 'naturalcure', isAbility: true },
    ]},
    { id: 'pivoting', name: 'Pivoting', sortOrder: 5, entries: [
      { name: 'U-turn', moveId: 'uturn' },
      { name: 'Volt Switch', moveId: 'voltswitch' },
      { name: 'Flip Turn', moveId: 'flipturn' },
      { name: 'Parting Shot', moveId: 'partingshot' },
      { name: 'Teleport', moveId: 'teleport' },
      { name: 'Chilly Reception', moveId: 'chillyreception' },
    ]},
    { id: 'speed-control', name: 'Speed Control', sortOrder: 6, entries: [
      { name: 'Thunder Wave', moveId: 'thunderwave' },
      { name: 'Tailwind', moveId: 'tailwind' },
      { name: 'Sticky Web', moveId: 'stickyweb' },
      { name: 'Trick Room', moveId: 'trickroom' },
      { name: 'Icy Wind', moveId: 'icywind' },
      { name: 'Electroweb', moveId: 'electroweb' },
    ]},
    { id: 'status', name: 'Status', sortOrder: 7, entries: [
      { name: 'Will-O-Wisp', moveId: 'willowisp' },
      { name: 'Thunder Wave', moveId: 'thunderwave' },
      { name: 'Toxic', moveId: 'toxic' },
      { name: 'Spore', moveId: 'spore' },
      { name: 'Sleep Powder', moveId: 'sleeppowder' },
      { name: 'Yawn', moveId: 'yawn' },
      { name: 'Glare', moveId: 'glare' },
      { name: 'Nuzzle', moveId: 'nuzzle' },
    ]},
    { id: 'screens', name: 'Screens', sortOrder: 8, entries: [
      { name: 'Reflect', moveId: 'reflect' },
      { name: 'Light Screen', moveId: 'lightscreen' },
      { name: 'Aurora Veil', moveId: 'auroraveil' },
    ]},
    { id: 'setup', name: 'Setup', sortOrder: 9, entries: [
      { name: 'Swords Dance', moveId: 'swordsdance' },
      { name: 'Nasty Plot', moveId: 'nastyplot' },
      { name: 'Dragon Dance', moveId: 'dragondance' },
      { name: 'Calm Mind', moveId: 'calmmind' },
      { name: 'Bulk Up', moveId: 'bulkup' },
      { name: 'Quiver Dance', moveId: 'quiverdance' },
      { name: 'Shell Smash', moveId: 'shellsmash' },
      { name: 'Iron Defense', moveId: 'irondefense' },
      { name: 'Coil', moveId: 'coil' },
    ]},
    { id: 'priority', name: 'Priority', sortOrder: 10, entries: [
      { name: 'Mach Punch', moveId: 'machpunch' },
      { name: 'Bullet Punch', moveId: 'bulletpunch' },
      { name: 'Aqua Jet', moveId: 'aquajet' },
      { name: 'Ice Shard', moveId: 'iceshard' },
      { name: 'Extreme Speed', moveId: 'extremespeed' },
      { name: 'Sucker Punch', moveId: 'suckerpunch' },
      { name: 'Shadow Sneak', moveId: 'shadowsneak' },
      { name: 'Quick Attack', moveId: 'quickattack' },
      { name: 'Grassy Glide', moveId: 'grassyglide' },
    ]},
    { id: 'phazing', name: 'Phazing', sortOrder: 11, entries: [
      { name: 'Roar', moveId: 'roar' },
      { name: 'Whirlwind', moveId: 'whirlwind' },
      { name: 'Dragon Tail', moveId: 'dragontail' },
      { name: 'Circle Throw', moveId: 'circlethrow' },
    ]},
    { id: 'trapping', name: 'Trapping', sortOrder: 12, entries: [
      { name: 'Magma Storm', moveId: 'magmastorm' },
      { name: 'Fire Spin', moveId: 'firespin' },
      { name: 'Infestation', moveId: 'infestation' },
      { name: 'Whirlpool', moveId: 'whirlpool' },
      { name: 'Block', moveId: 'block' },
      { name: 'Mean Look', moveId: 'meanlook' },
      { name: 'Magnet Pull', moveId: 'magnetpull', isAbility: true },
    ]},
    { id: 'weather', name: 'Weather', sortOrder: 13, entries: [
      { name: 'Rain Dance', moveId: 'raindance' },
      { name: 'Sunny Day', moveId: 'sunnyday' },
      { name: 'Sandstorm', moveId: 'sandstorm' },
      { name: 'Snowscape', moveId: 'snowscape' },
      { name: 'Drizzle', moveId: 'drizzle', isAbility: true },
      { name: 'Drought', moveId: 'drought', isAbility: true },
      { name: 'Sand Stream', moveId: 'sandstream', isAbility: true },
      { name: 'Snow Warning', moveId: 'snowwarning', isAbility: true },
    ]},
    { id: 'terrain', name: 'Terrain', sortOrder: 14, entries: [
      { name: 'Electric Terrain', moveId: 'electricterrain' },
      { name: 'Grassy Terrain', moveId: 'grassyterrain' },
      { name: 'Psychic Terrain', moveId: 'psychicterrain' },
      { name: 'Misty Terrain', moveId: 'mistyterrain' },
      { name: 'Electric Surge', moveId: 'electricsurge', isAbility: true },
      { name: 'Grassy Surge', moveId: 'grassysurge', isAbility: true },
      { name: 'Psychic Surge', moveId: 'psychicsurge', isAbility: true },
      { name: 'Misty Surge', moveId: 'mistysurge', isAbility: true },
    ]},
  ];

  console.log('Seeding move categories...');
  for (const cat of categories) {
    db.insert(schema.moveCategories).values({
      id: cat.id,
      name: cat.name,
      sortOrder: cat.sortOrder,
    }).run();

    for (const entry of cat.entries) {
      db.insert(schema.moveCategoryEntries).values({
        categoryId: cat.id,
        name: entry.name,
        moveId: entry.moveId,
        isAbility: (entry as any).isAbility || false,
      }).run();
    }
  }
  console.log(`  ${categories.length} categories, ${categories.reduce((a, c) => a + c.entries.length, 0)} entries`);
}

// Seed mock-only data

function seedMockData(coachTeamIds: Map<string, string>) {
  console.log('\nSeeding mock-only data...');

  // Trade proposals (not completed transactions — those come from XLSX)
  const sapphireTeams = [...coachTeamIds.entries()]
    .filter(([, tid]) => tid.startsWith('sapphire-'))
    .map(([, tid]) => tid);

  // Only seed if trades table is empty
  const tradeCount = (sqlite.prepare('SELECT COUNT(*) as c FROM trades').get() as any).c;
  if (tradeCount === 0 && sapphireTeams.length > 0) {
    // Pending trade
    db.insert(schema.trades).values({
      leagueId: 'sapphire',
      week: 7,
      status: 'pending',
      proposerId: 'sapphire-vvv',
      recipientId: 'sapphire-llb',
      offering: JSON.stringify(['Meowscarada']),
      requesting: JSON.stringify(['Blaziken']),
      proposedAt: '2026-03-08T11:00:00Z',
    }).run();

    // Rejected trade
    db.insert(schema.trades).values({
      leagueId: 'sapphire',
      week: 5,
      status: 'rejected',
      proposerId: 'sapphire-dwg',
      recipientId: 'sapphire-llb',
      offering: JSON.stringify(['Stunfisk']),
      requesting: JSON.stringify(['Zoroark']),
      proposedAt: '2026-02-23T15:00:00Z',
      resolvedAt: '2026-02-24T08:00:00Z',
      resolvedBy: 'syl',
      rejectReason: 'Unbalanced point values',
    }).run();

    // Expired proposals
    db.insert(schema.trades).values({
      leagueId: 'sapphire',
      week: 8,
      status: 'expired',
      proposerId: 'sapphire-ak',
      recipientId: 'sapphire-vvv',
      offering: JSON.stringify(['Pawniard']),
      requesting: JSON.stringify(['Fraxure']),
      proposedAt: '2026-03-16T14:00:00Z',
    }).run();

    db.insert(schema.trades).values({
      leagueId: 'sapphire',
      week: 7,
      status: 'expired',
      proposerId: 'sapphire-mgm',
      recipientId: 'sapphire-ece',
      offering: JSON.stringify(['Cacturne', 'Ferroseed']),
      requesting: JSON.stringify(['Dedenne']),
      proposedAt: '2026-03-09T20:00:00Z',
    }).run();

    console.log('  4 trade proposals seeded');
  }

  // Trade block listings

  const listingCount = (sqlite.prepare('SELECT COUNT(*) as c FROM trade_block_listings').get() as any).c;
  if (listingCount === 0) {
    const listings = [
      { leagueId: 'sapphire', teamId: 'sapphire-dwg', pokemonName: 'Stunfisk', note: 'Looking for a fairy or water type' },
      { leagueId: 'sapphire', teamId: 'sapphire-pow', pokemonName: 'Eevee', note: 'Open to any offers' },
      { leagueId: 'sapphire', teamId: 'sapphire-gg', pokemonName: 'Electrode', note: 'Need ground coverage' },
      { leagueId: 'sapphire', teamId: 'sapphire-hmm', pokemonName: 'Electrode', note: 'Will trade for any fighting type' },
      { leagueId: 'sapphire', teamId: 'sapphire-sas', pokemonName: 'Charizard', note: 'Looking for bulky water' },
      { leagueId: 'sapphire', teamId: 'sapphire-llb', pokemonName: 'Ferroseed' },
      { leagueId: 'sapphire', teamId: 'sapphire-vvv', pokemonName: 'Meowscarada', note: 'Need a spinner or defogger' },
      { leagueId: 'sapphire', teamId: 'sapphire-ak', pokemonName: 'Pawniard', note: 'Open to offers, need speed' },
    ];
    for (const l of listings) {
      db.insert(schema.tradeBlockListings).values(l).run();
    }
    console.log(`  ${listings.length} trade block listings seeded`);
  }

  // Mark scored matches completed
  // Real replay URLs land via importReplays() against the scraped JSON cache
  // at backend/imports/replays/. Just ensure status is set so any UI that
  // filters on `status = 'completed'` picks them up.
  sqlite.prepare(`UPDATE matches SET status = 'completed' WHERE home_score IS NOT NULL`).run();

  // Activity log

  const logCount = (sqlite.prepare('SELECT COUNT(*) as c FROM activity_log').get() as any).c;
  if (logCount === 0) {
    const events: typeof schema.activityLog.$inferInsert[] = [
      { type: 'season_created', category: 'config', actor: 'root', description: 'Created Season 10 for all leagues', metadata: '{}', timestamp: '2025-09-01T00:00:00Z' },
      { type: 'user_role_changed', category: 'admin', actor: 'root', description: 'Promoted to admin', metadata: '{"targetUser":"sylvex","newRole":"admin"}', timestamp: '2025-09-02T10:30:00Z' },
      { type: 'league_config_updated', category: 'config', actor: 'syl', leagueId: 'sapphire', description: 'Updated Sapphire League settings', metadata: '{"changes":"pointCap: 100 → 110"}', timestamp: '2025-09-05T14:00:00Z' },
      { type: 'league_config_updated', category: 'config', actor: 'root', leagueId: 'ruby', description: 'Updated Ruby League settings', metadata: '{"changes":"teraCaptainSlots: 1 → 2"}', timestamp: '2025-09-05T14:30:00Z' },
      { type: 'draft_started', category: 'draft', actor: 'syl', leagueId: 'sapphire', description: 'Started Sapphire League draft', metadata: '{}', timestamp: '2025-09-20T19:00:00Z' },
      { type: 'draft_pick', category: 'draft', actor: 'sparky', leagueId: 'sapphire', description: 'Drafted Garchomp (Tier 16)', metadata: '{"pokemon":"Garchomp","tier":16}', timestamp: '2025-09-20T19:05:00Z' },
      { type: 'draft_pick', category: 'draft', actor: 'blaze', leagueId: 'sapphire', description: 'Drafted Volcarona (Tier 14)', metadata: '{"pokemon":"Volcarona","tier":14}', timestamp: '2025-09-20T19:08:00Z' },
      { type: 'draft_completed', category: 'draft', actor: 'system', leagueId: 'sapphire', description: 'Sapphire League draft completed', metadata: '{"totalPicks":132}', timestamp: '2025-09-20T22:30:00Z' },
      { type: 'phase_advanced', category: 'config', actor: 'syl', leagueId: 'sapphire', description: 'Advanced Sapphire League to regular season', metadata: '{"from":"draft","to":"regular"}', timestamp: '2025-10-01T18:00:00Z' },
      { type: 'tera_captain_set', category: 'team', actor: 'sparky', leagueId: 'sapphire', description: 'Set Garchomp as Tera Captain (Fire/Ground/Dragon)', metadata: '{"pokemon":"Garchomp","teraTypes":["Fire","Ground","Dragon"]}', timestamp: '2025-10-05T12:00:00Z' },
      { type: 'tera_captain_set', category: 'team', actor: 'blaze', leagueId: 'sapphire', description: 'Set Volcarona as Tera Captain (Grass/Water/Ground)', metadata: '{"pokemon":"Volcarona","teraTypes":["Grass","Water","Ground"]}', timestamp: '2025-10-05T13:30:00Z' },
      { type: 'user_created', category: 'admin', actor: 'root', description: 'Created user account', metadata: '{"targetUser":"frosty"}', timestamp: '2026-01-15T09:00:00Z' },
      { type: 'user_deactivated', category: 'admin', actor: 'root', description: 'Deactivated user account', metadata: '{"targetUser":"aqua"}', timestamp: '2026-01-15T12:00:00Z' },
      { type: 'tera_types_changed', category: 'team', actor: 'sparky', leagueId: 'sapphire', description: 'Changed Garchomp tera types to Steel/Fire/Fairy', metadata: '{"pokemon":"Garchomp","from":["Fire","Ground","Dragon"],"to":["Steel","Fire","Fairy"]}', timestamp: '2026-02-10T16:00:00Z' },
      { type: 'trade_proposed', category: 'trade', actor: 'gwg', leagueId: 'sapphire', description: 'Proposed trade: Qwilfish, Ferroseed → Cubchoo', metadata: '{"recipient":"fam"}', timestamp: '2026-02-28T14:30:00Z' },
      { type: 'trade_approved', category: 'trade', actor: 'root', leagueId: 'sapphire', description: 'Approved trade between gwg and fam', metadata: '{"proposer":"gwg","recipient":"fam"}', timestamp: '2026-02-28T16:00:00Z' },
      { type: 'trade_proposed', category: 'trade', actor: 'pow', leagueId: 'sapphire', description: 'Proposed trade: Eevee → Pikachu', metadata: '{"recipient":"sas"}', timestamp: '2026-03-01T10:00:00Z' },
      { type: 'trade_rejected', category: 'trade', actor: 'syl', leagueId: 'sapphire', description: 'Rejected trade between pow and sas', metadata: '{"reason":"Unbalanced point values"}', timestamp: '2026-03-01T11:30:00Z' },
      { type: 'password_reset', category: 'admin', actor: 'root', description: 'Reset password for user', metadata: '{"targetUser":"frosty"}', timestamp: '2026-03-25T08:45:00Z' },
      { type: 'match_reported', category: 'match', actor: 'sparky', leagueId: 'sapphire', description: 'Reported W9 result: Sparky Strikers 4-2 Frost Giants', metadata: '{"week":9}', timestamp: '2026-03-30T20:00:00Z' },
      { type: 'match_reported', category: 'match', actor: 'blaze', leagueId: 'sapphire', description: 'Reported W9 result: Blaze Brigade 3-3 Aqua Force', metadata: '{"week":9}', timestamp: '2026-03-30T21:15:00Z' },
      { type: 'password_changed', category: 'auth', actor: 'frosty', description: 'Changed password', metadata: '{}', timestamp: '2026-03-20T09:05:00Z' },
      { type: 'user_login', category: 'auth', actor: 'syl', description: 'Logged in', metadata: '{}', timestamp: '2026-04-03T08:00:00Z' },
      { type: 'user_login', category: 'auth', actor: 'sparky', description: 'Logged in', metadata: '{}', timestamp: '2026-04-02T17:30:00Z' },
      { type: 'user_login', category: 'auth', actor: 'root', description: 'Logged in', metadata: '{}', timestamp: '2026-04-03T07:45:00Z' },
    ];

    for (const evt of events) {
      db.insert(schema.activityLog).values(evt).run();
    }
    console.log(`  ${events.length} activity log events seeded`);
  }

  // Player availability (WT-B)
  // Seed a logical-but-random availability blob across every team in every
  // active S10 league for the current week ± 2. Weighted toward Available on
  // weekends and Maybe/Busy on weekdays so the schedule aggregate has visible
  // overlap to render. Idempotent: skipped entirely if the table already has
  // rows.
  const availCount = (sqlite.prepare('SELECT COUNT(*) as c FROM player_availability').get() as any).c;
  if (availCount === 0) {
    const teams = sqlite.prepare(
      `SELECT t.id as teamId, t.league_id as leagueId, l.current_week as currentWeek, l.week_dates as weekDates
         FROM teams t
         JOIN leagues l ON l.id = t.league_id
         JOIN seasons s ON s.id = l.season_id
        WHERE s.season_number = 10`,
    ).all() as { teamId: string; leagueId: string; currentWeek: number; weekDates: string | null }[];

    // Deterministic PRNG so the seeded grid is stable across reseeds.
    let prngState = 0xdeadbeef;
    function rand(): number {
      prngState = (prngState * 1664525 + 1013904223) >>> 0;
      return prngState / 0xffffffff;
    }

    function getTuesday(d: Date): Date {
      // Most-recent Tuesday on/before d — the start of the league week, which
      // runs Tuesday→Monday. (Used only when a week has no configured date.)
      const day = d.getDay(); // 0=Sun..6=Sat
      const diff = d.getDate() - ((day - 2 + 7) % 7);
      return new Date(d.setDate(diff));
    }

    const STATUSES: Array<{ status: 'available' | 'maybe' | 'unavailable'; weight: number }> = [
      { status: 'available',   weight: 0.55 },
      { status: 'maybe',       weight: 0.25 },
      { status: 'unavailable', weight: 0.20 },
    ];

    function pickStatus(isWeekend: boolean): 'available' | 'maybe' | 'unavailable' {
      // Bias weekends toward Available, weekdays toward Maybe/Busy.
      const weights = isWeekend
        ? [0.75, 0.18, 0.07]
        : [0.40, 0.30, 0.30];
      const r = rand();
      let acc = 0;
      for (let i = 0; i < STATUSES.length; i++) {
        acc += weights[i]!;
        if (r < acc) return STATUSES[i]!.status;
      }
      return STATUSES[0]!.status;
    }

    const NOTES_BUSY = ['out of town', 'work shift', 'family event', 'travel day', null, null];
    const NOTES_MAYBE = ['after 8pm', 'might be late', 'depends on day-of', null, null, null];

    let inserted = 0;
    const insertStmt = sqlite.prepare(
      `INSERT INTO player_availability (team_id, league_id, week, day, status, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertMany = sqlite.transaction((rows: Array<[string, string, number, string, string, string | null]>) => {
      for (const r of rows) insertStmt.run(...r);
    });

    const rows: Array<[string, string, number, string, string, string | null]> = [];
    for (const team of teams) {
      const weekDatesMap: Record<string, string> = team.weekDates ? JSON.parse(team.weekDates) : {};
      // Cover current week ± 2.
      const weeksToSeed = [team.currentWeek - 2, team.currentWeek - 1, team.currentWeek, team.currentWeek + 1, team.currentWeek + 2]
        .filter(w => w >= 1);

      for (const week of weeksToSeed) {
        const weekDate = weekDatesMap[String(week)];
        const start = weekDate ? new Date(weekDate + 'T00:00:00') : getTuesday(new Date());
        for (let i = 0; i < 7; i++) {
          const d = new Date(start);
          d.setDate(d.getDate() + i);
          const iso = d.toISOString().slice(0, 10);
          // Skip ~10% of cells so the grid has gaps (more realistic — not
          // every coach fills every day).
          if (rand() < 0.1) continue;
          const dow = d.getDay();
          const isWeekend = dow === 0 || dow === 6;
          const status = pickStatus(isWeekend);
          let note: string | null = null;
          if (status === 'unavailable') {
            const pick = NOTES_BUSY[Math.floor(rand() * NOTES_BUSY.length)];
            note = pick ?? null;
          } else if (status === 'maybe') {
            const pick = NOTES_MAYBE[Math.floor(rand() * NOTES_MAYBE.length)];
            note = pick ?? null;
          }
          rows.push([team.teamId, team.leagueId, week, iso, status, note]);
        }
      }
    }
    insertMany(rows);
    inserted = rows.length;
    console.log(`  ${inserted} player_availability rows seeded across ${teams.length} teams`);
  }
}

// Run

// Check if already seeded
const seasonCount = (sqlite.prepare('SELECT COUNT(*) as c FROM seasons').get() as any).c;
if (seasonCount > 0) {
  console.log('\nDatabase already has data. To re-seed, delete the database file first.');
  console.log('  rm backend/data/cannoli.db && bun run scripts/seed.ts');
  sqlite.close();
  process.exit(0);
}

// System accounts first (before import, which references them)
seedSystemAccounts();

// Import primary season data (both modes)
console.log(`\n── Importing Season ${PRIMARY_CONFIG.seasonNumber} ──`);
const { coachTeamIds } = importSeason(sqlite, PRIMARY_CONFIG, {
  createUsers: true,
  clearExisting: false,
});

// S9 historical data — imported in BOTH modes as an archive when the XLSX
// files are present. The season selector / archive view picks it up via the
// seasons.archived flag below. (Previously live-only; mock now ships with a
// fully-played S9 so the history surfaces have something to render.)
//
// S9 uses a different sheet layout from S10, so it routes through importS9
// (which also prefixes its league IDs with `s9-` to avoid colliding with the
// active S10 sapphire/ruby/emerald leagues).
const s9Missing = S9_CONFIG.files
  .map((f) => f.file)
  .filter((f) => !existsSync(resolve(IMPORTS_DIR, f)));
if (s9Missing.length === 0) {
  console.log('\n── Importing Season 9 (archive) ──');
  const { importS9 } = await import('./import-s9');
  importS9(sqlite);

  // Mark S9 as archived. assignFinishPositions runs below so the finals
  // winners are determinable from the matches table.
  sqlite.prepare(
    `UPDATE seasons SET archived = 1 WHERE season_number = 9`,
  ).run();
} else {
  console.log(`\nSkipping S9 historical import: missing ${s9Missing.length} file(s).`);
}

// (importReplays moved below — must run AFTER S10 finalize + S9 bracket
// fabrication so the rewritten finals/SF rows are present in the matches
// table by the time we look them up.)

// S10: finalize the season
// Discord-announced champions are GABE (emerald-abs), TAYLOR (ruby-vgk),
// DYLAN (sapphire-dwg). The seed playoffs from the XLSX import already put
// gabe and dylan in the finals; ruby's bracket has the wrong finalist
// (jack/ruby-egg vs dante/ruby-oni), so we rewrite ruby-sf-5 and the ruby
// finals matchup so VGK reaches the final and beats ONI.
//
// Score: 4-3 in the champion's favor. Phase advances to 'offseason' on each
// league, but seasons.archived stays 0 — S10 is current.
if (PRIMARY_CONFIG.seasonNumber === 10) {
  console.log('\n── Finalizing S10 ──');

  const s10LeagueIds = S10_CONFIG.files.map((f) => f.id);

  // Step 0. Mark every imported match with a score as completed. The XLSX
  // importer leaves status='scheduled' on every row; the auto-award job
  // queries `phase='regular' AND status='completed'`, so without this all
  // S10 auto-awards would mint zero rows. (The pre-existing mock-data step
  // does this same UPDATE later, but we need it now — before pin minting.)
  sqlite.prepare(
    `UPDATE matches SET status = 'completed'
      WHERE home_score IS NOT NULL AND status != 'completed'`,
  ).run();

  // Step 1. Use rewindToFinalsPending to fabricate SFs (where missing) and
  // create the finals match rows. We'll then overwrite ruby's bracket and
  // score all finals to match the Discord-announced champions.
  const rewind = rewindToFinalsPending(sqlite, s10LeagueIds);
  console.log(
    `  rewind: fabricated ${rewind.sfFabricated} SF, ` +
    `cleared ${rewind.finalsCleared} + created ${rewind.finalsCreated} finals`,
  );

  // Step 2. Ruby's authoritative champion is TAYLOR (ruby-vgk), but the
  // bracket from the XLSX has EGG (jack) winning ruby-sf-5. Flip it so
  // VGK reaches the final.
  sqlite.prepare(
    `UPDATE matches
        SET home_score = 2, away_score = 4,
            status = 'completed',
            completed_at = COALESCE(completed_at, datetime('now'))
      WHERE id = 'ruby-sf-5'`,
  ).run();

  // Re-derive the ruby finals teams from the (now corrected) SF winners.
  // ruby-sf-5 winner = ruby-vgk; ruby-sf-6 winner is whichever team won
  // that SF (rewindToFinalsPending fabricated 4-2 home if it was unset).
  const rubySf6 = sqlite.prepare(
    `SELECT home_team_id, away_team_id, home_score, away_score
       FROM matches WHERE id = 'ruby-sf-6'`,
  ).get() as { home_team_id: string; away_team_id: string; home_score: number | null; away_score: number | null } | undefined;
  if (!rubySf6 || rubySf6.home_score == null || rubySf6.away_score == null) {
    throw new Error('ruby-sf-6 missing or unscored after rewind');
  }
  const rubyOtherFinalist = rubySf6.home_score > rubySf6.away_score
    ? rubySf6.home_team_id
    : rubySf6.away_team_id;

  sqlite.prepare(
    `UPDATE matches
        SET home_team_id = 'ruby-vgk', away_team_id = ?,
            home_seed = 4, away_seed = 2,
            home_score = 4, away_score = 3,
            status = 'completed',
            completed_at = COALESCE(completed_at, datetime('now'))
      WHERE id = 'ruby-f-1'`,
  ).run(rubyOtherFinalist);

  // Step 3. Score emerald + sapphire finals so the announced champions win.
  // The rewind above ordered the home side by seed (best seed = home), so
  // emerald-abs (gabe) is home in emerald-f-1 and sapphire-llb is home in
  // sapphire-f-1. emerald: home wins 4-3. sapphire: away (dwg/dylan) wins.
  sqlite.prepare(
    `UPDATE matches
        SET home_team_id = 'emerald-abs',
            home_score = CASE WHEN home_team_id = 'emerald-abs' THEN 4 ELSE 3 END,
            away_score = CASE WHEN home_team_id = 'emerald-abs' THEN 3 ELSE 4 END,
            status = 'completed',
            completed_at = COALESCE(completed_at, datetime('now'))
      WHERE id = 'emerald-f-1'`,
  ).run();
  // Make sure ABS is home and the score is 4-3 in their favor regardless of
  // which side rewind put them on.
  const ef = sqlite.prepare(
    `SELECT home_team_id, away_team_id FROM matches WHERE id = 'emerald-f-1'`,
  ).get() as { home_team_id: string; away_team_id: string };
  if (ef.home_team_id !== 'emerald-abs') {
    sqlite.prepare(
      `UPDATE matches
          SET home_team_id = 'emerald-abs', away_team_id = ?,
              home_score = 4, away_score = 3,
              status = 'completed',
              completed_at = COALESCE(completed_at, datetime('now'))
        WHERE id = 'emerald-f-1'`,
    ).run(ef.home_team_id);
  } else {
    sqlite.prepare(
      `UPDATE matches SET home_score = 4, away_score = 3 WHERE id = 'emerald-f-1'`,
    ).run();
  }

  const sf = sqlite.prepare(
    `SELECT home_team_id, away_team_id FROM matches WHERE id = 'sapphire-f-1'`,
  ).get() as { home_team_id: string; away_team_id: string };
  // DWG must win, regardless of which side rewind put them on. Score 4-3
  // in favor of DWG.
  const dwgIsHome = sf.home_team_id === 'sapphire-dwg';
  sqlite.prepare(
    `UPDATE matches
        SET home_score = ?, away_score = ?,
            status = 'completed',
            completed_at = COALESCE(completed_at, datetime('now'))
      WHERE id = 'sapphire-f-1'`,
  ).run(dwgIsHome ? 4 : 3, dwgIsHome ? 3 : 4);

  const finish = assignFinishPositions(sqlite, s10LeagueIds);
  console.log(`  finals scored; stamped ${finish.teamsUpdated} team(s) with finish positions`);

  // Advance phase + bump currentWeek so the offseason surfaces show real
  // post-final state instead of "in playoffs". Don't archive the season.
  //
  // Also stamp draft_date + week_dates so the Schedule page renders the
  // week selector with date subtitles + the "Week of …" header instead of
  // bare week numbers. The XLSX import doesn't carry these — they're a
  // mock-aesthetic detail that the live admin would normally fill in via
  // the Season wizard.
  //
  // Cadence: draft on Sat 2025-09-20, week 1 starts Mon 2025-10-06,
  // weeks 2..11 auto-fill at +7d each. Playoffs roll directly off week 11.
  // All three leagues share one rhythm — same season, same tournament.
  const week1 = new Date(Date.UTC(2025, 9, 6)); // 2025-10-06 (Mon)
  const s10WeekDates: Record<string, string> = {};
  for (let w = 1; w <= 11; w++) {
    const d = new Date(week1);
    d.setUTCDate(d.getUTCDate() + (w - 1) * 7);
    s10WeekDates[String(w)] = d.toISOString().slice(0, 10);
  }
  const s10DraftDates: Record<string, string> = {
    sapphire: '2025-09-20T19:00:00Z',
    ruby: '2025-09-21T19:00:00Z',
    emerald: '2025-09-27T19:00:00Z',
  };
  for (const leagueId of s10LeagueIds) {
    sqlite.prepare(
      `UPDATE leagues
          SET phase = 'offseason',
              current_week = 11,
              draft_date = COALESCE(draft_date, ?),
              week_dates = COALESCE(NULLIF(week_dates, ''), ?),
              week_dates_auto_filled = 1
        WHERE id = ?`,
    ).run(
      s10DraftDates[leagueId] ?? null,
      JSON.stringify(s10WeekDates),
      leagueId,
    );
  }

  // S10 is fully played out — champions crowned, finish positions stamped.
  // On the live deployment it becomes read-only archived history (same as
  // S9); S11 launches separately on launch day. Mock keeps S10 unarchived so
  // the deliberate Sapphire mid-season rewind (mock-data step) stays a
  // coherent "current" season for the demo.
  if (MODE === 'live') {
    sqlite.prepare(
      `UPDATE seasons SET archived = 1 WHERE season_number = 10`,
    ).run();
    console.log('  S10 marked archived (live mode)');
  }
}

// S9: complete the bracket (importS9 only produces QF rows)
// fabricatePlayoffBracket is a no-op for any league that already has SF/F
// rows; for S9 it walks the QF results and stamps synthetic SF + finals
// matches so the archive can render a complete bracket and the
// finish_position pass below has Champion / Runner-up to assign.
if (s9Missing.length === 0) {
  const s9LeagueIds = S9_CONFIG.files.map((f) => `s9-${f.id}`);

  console.log('\n── Fabricating S9 SF + finals rows ──');
  const bracket = fabricatePlayoffBracket(sqlite, s9LeagueIds);
  console.log(
    `  created ${bracket.sfsCreated} SF and ${bracket.finalsCreated} finals match(es)`,
  );

  console.log('\n── Assigning S9 finish positions ──');
  const finish = assignFinishPositions(sqlite, s9LeagueIds);
  console.log(`  stamped ${finish.teamsUpdated} team(s) with finish position/label`);

  // Award S9 pins. Two passes:
  //   1. runAutoAwards(season-end) → garchomp / cannoli / cynthia. S9 has
  //      no per-match Pokemon kill data (match_pokemon is empty for the
  //      historical import), so garchomp won't have eligible rows; cannoli
  //      and cynthia fire from match-level scores alone.
  //   2. mintArchivePins → champion / high-score / steal-of-the-draft /
  //      sweeper. The first three (high-score/steal/sweeper) need
  //      match_pokemon and will mint zero rows for S9, but champion only
  //      needs finals scores → fires correctly. Mirrors what the admin
  //      "Archive Season" button does live; we run both at seed time so
  //      the historical archive surface has the same pin set as a live
  //      finalize would.
  console.log('\n── Awarding S9 auto-pins ──');
  const { runAutoAwards } = await import('../src/lib/pins/auto-award');
  const { mintArchivePins } = await import('../src/lib/pins/archive-mint');
  for (const lid of s9LeagueIds) {
    const auto = runAutoAwards(lid, { trigger: 'season-end' });
    const archive = mintArchivePins(lid);
    console.log(
      `  ${lid}: auto ${auto.awarded.length}+${auto.skipped}, ` +
      `archive ${archive.awarded.length}+${archive.skipped}`,
    );
  }

  // Manual pins from the Discord award announcements (Elite-4 / Mix /
  // Player categories). The cannoli/cynthia/garchomp slugs overlap with
  // the auto job above; mintManualPins clears the season's auto rows for
  // those slugs first so the announced winners take precedence.
  console.log('\n── Awarding S9 manual pins ──');
  const s9Manual = mintManualPins(sqlite, 9, S9_AWARDS);
  console.log(
    `  inserted ${s9Manual.inserted}, skipped ${s9Manual.skipped}, ` +
    `unresolved ${s9Manual.unresolved.length}`,
  );
  for (const u of s9Manual.unresolved) {
    console.log(`    [unresolved] ${u.award.pin} ${u.award.leagueId ?? `season=${u.award.season}`} — ${u.reason}`);
  }
}

// Attach scraped replay protocol logs to matches across every cached season
// (S9, S10, …). Each season's cache lives under backend/imports/replays/sN/.
// This must run AFTER S10 finalize + S9 bracket fabrication so finals/SF
// rows exist with the correct home/away teams (see ruby-vgk rewrite, etc.)
// before we look up by (league, week|round, home, away).
//
// Scrape-on-seed is idempotent: if a season's cache directory already exists
// we skip the scrape entirely (instant). If missing, we shell out to the
// per-season scraper. The cache itself is gitignored (~3MB/season), so a
// fresh container build will scrape once on first seed; subsequent reseeds
// are network-free no-ops.
{
  const REPLAY_SEASONS = [
    { season: 9,  scraper: 'scrape-s9-replays.ts' },
    { season: 10, scraper: 'scrape-s10-replays.ts' },
  ] as const;

  console.log('\n── Replay cache ──');
  for (const { season, scraper } of REPLAY_SEASONS) {
    const dir = resolve(import.meta.dir, `../imports/replays/s${season}`);
    if (existsSync(dir)) {
      console.log(`  S${season}: cache present, skipping scrape`);
      continue;
    }
    console.log(`  S${season}: cache missing — scraping (this can take a few minutes)…`);
    const proc = Bun.spawnSync({
      cmd: ['bun', 'run', `scripts/${scraper}`],
      cwd: resolve(import.meta.dir, '..'),
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if (proc.exitCode !== 0) {
      console.warn(`  S${season}: scraper exited ${proc.exitCode} — continuing without these replays`);
    }
  }

  const { importReplays } = await import('./import-replays');
  console.log('\n── Attaching replays ──');
  importReplays(sqlite);

  // Parse the freshly-attached protocol logs into per-Pokemon K/D so the
  // /replays gallery's brought-team preview pane renders. Skips S9
  // (historical XLSX RawKills are SoT) and is idempotent — only fills in
  // matches with a log but no existing match_pokemon rows.
  const { backfillMatchPokemon } = await import('./backfill-match-pokemon');
  console.log('\n── Backfilling match_pokemon from logs ──');
  const bf = backfillMatchPokemon(sqlite);
  console.log(
    `  parsed ${bf.parsed}/${bf.scanned} matches, inserted ${bf.inserted} pokemon rows ` +
    `(skipped: ${bf.skippedS9} S9, ${bf.skippedAmbiguous} unmappable, ${bf.skippedNoMons} empty)`,
  );
}

// S10: award pins (auto + archive + manual)
// Runs after the finalize block above. Same shape as S9 but the season
// stays unarchived.
if (PRIMARY_CONFIG.seasonNumber === 10) {
  console.log('\n── Awarding S10 auto-pins ──');
  const { runAutoAwards } = await import('../src/lib/pins/auto-award');
  const { mintArchivePins } = await import('../src/lib/pins/archive-mint');
  const s10LeagueIds = S10_CONFIG.files.map((f) => f.id);
  for (const lid of s10LeagueIds) {
    const auto = runAutoAwards(lid, { trigger: 'season-end' });
    const archive = mintArchivePins(lid);
    console.log(
      `  ${lid}: auto ${auto.awarded.length}+${auto.skipped}, ` +
      `archive ${archive.awarded.length}+${archive.skipped}`,
    );
  }

  console.log('\n── Awarding S10 manual pins ──');
  const s10Manual = mintManualPins(sqlite, 10, S10_AWARDS);
  console.log(
    `  inserted ${s10Manual.inserted}, skipped ${s10Manual.skipped}, ` +
    `unresolved ${s10Manual.unresolved.length}`,
  );
  for (const u of s10Manual.unresolved) {
    console.log(`    [unresolved] ${u.award.pin} ${u.award.leagueId ?? `season=${u.award.season}`} — ${u.reason}`);
  }
}

// Seed supplementary data (both modes)
seedSiteSettings();
seedMoveCategories();
seedPinDefinitions();

// Mock-only data
if (MODE === 'mock') {
  seedMockData(coachTeamIds);
}

// Backfill pin_awarded activity-log entries for any pins inserted by importers
// (S9/S10/S11 historical) that bypassed the audit-logging path. Idempotent.
{
  const { backfillPinAuditLog } = await import('../src/lib/pins/backfill-audit');
  const r = backfillPinAuditLog();
  if (r.inserted > 0 || r.skipped > 0) {
    console.log(`\nPin audit backfill: ${r.inserted} inserted, ${r.skipped} already-logged`);
  }
}

// Schedule variety (mock-only)
// Stamps deadlines on every regular-season match across the active S10
// leagues + flips one league (sapphire) into a mid-season state so the
// /schedule surface has a realistic mix of completed / in-progress /
// scheduled rows instead of an all-completed wall. Strictly additive
// w.r.t. the rest of the seed pipeline:
//   - emerald + ruby keep their fully-scored, finalized state (archive,
//     finish positions, pins are untouched).
//   - sapphire's regular-season weeks 1-6 stay scored; week 7 becomes a
//     mix (some completed, one in-progress, two scheduled); weeks 8-11
//     are reset to scheduled (scores cleared, deadlines stamped) and the
//     league phase rolls back to `regular` at currentWeek=7. Sapphire's
//     playoff rows + finish positions are cleared since the mid-season
//     league hasn't reached them yet. (Sapphire has no manual S10 pins
//     beyond the auto champion-style awards minted upstream — those
//     remain in pins but are stale entries on a now-mid-season league,
//     which is an acceptable mock incongruity.)
if (MODE === 'mock' && PRIMARY_CONFIG.seasonNumber === 10) {
  console.log('\n── Seeding schedule variety ──');

  const s10LeagueIds = S10_CONFIG.files.map((f) => f.id);

  // Match-night cadence: home games rotate Sat 7pm / Sun 7pm / Tue 8pm /
  // Wed 8pm / Thu 8pm UTC across each week so the grid shows variation.
  // Picked deterministically from a hash of (matchId) so reseeds produce
  // the same timestamps.
  const NIGHT_SLOTS: Array<{ dow: number; hour: number }> = [
    { dow: 6, hour: 19 }, // Sat 7pm
    { dow: 0, hour: 19 }, // Sun 7pm
    { dow: 2, hour: 20 }, // Tue 8pm
    { dow: 3, hour: 20 }, // Wed 8pm
    { dow: 4, hour: 20 }, // Thu 8pm
  ];

  function hashStr(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h >>> 0;
  }

  function deadlineFor(matchId: string, weekStartIso: string | null): string | null {
    if (!weekStartIso) return null;
    const slot = NIGHT_SLOTS[hashStr(matchId) % NIGHT_SLOTS.length]!;
    const start = new Date(weekStartIso + 'T00:00:00Z');
    const startDow = start.getUTCDay();
    let offset = slot.dow - startDow;
    if (offset < 0) offset += 7;
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + offset);
    d.setUTCHours(slot.hour, 0, 0, 0);
    return d.toISOString();
  }

  // Step 1. Stamp deadlines on every regular-season match in S10. Picks
  // a per-match evening slot inside that week's date range.
  const allRegular = sqlite.prepare(
    `SELECT m.id as id, m.league_id as leagueId, m.week as week, l.week_dates as weekDates
       FROM matches m
       JOIN leagues l ON l.id = m.league_id
      WHERE m.league_id IN (${s10LeagueIds.map(() => '?').join(',')})
        AND m.phase = 'regular'`,
  ).all(...s10LeagueIds) as { id: string; leagueId: string; week: number; weekDates: string | null }[];

  const setDeadline = sqlite.prepare(`UPDATE matches SET deadline = ? WHERE id = ?`);
  const stampMany = sqlite.transaction((rows: Array<[string | null, string]>) => {
    for (const r of rows) setDeadline.run(...r);
  });
  const deadlineRows: Array<[string | null, string]> = [];
  for (const m of allRegular) {
    const wd: Record<string, string> = m.weekDates ? JSON.parse(m.weekDates) : {};
    const weekStart = wd[String(m.week)] ?? null;
    const dl = deadlineFor(m.id, weekStart);
    if (dl) deadlineRows.push([dl, m.id]);
  }
  stampMany(deadlineRows);
  console.log(`  stamped deadlines on ${deadlineRows.length} regular-season matches`);

  // Step 2. Flip sapphire to a mid-season state. Pick week 7 as "current".
  const ACTIVE_LEAGUE = 'sapphire';
  const ACTIVE_WEEK = 7;
  const TOTAL_REG_WEEKS = 11;

  // 2a. Reset weeks > ACTIVE_WEEK back to scheduled with scores cleared
  // and a stamped deadline so the schedule grid shows real upcoming rows.
  // The deadline stamped above is reused — already covers every regular
  // match. Just clear the score + status here.
  sqlite.prepare(
    `UPDATE matches
        SET home_score = NULL, away_score = NULL,
            status = 'scheduled',
            replay_url = NULL, replay_log = NULL,
            completed_at = NULL, started_at = NULL,
            ready_home = 0, ready_away = 0,
            ps_room_id = NULL, warnings = NULL
      WHERE league_id = ? AND phase = 'regular' AND week > ?`,
  ).run(ACTIVE_LEAGUE, ACTIVE_WEEK);

  // 2b. Inside ACTIVE_WEEK: keep the first 3 (by id) as completed, set
  // the 4th to in_progress, and 5th + 6th to scheduled. Match ids are
  // stable (`sapphire-w7m1` … `sapphire-w7m6`).
  const wkMatches = sqlite.prepare(
    `SELECT id FROM matches
      WHERE league_id = ? AND phase = 'regular' AND week = ?
      ORDER BY id`,
  ).all(ACTIVE_LEAGUE, ACTIVE_WEEK) as { id: string }[];

  const inProgressId = wkMatches[3]?.id;
  const scheduledIds = wkMatches.slice(4).map((m) => m.id);

  if (inProgressId) {
    sqlite.prepare(
      `UPDATE matches
          SET home_score = NULL, away_score = NULL,
              status = 'in_progress',
              ready_home = 1, ready_away = 1,
              started_at = ?,
              completed_at = NULL,
              replay_url = NULL, replay_log = NULL,
              ps_room_id = ?
        WHERE id = ?`,
    ).run(
      // Started ~30min ago in real time so the HUD-ish UI reads "live now".
      new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      `battle-gen9doublesou-${Math.floor(Math.random() * 1e9)}`,
      inProgressId,
    );
  }

  for (const id of scheduledIds) {
    sqlite.prepare(
      `UPDATE matches
          SET home_score = NULL, away_score = NULL,
              status = 'scheduled',
              replay_url = NULL, replay_log = NULL,
              completed_at = NULL, started_at = NULL,
              ready_home = 0, ready_away = 0,
              ps_room_id = NULL
        WHERE id = ?`,
    ).run(id);
  }

  // 2c. Drop sapphire's playoff matches — the mid-season league hasn't
  // reached them. Clean up dependent match_pokemon rows first via
  // ON DELETE CASCADE (declared in schema). bye_weeks aren't touched.
  const playoffDeleted = sqlite.prepare(
    `DELETE FROM matches WHERE league_id = ? AND phase = 'playoffs'`,
  ).run(ACTIVE_LEAGUE);

  // 2d. Clear finish_position / finish_label on sapphire teams so the
  // standings UI doesn't show "Champion" badges on a still-running
  // league. Pin rows are left as-is (acceptable mock incongruity).
  sqlite.prepare(
    `UPDATE teams SET finish_position = NULL, finish_label = NULL
      WHERE league_id = ?`,
  ).run(ACTIVE_LEAGUE);

  // 2e. Roll the league phase + currentWeek back. Keep the existing
  // week_dates blob so the date subtitles still render.
  sqlite.prepare(
    `UPDATE leagues
        SET phase = 'regular', current_week = ?
      WHERE id = ?`,
  ).run(ACTIVE_WEEK, ACTIVE_LEAGUE);

  // Summary: how many rows in each bucket now? Useful to eyeball after
  // a reseed.
  const counts = sqlite.prepare(
    `SELECT status, COUNT(*) as c
       FROM matches WHERE league_id = ?
       GROUP BY status`,
  ).all(ACTIVE_LEAGUE) as { status: string; c: number }[];
  const pretty = counts.map((c) => `${c.status}=${c.c}`).join(' ');
  console.log(`  ${ACTIVE_LEAGUE} reset to regular wk${ACTIVE_WEEK}: ${pretty} (deleted ${playoffDeleted.changes} playoff rows)`);
}

// Per-league cost formats
// Pokemon + leagues exist by now. Populate format_costs for both cost sheets
// (NatDex / NatDex+), refresh the pokemon baseline to NatDex+, and assign each
// league its format (Emerald → natdex, others → natdexplus). Same code path as
// the standalone apply-cost-formats.ts so a fresh seed and a live apply produce
// identical per-league pricing.
{
  const fmt = sqlite.transaction(() => {
    refreshBaseline(sqlite);
    const written = populateFormatCosts(sqlite);
    const leaguesChanged = assignLeagueCostFormats(sqlite);
    return { written, leaguesChanged };
  })();
  const perFmt = Object.entries(fmt.written).map(([f, n]) => `${f}=${n}`).join(' ');
  console.log(`\n  cost formats: format_costs(${perFmt}), ${fmt.leaguesChanged} leagues assigned`);
}

// Final summary

console.log('\n=== Seed Complete ===');
const tables = ['users', 'seasons', 'leagues', 'teams', 'pokemon', 'rosters', 'draft_picks',
  'matches', 'match_pokemon', 'transactions', 'trades', 'trade_block_listings',
  'activity_log', 'site_settings', 'move_categories', 'move_category_entries'];
for (const t of tables) {
  const c = (sqlite.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as any).c;
  console.log(`  ${t}: ${c}`);
}

sqlite.close();
console.log('\nDone!');
