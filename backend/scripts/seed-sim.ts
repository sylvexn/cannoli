/**
 * Seed the Cannoli SIMULATOR world.
 *
 * Usage: bun run scripts/seed-sim.ts   (or `bun run seed:sim` from backend/)
 *
 * The mock deployment is an interactive season simulator populated with fully
 * fictional data — no real coaches, teams, or results. This script:
 *
 *   1. Wipes + migrates backend/data/cannoli.db in place (the seed-fresh
 *      pattern: drop every table, vacuum — preserves the inode so a running
 *      dev server picks up the fresh schema).
 *   2. Calls buildSimWorld(), which produces one FINISHED fictional season and
 *      one LIVE in-progress fictional season, plus the `demo` admin user.
 *   3. Logs a summary and confirms the world is fictional-only.
 *
 * MOCK-ONLY: buildSimWorld asserts CANNOLI_MODE=mock. The npm script sets it.
 *
 * The DB wipe MUST happen before `build-world` is imported — that module pulls
 * in `src/db`, which opens the database file and auto-migrates on import. So
 * the wipe runs first against its own throwaway handle, then build-world is
 * dynamically imported against the now-empty file.
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const DB_PATH = resolve(import.meta.dir, '../data/cannoli.db');

if (process.env.CANNOLI_MODE !== 'mock') {
  console.error(
    `seed-sim is mock-only. Run with CANNOLI_MODE=mock (got '${process.env.CANNOLI_MODE ?? '(unset)'}').`,
  );
  process.exit(1);
}

// ─── Step 1: wipe in place ──────────────────────────────────────────────────

(function wipeInPlace() {
  const sqlite = new Database(DB_PATH, { create: true });
  sqlite.exec('PRAGMA foreign_keys = OFF');
  const tables = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];
  for (const { name } of tables) {
    sqlite.exec(`DROP TABLE IF EXISTS "${name}"`);
  }
  sqlite.exec('VACUUM');
  sqlite.close();
  console.log(`[seed:sim] wiped ${tables.length} tables in ${DB_PATH}`);
})();

// ─── Step 2: build the world ────────────────────────────────────────────────
// Dynamic import so `src/db` (and its auto-migrate) runs AFTER the wipe above.

const { buildSimWorld, DEFAULT_SIM_SEED } = await import('../src/lib/sim/build-world');

const seedArg = process.env.CANNOLI_SIM_SEED;
const masterSeed = seedArg ? Number.parseInt(seedArg, 0) : DEFAULT_SIM_SEED;

const result = buildSimWorld({ masterSeed });

// ─── Step 3: summary ────────────────────────────────────────────────────────

console.log('\n=== Simulator world built ===');
console.log(`  masterSeed: 0x${result.masterSeed.toString(16)}`);
console.log(`  demo user id: ${result.demoUserId}`);
for (const season of result.seasons) {
  console.log(`\n  Season ${season.seasonNumber} (${season.status}) — id ${season.seasonId}`);
  for (const lg of season.leagues) {
    const champ = lg.championId ? ` champion=${lg.championId}` : '';
    console.log(
      `    ${lg.leagueId}: ${lg.teams} teams, ${lg.picks} picks, ` +
      `${lg.regularMatches} regular + ${lg.playoffMatches} playoff matches${champ}`,
    );
  }
}
console.log(
  `\n  Totals: ${result.totals.seasons} seasons, ${result.totals.leagues} leagues, ` +
  `${result.totals.teams} teams, ${result.totals.matches} matches`,
);
console.log('\nAll data is FICTIONAL — no real S9/S10 coaches, teams, or results.');
console.log('Done!');
