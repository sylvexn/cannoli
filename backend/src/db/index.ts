import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from './schema';
import { resolve } from 'path';

// Honor CANNOLI_DB_PATH (documented in deploy/README.md + read by the boot
// guard in src/index.ts) so per-worktree/test DBs can be pointed at a
// different file; fall back to the canonical data/cannoli.db otherwise.
const DB_PATH = process.env.CANNOLI_DB_PATH
  ? resolve(process.env.CANNOLI_DB_PATH)
  : resolve(import.meta.dir, '../../data/cannoli.db');
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../drizzle');

export const sqlite = new Database(DB_PATH);
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// Apply pending migrations on startup so the dev DB is never behind the schema.
// In live/production a migration failure means the schema is half-applied and
// continuing would serve corrupt/inconsistent data — hard-exit instead so the
// orchestrator restarts (and the operator notices) rather than silently
// running against a broken schema. In dev/mock we log and keep going so a bad
// hand-written migration doesn't lock you out of the local server.
try {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
} catch (err) {
  console.error('[db] migration failed:', err);
  if (process.env.CANNOLI_MODE === 'live' || process.env.NODE_ENV === 'production') {
    console.error('[db] refusing to serve a half-migrated schema in live mode — exiting.');
    process.exit(1);
  }
}

export { schema };
