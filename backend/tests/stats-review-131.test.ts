/**
 * Review fixes: archive league/team reads gated to archived seasons for guests,
 * all-time champions via matchWinner, public pins strip provenance, season-stats
 * GP counted once per folded name. Hermetic temp DB (same mock as archive-awards-leak).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Elysia } from 'elysia';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';
import * as schema from '../src/db/schema';

const BACKEND_DIR = resolve(import.meta.dir, '..');
let realDbModule: typeof import('../src/db');
let app: { handle: (r: Request) => Promise<Response> };
let pokemonSeasonStats: typeof import('../src/lib/pokemon-season-stats').pokemonSeasonStats;

const req = (path: string, staff = false) =>
  app.handle(new Request(`http://localhost${path}`, { headers: staff ? { 'x-test-staff': '1' } : {} }));

beforeAll(async () => {
  realDbModule = await import('../src/db');
  const sqlite = new Database(join(mkdtempSync(join(tmpdir(), 'cannoli-131-')), 'a.db'), { create: true });
  sqlite.exec('PRAGMA foreign_keys = ON');
  const testDb = drizzle(sqlite, { schema });
  migrate(testDb, { migrationsFolder: resolve(BACKEND_DIR, 'drizzle') });
  mock.module(resolve(BACKEND_DIR, 'src/db/index.ts'), () => ({ db: testDb, sqlite, schema }));

  sqlite.exec(`
    INSERT INTO seasons (id, season_number, archived) VALUES (9, 9, 1), (11, 11, 0);
    INSERT INTO leagues (id, season_id, name, color) VALUES ('LA', 9, 'Arch', 'emerald'), ('LL', 11, 'Live', 'ruby');
    INSERT INTO users (id, username, display_name, password_hash, role, active) VALUES (1, 'a', 'A', 'x', 'user', 1);
    INSERT INTO teams (id, league_id, coach_name, team_name, team_abbrev, user_id) VALUES
      ('TA1', 'LA', 'c', 'Arch One', 'AO', 1), ('TA2', 'LA', 'c', 'Arch Two', 'AT', NULL),
      ('TL1', 'LL', 'c', 'Live One', 'LO', NULL), ('TL2', 'LL', 'c', 'Live Two', 'LT', NULL);
    INSERT INTO matches (id, league_id, week, home_team_id, away_team_id, phase, playoff_round, status, home_score, away_score, winner_team_id) VALUES
      ('FA', 'LA', 5, 'TA1', 'TA2', 'playoffs', 'f', 'completed', 0, 0, 'TA2'),
      ('ML', 'LL', 1, 'TL1', 'TL2', 'regular', NULL, 'completed', 3, 1, 'TL1');
    INSERT INTO rosters (team_id, pokemon_name, tier) VALUES ('TL1', 'Minior', 3);
    INSERT INTO match_pokemon (match_id, team_id, pokemon_name, kills, deaths) VALUES
      ('ML', 'TL1', 'Minior', 1, 0), ('ML', 'TL1', 'Minior-Indigo', 2, 1);
    INSERT INTO pin_definitions (id, name, description, icon_name, color, category, is_auto)
      VALUES (1, 'Champ', 'd', 'trophy', '#fff', 'season', 0);
    INSERT INTO pins (user_id, team_id, pin_def_id, season_id, source, awarded_by, published)
      VALUES (1, 'TA1', 1, 9, 'manual', 1, 1);
  `);
  const { archiveDeepRoutes } = await import('../src/routes/archive');
  const { pinRoutes } = await import('../src/routes/pins');
  pokemonSeasonStats = (await import('../src/lib/pokemon-season-stats')).pokemonSeasonStats;
  app = new Elysia()
    .derive(({ request }) => ({ user: request.headers.get('x-test-staff') ? ({ id: '1', role: 'admin' } as any) : null }))
    .use(archiveDeepRoutes).use(pinRoutes) as any;
});

afterAll(() => {
  mock.module(resolve(BACKEND_DIR, 'src/db/index.ts'), () => ({
    db: realDbModule.db, sqlite: realDbModule.sqlite, schema: realDbModule.schema,
  }));
});

describe('archive league gate', () => {
  test('guest 404 on unarchived league and its team', async () => {
    expect((await req('/api/archive/leagues/LL/full')).status).toBe(404);
    expect((await req('/api/archive/leagues/LL/teams/TL1')).status).toBe(404);
  });
  test('staff and archived-league reads still work', async () => {
    expect((await req('/api/archive/leagues/LL/full', true)).status).toBe(200);
    expect((await req('/api/archive/leagues/LL/teams/TL1', true)).status).toBe(200);
    expect((await req('/api/archive/leagues/LA/full')).status).toBe(200);
    expect((await req('/api/archive/leagues/LA/teams/TA1')).status).toBe(200);
  });
});

test('all-time champion honors winner_team_id on tied-score final', async () => {
  const body = await (await req('/api/archive/all-time')).json() as any;
  expect(body.champions.map((c: any) => c.teamId)).toEqual(['TA2']);
});

test('public pins hide provenance from guests, not staff', async () => {
  const guest = await (await req('/api/teams/TA1/pins')).json() as any[];
  expect(guest).toHaveLength(1);
  expect('awardedBy' in guest[0]).toBe(false);
  expect('source' in guest[0]).toBe(false);
  const staff = await (await req('/api/teams/TA1/pins', true)).json() as any[];
  expect(staff[0].source).toBe('manual');
});

test('season stats count GP once when two stored names fold together', () => {
  const [m] = pokemonSeasonStats('LL', null);
  expect(m.pokemonName).toBe('Minior');
  expect(m.gp).toBe(1);
  expect(m.kills).toBe(3);
  expect(m.wins).toBe(1);
});
