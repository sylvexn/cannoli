/**
 * Public season-awards endpoint must not expose live-season pins or
 * provenance fields. Hermetic temp DB, same mock approach as
 * archive-enforcement.test.ts.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';
import * as schema from '../src/db/schema';

const BACKEND_DIR = resolve(import.meta.dir, '..');
let realDbModule: typeof import('../src/db');
let app: { handle: (r: Request) => Promise<Response> };

const get = async (path: string) => (await app.handle(new Request(`http://localhost${path}`))).json() as Promise<any>;

beforeAll(async () => {
  realDbModule = await import('../src/db');
  const sqlite = new Database(join(mkdtempSync(join(tmpdir(), 'cannoli-awards-')), 'a.db'), { create: true });
  sqlite.exec('PRAGMA foreign_keys = ON');
  const testDb = drizzle(sqlite, { schema });
  migrate(testDb, { migrationsFolder: resolve(BACKEND_DIR, 'drizzle') });
  mock.module(resolve(BACKEND_DIR, 'src/db/index.ts'), () => ({ db: testDb, sqlite, schema }));

  sqlite.exec(`
    INSERT INTO seasons (id, season_number, archived) VALUES (9, 9, 1), (11, 11, 0);
    INSERT INTO users (id, username, display_name, password_hash, role, active) VALUES
      (1, 'a', 'A', 'x', 'user', 1), (2, 'gone', 'Gone', 'x', 'user', 0);
    INSERT INTO pin_definitions (id, name, description, icon_name, color, category, is_auto)
      VALUES (1, 'Champ', 'd', 'trophy', '#fff', 'season', 0);
    INSERT INTO pins (user_id, pin_def_id, season_id, source, awarded_by) VALUES
      (1, 1, 9, 'manual', 1), (2, 1, 9, 'manual', 1), (1, 1, 11, 'manual', 1);
  `);
  const { archiveDeepRoutes } = await import('../src/routes/archive');
  app = archiveDeepRoutes as any;
});

afterAll(() => {
  mock.module(resolve(BACKEND_DIR, 'src/db/index.ts'), () => ({
    db: realDbModule.db, sqlite: realDbModule.sqlite, schema: realDbModule.schema,
  }));
});

describe('anonymous season awards', () => {
  test('non-archived season returns no awards', async () => {
    expect((await get('/api/archive/seasons/11/awards')).pins).toEqual([]);
  });
  test('archived season returns active holders only, without provenance', async () => {
    const { pins } = await get('/api/archive/seasons/9/awards');
    expect(pins).toHaveLength(1);
    expect(pins[0].userId).toBe(1);
    expect('awardedBy' in pins[0]).toBe(false);
    expect('source' in pins[0]).toBe(false);
  });
});
