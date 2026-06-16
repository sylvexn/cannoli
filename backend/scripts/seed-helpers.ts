/**
 * Shared seed helpers — system accounts, site settings, pin definitions, and
 * move categories.
 *
 * These four steps are identical between the XLSX-driven `seed.ts` and the
 * fully-fictional `seed-sim.ts` / `buildSimWorld()`. They are factored here so
 * both seeders (and the future sim-reset API route) reuse one implementation
 * instead of duplicating the bodies. Every function is idempotent: it checks
 * for existing rows and skips if already populated.
 */
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { hashSync } from 'bcryptjs';
import * as schema from '../src/db/schema';

type DB = ReturnType<typeof drizzle<typeof schema>>;

// ─── System accounts ────────────────────────────────────────────────────────

/** Seed the syl (dev) + root (bot) system accounts. Idempotent. */
export function seedSystemAccounts(sqlite: Database, db: DB): void {
  const existing = sqlite
    .prepare('SELECT COUNT(*) as c FROM users WHERE username IN (?, ?)')
    .get('syl', 'root') as { c: number };
  if (existing.c > 0) {
    console.log('  System accounts already exist, skipping.');
    return;
  }

  db.insert(schema.users).values({
    username: 'syl',
    passwordHash: hashSync('admin', 10),
    role: 'dev',
    mustChangePassword: false,
    active: true,
  }).run();

  db.insert(schema.users).values({
    username: 'root',
    passwordHash: hashSync('root', 10),
    role: 'bot',
    mustChangePassword: true,
    active: true,
  }).run();

  console.log('  Created: syl (dev), root (bot)');
}

// ─── Site settings ──────────────────────────────────────────────────────────

/** Seed the single site_settings row. Idempotent. */
export function seedSiteSettings(sqlite: Database, db: DB, opts: { mock?: boolean; announcement?: string } = {}): void {
  const existing = sqlite.prepare('SELECT COUNT(*) as c FROM site_settings').get() as { c: number };
  if (existing.c > 0) {
    console.log('Site settings already exist, skipping.');
    return;
  }

  if (opts.mock) {
    db.insert(schema.siteSettings).values({
      id: 1,
      siteName: 'Cannoli',
      announcement: opts.announcement ?? 'Welcome to Cannoli — Season 10 mock data for demo purposes.',
      announcementType: 'info',
    }).run();
  } else {
    db.insert(schema.siteSettings).values({ id: 1 }).run();
  }
  console.log('Site settings seeded.');
}

// ─── Pin definitions ────────────────────────────────────────────────────────
//
// Net-new auto-pin defs added when the archive feature shipped. The earlier
// award set lives in migration 0022_real_awards.sql. These four close the
// gaps: Champion, High Score, Steal of the Draft, Sweeper.

const ARCHIVE_PIN_DEFINITIONS = [
  { id: 'champion', name: 'Champion', description: 'Won the league finals', iconName: 'Crown', color: '#fbbf24' },
  { id: 'high-score', name: 'High Score', description: 'Most kills by a single Pokemon in a single match', iconName: 'Flame', color: '#ef4444' },
  { id: 'steal-of-the-draft', name: 'Steal of the Draft', description: 'Best kills-per-point value on a drafted Pokemon', iconName: 'TrendingUp', color: '#10b981' },
  { id: 'sweeper', name: 'Sweeper', description: 'Most 6-0 sweeps recorded across the season', iconName: 'Swords', color: '#a855f7' },
] as const;

/** Seed the archive auto-pin definitions. Idempotent (per-id). */
export function seedPinDefinitions(sqlite: Database, db: DB): void {
  let inserted = 0;
  for (const def of ARCHIVE_PIN_DEFINITIONS) {
    const existing = sqlite.prepare('SELECT id FROM pin_definitions WHERE id = ?').get(def.id);
    if (existing) continue;
    db.insert(schema.pinDefinitions).values({ ...def, category: 'season', isAuto: true }).run();
    inserted++;
  }
  if (inserted > 0) console.log(`Pin definitions seeded (+${inserted}).`);
  else console.log('Pin definitions already exist, skipping.');
}

// ─── Move categories ────────────────────────────────────────────────────────

const MOVE_CATEGORIES = [
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

/** Seed the move categories + their entries. Idempotent. */
export function seedMoveCategories(sqlite: Database, db: DB): void {
  const existing = sqlite.prepare('SELECT COUNT(*) as c FROM move_categories').get() as { c: number };
  if (existing.c > 0) {
    console.log('Move categories already exist, skipping.');
    return;
  }

  console.log('Seeding move categories...');
  for (const cat of MOVE_CATEGORIES) {
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
        isAbility: (entry as { isAbility?: boolean }).isAbility || false,
      }).run();
    }
  }
  console.log(`  ${MOVE_CATEGORIES.length} categories, ${MOVE_CATEGORIES.reduce((a, c) => a + c.entries.length, 0)} entries`);
}
