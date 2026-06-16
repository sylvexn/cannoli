/**
 * Launch Season 11 onto an existing DB.
 *
 * Unlike `seed.ts` (which builds a whole DB and whose S11 path intentionally
 * omits S10), this script imports ONLY S11 *on top of* a DB that already holds
 * the S9 + S10 archives — i.e. the live database. It is the "launch day" step
 * referenced in deploy/README.md ("S11 is NOT created — it launches separately
 * on launch day").
 *
 * What it does:
 *   1. Import S11 from backend/imports/Cannoli {Sapphire,Ruby,Emerald} Season 11.xlsx
 *      (teams, rosters incl. tera captains, draft picks, full round-robin
 *      schedule as scheduled matches) and create coach user accounts with the
 *      default password 'password' (forced change on first login).
 *   2. Set team logos from each league's Setup sheet (imgur URLs).
 *   3. Leagues launch in `regular` phase, week 1 (set in S11_CONFIG).
 *
 * Idempotent guard: bails if season 11 already exists.
 *
 *   bun run scripts/launch-s11.ts                 # operates on data/cannoli.db
 *   CANNOLI_DB_PATH=/tmp/x.db bun run scripts/launch-s11.ts
 */

import { Database } from 'bun:sqlite';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { importSeason, importTeamLogos, S11_CONFIG, IMPORTS_DIR } from './import-xlsx';
import { generateRoundRobin } from '../src/lib/schedule-generator';

const DB_PATH = process.env.CANNOLI_DB_PATH || resolve(import.meta.dir, '../data/cannoli.db');

console.log(`\n=== Launch S11 → ${DB_PATH} ===`);

// Preflight: required XLSX files present.
const missing = S11_CONFIG.files
  .map((f) => f.file)
  .filter((f) => !existsSync(resolve(IMPORTS_DIR, f)));
if (missing.length) {
  console.error(`Missing S11 import file(s) in ${IMPORTS_DIR}:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

if (!existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH}. Build the live base first (CANNOLI_MODE=live bun run seed:fresh).`);
  process.exit(1);
}
const sqlite = new Database(DB_PATH);

// Sanity: this is meant to run on a populated DB (the live archive). Refuse to
// run on a fresh/empty DB where it would silently create an S11-only world.
const seasons = sqlite.prepare('SELECT season_number, archived FROM seasons ORDER BY season_number').all() as {
  season_number: number;
  archived: number;
}[];
const seasonNums = seasons.map((s) => s.season_number);
console.log(`Existing seasons: ${seasons.map((s) => `${s.season_number}${s.archived ? ' (archived)' : ''}`).join(', ') || '(none)'}`);

if (seasonNums.includes(11)) {
  console.error('Season 11 already exists — refusing to import again. (Idempotency guard.)');
  process.exit(1);
}
if (!seasonNums.includes(10)) {
  console.error('Expected season 10 to already exist in this DB. Build the live base first (CANNOLI_MODE=live bun run seed:fresh).');
  process.exit(1);
}

// ─── Import S11 ──────────────────────────────────────────────────────────────
console.log('\n── Importing Season 11 ──');
importSeason(sqlite, S11_CONFIG, { createUsers: true, clearExisting: false });

// ─── Team logos ──────────────────────────────────────────────────────────────
console.log('\n── Importing S11 team logos ──');
const logos = importTeamLogos(sqlite, S11_CONFIG);

