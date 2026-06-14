/**
 * Minimal seed for the bot end-to-end harness (scripts/bot-e2e).
 *
 * Builds the smallest world the live Showdown pipeline needs:
 *   - 1 season (regular), 1 league (phase=regular, currentWeek=1, not paused)
 *   - 4 coach users with known passwords (login → arena WS cookie)
 *   - 4 teams, each owned by one coach (userId set)
 *   - 2 scheduled week-1 matches:
 *       M_FORFEIT : team A (home) vs team B (away)  → exercised via /forfeit
 *       M_STATS   : team C (home) vs team D (away)  → exercised via real moves
 *
 * No rosters needed: the bot writes match_pokemon from what APPEARS in the live
 * battle (ReplayParser), not from the drafted roster. Run against an isolated DB
 * via CANNOLI_DB_PATH so it never touches dev/live data.
 *
 *   CANNOLI_DB_PATH=/tmp/bot-e2e.db bun run scripts/bot-e2e/seed-e2e.ts
 */
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { hashSync } from 'bcryptjs';
import { resolve } from 'path';
import * as schema from '../../src/db/schema';

const DB_PATH = process.env.CANNOLI_DB_PATH || '/tmp/bot-e2e.db';
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../drizzle');

export const E2E = {
  password: 'e2e-pass',
  leagueId: 'e2e-league',
  seasonNumber: 9100,
  coaches: [
    { username: 'e2ealice', teamId: 'e2e-team-a', teamName: 'Alpha', abbrev: 'ALP' },
    { username: 'e2ebob', teamId: 'e2e-team-b', teamName: 'Bravo', abbrev: 'BRV' },
    { username: 'e2ecarol', teamId: 'e2e-team-c', teamName: 'Charlie', abbrev: 'CHA' },
    { username: 'e2edave', teamId: 'e2e-team-d', teamName: 'Delta', abbrev: 'DEL' },
  ],
  matchForfeit: 'e2e-match-forfeit', // A vs B
  matchStats: 'e2e-match-stats', //    C vs D
  // Species each coach's PS team can bring (mirrors E2E_TEAM in ps-client.ts).
  // Seeded onto every team's roster so the bot's post-battle roster validation
  // (replay-parser.validateMatchResult) passes → result records as `completed`
  // rather than `disputed`. Names must match the PS replay species exactly.
  rosterSpecies: ['Garchomp', 'Dragonite', 'Tyranitar', 'Skarmory', 'Rotom-Wash', 'Toxapex'],
} as const;

export function seedE2E() {
  const sqlite = new Database(DB_PATH, { create: true });
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  // Idempotent wipe of just our fixtures (leave any pokemon ref / bot user).
  sqlite.exec(`
    DELETE FROM match_pokemon WHERE match_id IN ('${E2E.matchForfeit}', '${E2E.matchStats}');
    DELETE FROM matches WHERE league_id = '${E2E.leagueId}';
    DELETE FROM teams WHERE league_id = '${E2E.leagueId}';
    DELETE FROM leagues WHERE id = '${E2E.leagueId}';
    DELETE FROM seasons WHERE season_number = ${E2E.seasonNumber};
    DELETE FROM users WHERE username IN (${E2E.coaches.map((c) => `'${c.username}'`).join(',')});
  `);

  const seasonId = db
    .insert(schema.seasons)
    .values({ seasonNumber: E2E.seasonNumber, archived: false })
    .returning()
    .get().id;

  db.insert(schema.leagues)
    .values({
      id: E2E.leagueId,
      seasonId,
      name: 'E2E League',
      color: 'emerald',
      phase: 'regular',
      currentWeek: 1,
      paused: false,
    })
    .run();

  const pwHash = hashSync(E2E.password, 4);
  for (const c of E2E.coaches) {
    const userId = db
      .insert(schema.users)
      .values({ username: c.username, passwordHash: pwHash, role: 'user', active: true })
      .returning()
      .get().id;
    db.insert(schema.teams)
      .values({
        id: c.teamId,
        leagueId: E2E.leagueId,
        coachName: c.username,
        teamName: c.teamName,
        teamAbbrev: c.abbrev,
        userId,
      })
      .run();
    db.insert(schema.rosters)
      .values(E2E.rosterSpecies.map((name) => ({
        teamId: c.teamId, pokemonName: name, tier: 1, costAtDraft: 1, acquiredVia: 'draft' as const,
      })))
      .run();
  }

  const [a, b, cc, d] = E2E.coaches;
  db.insert(schema.matches)
    .values([
      {
        id: E2E.matchForfeit,
        leagueId: E2E.leagueId,
        week: 1,
        homeTeamId: a.teamId,
        awayTeamId: b.teamId,
        status: 'scheduled',
        phase: 'regular',
      },
      {
        id: E2E.matchStats,
        leagueId: E2E.leagueId,
        week: 1,
        homeTeamId: cc.teamId,
        awayTeamId: d.teamId,
        status: 'scheduled',
        phase: 'regular',
      },
    ])
    .run();

  sqlite.close();
  console.log(`[seed-e2e] seeded league ${E2E.leagueId} (season ${E2E.seasonNumber}) into ${DB_PATH}`);
  console.log(`[seed-e2e]   forfeit match ${E2E.matchForfeit}: ${a.username}(home) vs ${b.username}(away)`);
  console.log(`[seed-e2e]   stats match   ${E2E.matchStats}: ${cc.username}(home) vs ${d.username}(away)`);
}

if (import.meta.main) seedE2E();
