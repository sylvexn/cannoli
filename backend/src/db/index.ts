import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from './schema';
import { resolve } from 'path';

const DB_PATH = resolve(import.meta.dir, '../../data/cannoli.db');
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../drizzle');

export const sqlite = new Database(DB_PATH);
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// Apply pending migrations on startup so the dev DB is never behind the schema
try {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
} catch (err) {
  console.error('[db] migration failed:', err);
}

export { schema };