// ─── Backfill schedules for any league whose XLSX had no matchups ─────────────
// Some source spreadsheets ship with the round-robin unfilled (e.g. S11 Ruby).
// Generate a balanced round-robin for any S11 league that imported zero matches
// so every league launches week 1 with a full schedule. Uses the same pure
// generator the admin draft→regular advance uses; 12 (even) teams → 11 weeks,
// no byes.
console.log('\n── Backfilling missing schedules ──');
const s11LeagueIds = S11_CONFIG.files.map((f) => f.id);
const insertMatch = sqlite.prepare(
  `INSERT INTO matches (id, league_id, week, home_team_id, away_team_id, phase)
   VALUES (?, ?, ?, ?, ?, 'regular')`,
);
for (const leagueId of s11LeagueIds) {
  const existing = (sqlite.prepare('SELECT COUNT(*) c FROM matches WHERE league_id = ?').get(leagueId) as any).c;
  if (existing > 0) {
    console.log(`  ${leagueId}: ${existing} matches already imported — skipping`);
    continue;
  }
  const teamIds = (sqlite.prepare('SELECT id FROM teams WHERE league_id = ? ORDER BY id').all(leagueId) as any[]).map((t) => t.id);
  const { matches: fixtures, byes } = generateRoundRobin(teamIds);
  const perWeek = new Map<number, number>();
  for (const f of fixtures) {
    const n = (perWeek.get(f.week) ?? 0) + 1;
    perWeek.set(f.week, n);
    insertMatch.run(`${leagueId}-w${f.week}m${n}`, leagueId, f.week, f.homeTeamId, f.awayTeamId);
  }
  if (byes.length) {
    const insertBye = sqlite.prepare('INSERT INTO bye_weeks (league_id, week, team_id) VALUES (?, ?, ?)');
    for (const b of byes) insertBye.run(leagueId, b.week, b.teamId);
  }
  console.log(`  ${leagueId}: generated ${fixtures.length} matches + ${byes.length} byes (round-robin)`);
}

// ─── Verification summary ────────────────────────────────────────────────────
sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');

const s11Id = (sqlite.prepare('SELECT id FROM seasons WHERE season_number = 11').get() as any).id;
const leagues = sqlite
  .prepare('SELECT id, phase, current_week, total_weeks FROM leagues WHERE season_id = ? ORDER BY id')
  .all(s11Id) as any[];
const count = (sql: string, ...a: any[]) => (sqlite.prepare(sql).get(...a) as any).c;

console.log('\n=== S11 verification ===');
for (const lg of leagues) {
  const teams = count('SELECT COUNT(*) c FROM teams WHERE league_id = ?', lg.id);
  const rosters = count(
    'SELECT COUNT(*) c FROM rosters r JOIN teams t ON t.id = r.team_id WHERE t.league_id = ?',
    lg.id,
  );
  const picks = count('SELECT COUNT(*) c FROM draft_picks WHERE league_id = ?', lg.id);
  const matches = count('SELECT COUNT(*) c FROM matches WHERE league_id = ?', lg.id);
  const withLogo = count('SELECT COUNT(*) c FROM teams WHERE league_id = ? AND logo_path IS NOT NULL', lg.id);
  const captains = count(
    'SELECT COUNT(*) c FROM rosters r JOIN teams t ON t.id = r.team_id WHERE t.league_id = ? AND r.is_tera_captain = 1',
    lg.id,
  );
  console.log(
    `  ${lg.id.padEnd(9)} phase=${lg.phase} wk=${lg.current_week}/${lg.total_weeks} ` +
      `teams=${teams} rosters=${rosters} picks=${picks} matches=${matches} captains=${captains} logos=${withLogo}/${teams}`,
  );
}

const newUsers = count(
  "SELECT COUNT(*) c FROM users WHERE role = 'user' AND must_change_password = 1",
);
console.log(`  users(role=user, must_change_password=1): ${newUsers}`);
console.log(`  teams still on placeholder logo: ${logos.placeholder.length} [${logos.placeholder.join(', ')}]`);

sqlite.close();
console.log('\nDone.');
console.log(
  '\nNEXT: run `bun run scripts/apply-s11-costs.ts` against this DB. The XLSX ' +
    'import sets costs from each league sheet (old NatDex — legendaries banned); ' +
    'apply-s11-costs overwrites them with the NatDex+ S11 costs and confirms the ' +
    'admin-review / top-8 league settings.',
);
