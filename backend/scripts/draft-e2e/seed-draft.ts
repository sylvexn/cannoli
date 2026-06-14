/**
 * Seed for the draft-load harness (scripts/draft-e2e).
 *
 * Builds a league parked at the start of its draft so 12 headless WS clients can
 * run a full snake draft with no humans:
 *   - pokemon reference table (from the committed CI fixture) so picks validate
 *   - 1 season (pointCap 110, 2 tera-captain slots)
 *   - 1 league phase='draft', draftOrder = 12 team ids, small rosterSize (fast)
 *   - 12 coach users + teams, 1 admin (for draft/start + auto-pick REST)
 *
 *   CANNOLI_DB_PATH=/tmp/draft-e2e.db bun run scripts/draft-e2e/seed-draft.ts
 */
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { hashSync } from 'bcryptjs';
import { resolve } from 'path';
import * as schema from '../../src/db/schema';
import fixture from '../../tests/fixtures/pokemon-reference.json';

const DB_PATH = process.env.CANNOLI_DB_PATH || '/tmp/draft-e2e.db';
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../drizzle');

export const DRAFT = {
  password: 'draft-pass',
  admin: 'draftadmin',
  leagueId: 'draft-league',
  seasonNumber: 9200,
  rounds: 3, //          12 teams × 3 = 36 picks — fast but exercises 3 snake turns
  timerSeconds: 6,
  teams: Array.from({ length: 12 }, (_, i) => ({
    username: `coach${i + 1}`,
    teamId: `dt-${i + 1}`,
    teamName: `Team ${i + 1}`,
    abbrev: `T${i + 1}`,
  })),
} as const;

export function seedDraft() {
  const sqlite = new Database(DB_PATH, { create: true });
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  // Fresh fixtures.
  sqlite.exec(`
    DELETE FROM draft_picks WHERE league_id = '${DRAFT.leagueId}';
    DELETE FROM draft_state WHERE league_id = '${DRAFT.leagueId}';
    DELETE FROM rosters WHERE team_id IN (${DRAFT.teams.map((t) => `'${t.teamId}'`).join(',')});
    DELETE FROM teams WHERE league_id = '${DRAFT.leagueId}';
    DELETE FROM leagues WHERE id = '${DRAFT.leagueId}';
    DELETE FROM seasons WHERE season_number = ${DRAFT.seasonNumber};
    DELETE FROM users WHERE username IN (${[DRAFT.admin, ...DRAFT.teams.map((t) => t.username)].map((u) => `'${u}'`).join(',')});
  `);

  // Pokemon reference (idempotent — only if empty).
  if ((sqlite.query('SELECT COUNT(*) c FROM pokemon').get() as { c: number }).c === 0) {
    const ins = sqlite.prepare(`INSERT OR IGNORE INTO pokemon
      (name,type1,type2,hp,atk,def,spa,spd,spe,ability1,ability2,hidden_ability,tier,tera_banned,banned,national_dex_number,form_category)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const seed = sqlite.transaction((rows: any[]) => {
      for (const p of rows) ins.run(p.name, p.type1, p.type2, p.hp, p.atk, p.def, p.spa, p.spd, p.spe,
        p.ability1, p.ability2, p.hidden_ability, p.tier, p.tera_banned, p.banned, p.national_dex_number, p.form_category);
    });
    seed(fixture as any[]);
  }

  const seasonId = db.insert(schema.seasons)
    .values({ seasonNumber: DRAFT.seasonNumber, pointCap: 110, teraCaptainSlots: 2, archived: false })
    .returning().get().id;

  db.insert(schema.leagues).values({
    id: DRAFT.leagueId, seasonId, name: 'Draft E2E League', color: 'sapphire',
    phase: 'draft', currentWeek: 0, paused: false,
    rosterSize: DRAFT.rounds, draftOrder: JSON.stringify(DRAFT.teams.map((t) => t.teamId)),
  }).run();

  const pw = hashSync(DRAFT.password, 4);
  db.insert(schema.users).values({ username: DRAFT.admin, passwordHash: pw, role: 'admin', active: true, mustChangePassword: false }).run();
  for (const t of DRAFT.teams) {
    const userId = db.insert(schema.users)
      .values({ username: t.username, passwordHash: pw, role: 'user', active: true, mustChangePassword: false })
      .returning().get().id;
    db.insert(schema.teams).values({
      id: t.teamId, leagueId: DRAFT.leagueId, coachName: t.username,
      teamName: t.teamName, teamAbbrev: t.abbrev, userId,
    }).run();
  }

  sqlite.close();
  console.log(`[seed-draft] league ${DRAFT.leagueId}: 12 teams, ${DRAFT.rounds} rounds (${12 * DRAFT.rounds} picks), timer ${DRAFT.timerSeconds}s → ${DB_PATH}`);
}

if (import.meta.main) seedDraft();
