import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';
import { resolve } from 'path';

const DB_PATH = resolve(import.meta.dir, '../../data/cannoli.db');

const sqlite = new Database(DB_PATH);
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };
