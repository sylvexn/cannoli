/**
 * One-off data migration for the admin-curated awards rework.
 *
 *   bun run scripts/curate-pins-migration.ts --db <path>                 # dry run (default)
 *   bun run scripts/curate-pins-migration.ts --db <path> --apply [--out <file.json>]
 *
 * What it does (in one transaction on --apply):
 *   a. exports EVERY pin (joined with its definition) to a JSON file,
 *   b. deletes only the auto-minted pins (source = 'auto') — those get
 *      re-awarded through the Awards Sheet using the suggestions — then drops
 *      the retired kingslayer / flawless definitions (migration 0072 leaves
 *      them while pins reference them; pins cascade, hence export-first),
 *   c. backfills team_id (and metadata.teamId / leagueId) on the remaining
 *      rows from metadata / team ownership,
 *   d. marks the remaining hand-curated / fixture rows published.
 *
 * The DB must already be at migration 0070 (boot the backend once, or run any
 * script that imports src/db). Never run against a live volume without a
 * snapshot — dry run first, review the counts.
 */
import { Database } from 'bun:sqlite';
import { existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const dbPath = opt('--db') ?? process.env.CANNOLI_DB_PATH;
if (!dbPath || !existsSync(dbPath)) {
  console.error('usage: curate-pins-migration.ts --db <path> [--apply] [--out <file.json>]');
  process.exit(1);
}
const apply = flag('--apply');
const outPath = resolve(opt('--out') ?? `pins-export-${new Date().toISOString().slice(0, 10)}.json`);

const db = new Database(dbPath);
db.exec('PRAGMA foreign_keys = ON');

const cols = db.query(`PRAGMA table_info(pins)`).all() as { name: string }[];
if (!cols.some(c => c.name === 'team_id') || !cols.some(c => c.name === 'published')) {
  console.error('pins table is not at migration 0070 yet - boot the backend against this DB first.');
  process.exit(1);
}

const count = (sql: string, ...p: unknown[]) => (db.query(sql).get(...p as []) as { c: number }).c;

const total = count(`SELECT COUNT(*) c FROM pins`);
const autoRows = count(`SELECT COUNT(*) c FROM pins WHERE source = 'auto'`);
const manualRows = total - autoRows;
const missingTeam = count(`SELECT COUNT(*) c FROM pins WHERE source != 'auto' AND team_id IS NULL`);
const unpublished = count(`SELECT COUNT(*) c FROM pins WHERE source != 'auto' AND published = 0`);

console.log(`${apply ? 'APPLY' : 'DRY RUN'} on ${dbPath}`);
console.log(`  pins total              ${total}`);
console.log(`  auto-minted (delete)    ${autoRows}`);
console.log(`  remaining (keep)        ${manualRows}`);
console.log(`  keep, team_id missing   ${missingTeam}  (backfill from metadata / ownership)`);
console.log(`  keep, unpublished       ${unpublished}  (will be published)`);
const byDef = db.query(`SELECT pin_def_id d, COUNT(*) c FROM pins WHERE source = 'auto' GROUP BY 1 ORDER BY 1`).all() as { d: string; c: number }[];
console.log(`  auto rows by pin        ${byDef.map(r => `${r.d}:${r.c}`).join(' ') || '-'}`);

if (!apply) {
  console.log('\nDry run only - pass --apply to export, delete, backfill and publish.');
  process.exit(0);
}

const rows = db.query(`
  SELECT p.*, d.name AS def_name, d.scope AS def_scope, s.season_number
    FROM pins p
    JOIN pin_definitions d ON d.id = p.pin_def_id
    LEFT JOIN seasons s ON s.id = p.season_id
   ORDER BY p.id`).all();
writeFileSync(outPath, JSON.stringify({ exportedAt: new Date().toISOString(), db: dbPath, pins: rows }, null, 2));
console.log(`\nexported ${rows.length} pins -> ${outPath}`);

db.transaction(() => {
  const del = db.query(`DELETE FROM pins WHERE source = 'auto'`).run();
  // Retired badges. Any non-auto pin left on them would cascade away with the
  // definition, so drop their pins explicitly (already in the export above).
  db.query(`DELETE FROM pins WHERE pin_def_id IN ('kingslayer', 'flawless')`).run();
  db.query(`DELETE FROM pin_definitions WHERE id IN ('kingslayer', 'flawless')`).run();

  // Backfill team_id: metadata.teamId, then winnerTeamId, then the user's team in the pin's league.
  db.query(`
    UPDATE pins SET team_id = COALESCE(
      (SELECT t.id FROM teams t WHERE t.id = json_extract(pins.metadata, '$.teamId')),
      (SELECT t.id FROM teams t WHERE t.id = json_extract(pins.metadata, '$.winnerTeamId')),
      (SELECT t.id FROM teams t WHERE t.user_id = pins.user_id AND t.league_id = pins.league_id LIMIT 1))
    WHERE team_id IS NULL`).run();
  // Keep metadata.teamId / leagueId honest for readers that still look there.
  db.query(`
    UPDATE pins SET metadata = json_set(COALESCE(metadata, '{}'), '$.teamId', team_id)
    WHERE team_id IS NOT NULL AND json_extract(COALESCE(metadata, '{}'), '$.teamId') IS NULL`).run();
  db.query(`
    UPDATE pins SET metadata = json_set(COALESCE(metadata, '{}'), '$.leagueId', league_id)
    WHERE league_id IS NOT NULL AND json_extract(COALESCE(metadata, '{}'), '$.leagueId') IS NULL`).run();
  const pub = db.query(`UPDATE pins SET published = 1 WHERE published = 0`).run();
  console.log(`deleted ${del.changes} auto pins; team_id backfill ran; published ${pub.changes}`);
})();

const left = count(`SELECT COUNT(*) c FROM pins WHERE team_id IS NULL`);
console.log(`done. ${count('SELECT COUNT(*) c FROM pins')} pins remain; ${left} without a team (coach-level awards / unresolved).`);
