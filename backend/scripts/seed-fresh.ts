/**
 * In-place "fresh seed".
 *
 * Replaces the older `rm -f data/cannoli.db && bun run scripts/seed.ts`. The
 * `rm` form was nice and simple, but breaks when a long-running dev server
 * (`bun run --hot src/index.ts`) holds the file open: on Linux the unlink
 * just removes the dirent, the inode survives until the last fd closes, and
 * the dev server keeps reading + writing the orphaned inode while every
 * other connection (seed scripts, tests, ad-hoc bun -e) talks to the new
 * file at the same path. State diverges silently and writes from one side
 * are invisible to the other.
 *
 * This script wipes the DB without unlinking it: drop every user table,
 * vacuum, then re-import `scripts/seed.ts` which re-runs migrations and
 * repopulates. The inode is preserved, so the dev server's open handle
 * picks up the fresh schema and data on its next query.
 */

import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const DB_PATH = resolve(import.meta.dir, '../data/cannoli.db');

(function wipeInPlace() {
  const sqlite = new Database(DB_PATH, { create: true });
  // Foreign keys would block table drops in arbitrary order; turn them off
  // for the wipe and re-enable when the regular seed reopens the file.
  sqlite.exec('PRAGMA foreign_keys = OFF');

  // sqlite_* tables (sqlite_sequence, sqlite_stat1, …) are internal — leave
  // them alone. Drizzle's __drizzle_migrations bookkeeping table is
  // deliberately dropped so the next seed re-runs every migration cleanly.
  const tables = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];

  for (const { name } of tables) {
    // Identifier-quote the table name; sqlite reserves a bunch of words
    // that show up as table names elsewhere in the codebase
    // (e.g. `transactions`).
    sqlite.exec(`DROP TABLE IF EXISTS "${name}"`);
  }

  // VACUUM reclaims the freelist pages so the file actually shrinks. Without
  // this the file stays the same size as the prior populated DB even though
  // it's empty, which is a confusing diagnostic if someone later inspects
  // it on disk.
  sqlite.exec('VACUUM');
  sqlite.close();
  console.log(`[seed:fresh] wiped ${tables.length} tables in ${DB_PATH}`);
})();

// Run the regular seed exactly as before. It opens its own connection, runs
// migrations against the now-empty file, and populates everything.
await import('./seed.ts');
