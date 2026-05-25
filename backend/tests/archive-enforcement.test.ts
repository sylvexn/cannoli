/**
 * Archive read-only enforcement (launch-prep #5, task 3).
 *
 * Once a season is `archived = 1`, every mutation endpoint that touches it must
 * refuse the write unless `?force=1` is passed. The shared gate lives in
 * `src/lib/archive-guard.ts` (checkSeasonArchived / checkLeagueArchived /
 * checkMatchArchived / checkTeamArchived); ~40 route handlers call it (see
 * grep in the findings). This test exercises the REAL guard functions against a
 * fully-migrated temp DB so the JOIN paths, the force bypass, and the
 * non-existent-row passthrough are all verified end to end.
 *
 * It complements archive-mint.test.ts (which covers award PICKING, not write
 * rejection) — together they cover the two halves of "archive a season".
 *
 * Hermetic: builds its own temp SQLite DB via the migration chain and injects
 * it into the guard module with `mock.module`, so it never touches the dev or
 * live DB.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';
import * as schema from '../src/db/schema';

const BACKEND_DIR = resolve(import.meta.dir, '..');
const MIGRATIONS_DIR = resolve(BACKEND_DIR, 'drizzle');

let tmpDir: string;
let sqlite: Database;
// The REAL db-module exports, captured before we mock the singleton. We
// restore them in afterAll so later test files (which import `../src/db`) see
// the live dev-DB singleton again — NOT our closed temp handle. Without this,
// `mock.module` leaves a global override pointing at a DB we then close,
// poisoning every alphabetically-later test with "Cannot use a closed
// database" (TEST-ISOLATION).
let realDbModule: typeof import('../src/db');

// IDs for an ARCHIVED season (9) and an ACTIVE season (11).
const ARCH_SEASON = 9;
const ACTIVE_SEASON = 11;
const ARCH_LEAGUE = 'lg-arch';
const ACTIVE_LEAGUE = 'lg-active';
const ARCH_TEAM = 'tm-arch';
const ACTIVE_TEAM = 'tm-active';
const ARCH_MATCH = 'mt-arch';
const ACTIVE_MATCH = 'mt-active';

// Guard functions, loaded after the db module is mocked.
let checkSeasonArchived: typeof import('../src/lib/archive-guard').checkSeasonArchived;
let checkLeagueArchived: typeof import('../src/lib/archive-guard').checkLeagueArchived;
let checkMatchArchived: typeof import('../src/lib/archive-guard').checkMatchArchived;
let checkTeamArchived: typeof import('../src/lib/archive-guard').checkTeamArchived;

beforeAll(async () => {
  // Capture the live singleton BEFORE mocking so afterAll can restore it.
  realDbModule = await import('../src/db');

  tmpDir = mkdtempSync(join(tmpdir(), 'cannoli-arch-'));
  const dbPath = join(tmpDir, 'arch.db');
  sqlite = new Database(dbPath, { create: true });
  sqlite.exec('PRAGMA foreign_keys = ON');
  const testDb = drizzle(sqlite, { schema });
  migrate(testDb, { migrationsFolder: MIGRATIONS_DIR });

  // Inject our temp DB into the guard's `import { db, schema } from '../db'`.
  mock.module(resolve(BACKEND_DIR, 'src/db/index.ts'), () => ({
    db: testDb,
    sqlite,
    schema,
  }));

  // Seed two seasons: one archived, one active, each with a league/team/match.
  sqlite.exec(`
    INSERT INTO seasons (id, season_number, archived) VALUES
      (${ARCH_SEASON}, ${ARCH_SEASON}, 1),
      (${ACTIVE_SEASON}, ${ACTIVE_SEASON}, 0);
    INSERT INTO leagues (id, season_id, name, color) VALUES
      ('${ARCH_LEAGUE}', ${ARCH_SEASON}, 'Arch League', 'emerald'),
      ('${ACTIVE_LEAGUE}', ${ACTIVE_SEASON}, 'Active League', 'ruby');
    INSERT INTO teams (id, league_id, coach_name, team_name, team_abbrev) VALUES
      ('${ARCH_TEAM}', '${ARCH_LEAGUE}', 'Arch Coach', 'Arch Team', 'ARC'),
      ('${ACTIVE_TEAM}', '${ACTIVE_LEAGUE}', 'Active Coach', 'Active Team', 'ACT');
    INSERT INTO matches (id, league_id, week, home_team_id, away_team_id, phase, status) VALUES
      ('${ARCH_MATCH}', '${ARCH_LEAGUE}', 1, '${ARCH_TEAM}', '${ARCH_TEAM}', 'regular', 'scheduled'),
      ('${ACTIVE_MATCH}', '${ACTIVE_LEAGUE}', 1, '${ACTIVE_TEAM}', '${ACTIVE_TEAM}', 'regular', 'scheduled');
  `);

  const guard = await import('../src/lib/archive-guard');
  checkSeasonArchived = guard.checkSeasonArchived;
  checkLeagueArchived = guard.checkLeagueArchived;
  checkMatchArchived = guard.checkMatchArchived;
  checkTeamArchived = guard.checkTeamArchived;
});

afterAll(() => {
  // Restore the REAL db singleton so later test files that import `../src/db`
  // get the live dev-DB handle again, not our temp one.
  mock.module(resolve(BACKEND_DIR, 'src/db/index.ts'), () => ({
    db: realDbModule.db,
    sqlite: realDbModule.sqlite,
    schema: realDbModule.schema,
  }));
  // TEST-ISOLATION: do NOT close the temp handle. Bun's `mock.module` override
  // is process-global and a later-loaded test file may have already bound its
  // `import { db } from '../src/db'` to our temp DB *before* the restore above
  // ran (module bindings resolve at load time). Closing the temp handle would
  // then poison that file with "Cannot use a closed database". The temp file is
  // unlinked below; the OS reclaims the handle when the process exits.
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ── Blocking on archived rows ─────────────────────────────────────────────────

describe('archived season blocks writes (no force)', () => {
  test('checkSeasonArchived blocks an archived season', () => {
    const block = checkSeasonArchived(ARCH_SEASON);
    expect(block).not.toBeNull();
    expect(block!.code).toBe('season_archived');
    expect(block!.seasonNumber).toBe(ARCH_SEASON);
  });

  test('checkLeagueArchived blocks a league in an archived season', () => {
    const block = checkLeagueArchived(ARCH_LEAGUE);
    expect(block).not.toBeNull();
    expect(block!.seasonNumber).toBe(ARCH_SEASON);
  });

  test('checkTeamArchived blocks a team in an archived season', () => {
    const block = checkTeamArchived(ARCH_TEAM);
    expect(block).not.toBeNull();
    expect(block!.seasonNumber).toBe(ARCH_SEASON);
  });

  test('checkMatchArchived blocks a match in an archived season', () => {
    const block = checkMatchArchived(ARCH_MATCH);
    expect(block).not.toBeNull();
    expect(block!.seasonNumber).toBe(ARCH_SEASON);
  });
});

// ── Active rows pass ──────────────────────────────────────────────────────────

describe('active (non-archived) season allows writes', () => {
  test('checkSeasonArchived passes an active season', () => {
    expect(checkSeasonArchived(ACTIVE_SEASON)).toBeNull();
  });
  test('checkLeagueArchived passes an active league', () => {
    expect(checkLeagueArchived(ACTIVE_LEAGUE)).toBeNull();
  });
  test('checkTeamArchived passes an active team', () => {
    expect(checkTeamArchived(ACTIVE_TEAM)).toBeNull();
  });
  test('checkMatchArchived passes an active match', () => {
    expect(checkMatchArchived(ACTIVE_MATCH)).toBeNull();
  });
});

// ── force=1 bypass ────────────────────────────────────────────────────────────

describe('?force=1 bypasses the guard on archived rows', () => {
  test.each(['1', 'true', true])('force=%p bypasses checkSeasonArchived', (force) => {
    expect(checkSeasonArchived(ARCH_SEASON, force)).toBeNull();
  });
  test('force bypasses all four guard variants', () => {
    expect(checkLeagueArchived(ARCH_LEAGUE, '1')).toBeNull();
    expect(checkTeamArchived(ARCH_TEAM, '1')).toBeNull();
    expect(checkMatchArchived(ARCH_MATCH, '1')).toBeNull();
  });
  test('a non-matching force value does NOT bypass (only 1/true/"true")', () => {
    expect(checkSeasonArchived(ARCH_SEASON, '0')).not.toBeNull();
    expect(checkSeasonArchived(ARCH_SEASON, 'yes')).not.toBeNull();
    expect(checkSeasonArchived(ARCH_SEASON, undefined)).not.toBeNull();
  });
});

// ── Non-existent rows pass through to the route's own 404 ─────────────────────

describe('missing rows pass through (do not mask 404)', () => {
  test('unknown season/league/team/match all return null', () => {
    expect(checkSeasonArchived(99999)).toBeNull();
    expect(checkLeagueArchived('nope')).toBeNull();
    expect(checkTeamArchived('nope')).toBeNull();
    expect(checkMatchArchived('nope')).toBeNull();
  });
});
