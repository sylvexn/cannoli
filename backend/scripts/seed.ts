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

// ─── Init DB ────────────────────────────────────────────────────────────────

const sqlite = new Database(DB_PATH, { create: true });
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// ─── Run migrations ─────────────────────────────────────────────────────────

console.log('Running migrations...');
migrate(db, { migrationsFolder: DRIZZLE_DIR });
console.log('Migrations complete.');

// ─── Seed system accounts ───────────────────────────────────────────────────

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

  // Root admin account
  db.insert(schema.users).values({
    username: 'root',
    passwordHash: hashSync('root', 10),
    role: 'admin',
    mustChangePassword: true,
    active: true,
  }).run();

  console.log('  Created: syl (dev), root (admin)');
}

// ─── Seed site settings ─────────────────────────────────────────────────────

function seedSiteSettings() {
  const existing = sqlite.prepare('SELECT COUNT(*) as c FROM site_settings').get() as any;
  if (existing.c > 0) {
    console.log('Site settings already exist, skipping.');
    return;
  }

  if (MODE === 'mock') {
    db.insert(schema.siteSettings).values({
      id: 1,
      siteName: 'Cannoli',
      announcement: 'Welcome to Cannoli — Season 10 mock data for demo purposes.',
      announcementType: 'info',
    }).run();
  } else {
    db.insert(schema.siteSettings).values({ id: 1 }).run();
  }
  console.log('Site settings seeded.');
}

// ─── Seed pin definitions ───────────────────────────────────────────────────
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

// ─── Seed move categories ───────────────────────────────────────────────────

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

// ─── Seed mock-only data ────────────────────────────────────────────────────

function seedMockData(coachTeamIds: Map<string, string>) {
  console.log('\nSeeding mock-only data...');

  // ─── Trade proposals (not completed transactions — those come from XLSX) ──
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

  // ─── Trade block listings ─────────────────────────────────────────────────

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

  // ─── Demo replay URLs on some completed matches ───────────────────────────

  const completedMatches = sqlite.prepare(
    `SELECT id FROM matches WHERE home_score IS NOT NULL AND phase = 'regular' ORDER BY week LIMIT 2`
  ).all() as { id: string }[];

  // Also mark matches with scores as completed
  sqlite.prepare(`UPDATE matches SET status = 'completed' WHERE home_score IS NOT NULL`).run();

  if (completedMatches.length >= 1) {
    sqlite.prepare(`UPDATE matches SET replay_url = ? WHERE id = ?`).run(
      '/replays/Gen9NatDexDraft-2026-03-29-roabio-hellofellorat.html',
      completedMatches[0].id,
    );
  }
  if (completedMatches.length >= 2) {
    sqlite.prepare(`UPDATE matches SET replay_url = ? WHERE id = ?`).run(
      '/replays/Gen9NatDexDraft-2026-04-03-simolili-gabrys24.html',
      completedMatches[1].id,
    );
  }
  console.log(`  ${Math.min(completedMatches.length, 2)} demo replay URLs seeded`);

  // ─── Activity log ─────────────────────────────────────────────────────────

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
}

// ─── Run ────────────────────────────────────────────────────────────────────

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

// Attach scraped replay protocol logs to matches across every cached season
// (S9, S10, …). Each season's cache lives under backend/imports/replays/sN/.
{
  const { importReplays } = await import('./import-replays');
  console.log('\n── Attaching replays ──');
  importReplays(sqlite);
}

// ─── S10: rewind to "finals pending" ──────────────────────────────────────
// Regular season + QF + SF stay reported (results, replays, kill stats);
// the finals match has both teams seeded but no result yet. Mirrors the
// state the league actually sits in at the time of a real-life finals.
if (PRIMARY_CONFIG.seasonNumber === 10) {
  console.log('\n── Rewinding S10 to finals pending ──');
  const s10LeagueIds = S10_CONFIG.files.map((f) => f.id);
  const rewind = rewindToFinalsPending(sqlite, s10LeagueIds);
  console.log(
    `  fabricated ${rewind.sfFabricated} SF result(s); ` +
    `cleared ${rewind.finalsCleared} + created ${rewind.finalsCreated} finals match(es); ` +
    `deleted ${rewind.matchPokemonDeleted} per-mon stat row(s)`,
  );
}

// ─── S9: complete the bracket (importS9 only produces QF rows) ──────────
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

// ─── Final summary ──────────────────────────────────────────────────────────

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
