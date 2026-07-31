/**
 * Migration integrity — apply every Drizzle migration from scratch on a fresh
 * SQLite DB and assert the resulting schema matches the Drizzle schema
 * definition (src/db/schema.ts).
 *
 * Why this exists (launch-prep #5, task 1): the live deployment ships a DB
 * built from `seed:fresh`, which runs all migrations 0000..latest against an
 * empty file. If a migration is malformed, references a column a later
 * migration drops, or the schema definition has drifted from the migration
 * chain, the live build silently produces a wrong schema. This test is the
 * canary: it fails loudly the moment the migration chain and schema.ts
 * disagree, BEFORE the artifact is shipped to prod.
 *
 * Oracle: `drizzle-kit export` renders the full CREATE-TABLE DDL straight from
 * schema.ts (the source of truth ORM code reads/writes against). We parse that
 * into a {table -> Set<column>} map and compare it against what the migrated
 * DB actually has via PRAGMA table_info. A mismatch in either direction
 * (missing table, extra table, missing/extra/renamed column) fails the test.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';

const BACKEND_DIR = resolve(import.meta.dir, '..');
const MIGRATIONS_DIR = resolve(BACKEND_DIR, 'drizzle');
const SCHEMA_FILE = resolve(BACKEND_DIR, 'src/db/schema.ts');

let tmpDir: string;
let dbPath: string;
let sqlite: Database;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cannoli-mig-'));
  dbPath = join(tmpDir, 'fresh.db');
  sqlite = new Database(dbPath, { create: true });
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite);
  // Apply the full migration chain against the empty file.
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

afterAll(() => {
  try { sqlite?.close(); } catch {}
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// Helpers

/** Tables present in the migrated DB, excluding sqlite_* and drizzle bookkeeping. */
function liveTables(): string[] {
  return (sqlite
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'`,
    )
    .all() as { name: string }[])
    .map((r) => r.name)
    .sort();
}

function liveColumns(table: string): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/**
 * Parse `drizzle-kit export` DDL into {table -> Set<column>}. We only need the
 * leading `\`col\`` identifier on each line inside a CREATE TABLE body; lines
 * that start with FOREIGN KEY / PRIMARY KEY / UNIQUE constraints are skipped.
 */
function parseSchemaDdl(ddl: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const tableRe = /CREATE TABLE `([^`]+)` \(([\s\S]*?)\n\);/g;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(ddl)) !== null) {
    const [, table, body] = m;
    const cols = new Set<string>();
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith('`')) continue; // skip FK/constraint lines
      const colMatch = line.match(/^`([^`]+)`/);
      if (colMatch) cols.add(colMatch[1]);
    }
    out.set(table, cols);
  }
  return out;
}

let schemaDdl: string;
function schemaTables(): Map<string, Set<string>> {
  if (!schemaDdl) {
    schemaDdl = execSync(
      `bunx drizzle-kit export --dialect sqlite --schema ./src/db/schema.ts`,
      { cwd: BACKEND_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  }
  return parseSchemaDdl(schemaDdl);
}

// Tests

describe('migration chain applies from scratch', () => {
  test('every migration file in drizzle/ was recorded as applied', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] };
    // Journal entry count must equal .sql file count (no orphan/missing files).
    expect(journal.entries.length).toBe(files.length);

    const applied = sqlite
      .prepare(`SELECT count(*) AS n FROM __drizzle_migrations`)
      .get() as { n: number };
    expect(applied.n).toBe(journal.entries.length);
  });

  test('produces a non-empty set of tables', () => {
    expect(liveTables().length).toBeGreaterThan(0);
  });
});

describe('migrated schema matches schema.ts (drizzle-kit export oracle)', () => {
  test('table set is identical', () => {
    const fromSchema = [...schemaTables().keys()].sort();
    const fromDb = liveTables();
    expect(fromDb).toEqual(fromSchema);
  });

  test('every table has the exact same column set', () => {
    const schema = schemaTables();
    const mismatches: string[] = [];
    for (const [table, expectedCols] of schema) {
      const actualCols = liveColumns(table);
      const missing = [...expectedCols].filter((c) => !actualCols.has(c));
      const extra = [...actualCols].filter((c) => !expectedCols.has(c));
      if (missing.length || extra.length) {
        mismatches.push(
          `${table}: missing=[${missing.join(',')}] extra=[${extra.join(',')}]`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('late-migration invariants (drops + adds land correctly)', () => {
  test('0021: seasons.archived column exists, NOT NULL default 0', () => {
    const cols = sqlite.prepare(`PRAGMA table_info("seasons")`).all() as {
      name: string; notnull: number; dflt_value: string | null;
    }[];
    const archived = cols.find((c) => c.name === 'archived');
    expect(archived).toBeDefined();
    expect(archived!.notnull).toBe(1);
    expect(archived!.dflt_value).toBe('0');
  });

  test('0035/0036: dropped team columns are gone', () => {
    const cols = liveColumns('teams');
    expect(cols.has('showdown_username')).toBe(false);
    expect(cols.has('motto')).toBe(false);
  });

  test('0035: dropped user signature columns are gone', () => {
    const cols = liveColumns('users');
    expect(cols.has('signature_pokemon_id')).toBe(false);
    expect(cols.has('signature_type')).toBe(false);
  });

  test('0037: dropped user_preferences notify columns are gone', () => {
    const cols = liveColumns('user_preferences');
    expect(cols.has('notify_trades')).toBe(false);
    expect(cols.has('notify_matches')).toBe(false);
    expect(cols.has('notify_announcements')).toBe(false);
  });
});
