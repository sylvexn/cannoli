/**
 * Populate per-league COST FORMATS on an existing DB.
 *
 *   bun run scripts/apply-cost-formats.ts                 # operates on data/cannoli.db
 *   CANNOLI_DB_PATH=/tmp/x.db bun run scripts/apply-cost-formats.ts
 *   bun run scripts/apply-cost-formats.ts --dry-run       # report, write nothing
 *
 * Reads both sheets of `backend/imports/Costs.xlsx` (NatDex = Emerald, NatDex+ =
 * Ruby/Sapphire) and:
 *
 *   1. Fills `format_costs` (cost_format, pokemon_name, tier, banned, tera_banned)
 *      fully for BOTH formats — this is the per-league cost authority.
 *   2. Refreshes the global `pokemon` reference table to the NatDex+ baseline so
 *      any format-agnostic read stays sensible (the fallback in
 *      lib/league-costs.ts).
 *   3. Assigns `leagues.cost_format` — Emerald-family leagues → 'natdex', all
 *      others → 'natdexplus'.
 *
 * Roster `cost_at_draft` snapshots are never touched — historical/locked rosters
 * keep the price actually paid. Idempotent: re-running converges to the same
 * state. Importable (`populateFormatCosts` / `assignLeagueCostFormats`) so the
 * seed can build a fresh DB the same way.
 */

import { Database } from 'bun:sqlite';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { parseCostFormat, FORMAT_SHEETS } from './parse-costs';

const BASELINE_FORMAT = 'natdexplus';

/** Fill format_costs for every known cost format, scoped to species the pokemon
 *  reference table carries. Returns rows written per format. */
export function populateFormatCosts(db: Database): Record<string, number> {
  const known = new Set<string>(db.prepare('SELECT name FROM pokemon').all().map((r: any) => r.name));

  const insert = db.prepare(
    'INSERT OR REPLACE INTO format_costs (cost_format, pokemon_name, tier, banned, tera_banned) VALUES (?, ?, ?, ?, ?)',
  );
  const wipe = db.prepare('DELETE FROM format_costs WHERE cost_format = ?');

  const written: Record<string, number> = {};
  for (const format of Object.keys(FORMAT_SHEETS)) {
    const { byName, banned } = parseCostFormat(format);
    wipe.run(format);
    let n = 0;
    for (const e of byName.values()) {
      if (!known.has(e.name)) continue;
      insert.run(format, e.name, e.tier, 0, e.teraBanned ? 1 : 0);
      n++;
    }
    for (const name of banned) {
      if (!known.has(name)) continue;
      insert.run(format, name, 99, 1, 0);
      n++;
    }
    written[format] = n;
  }
  return written;
}

/** Refresh the global pokemon reference table to the NatDex+ baseline. */
export function refreshBaseline(db: Database): { draftable: number; banned: number } {
  const { byName, banned } = parseCostFormat(BASELINE_FORMAT);
  const setDraftable = db.prepare('UPDATE pokemon SET tier = ?, banned = 0, tera_banned = ? WHERE name = ?');
  const setBanned = db.prepare('UPDATE pokemon SET tier = 99, banned = 1, tera_banned = 0 WHERE name = ?');
  let draftable = 0, bannedN = 0;
  for (const e of byName.values()) draftable += setDraftable.run(e.tier, e.teraBanned ? 1 : 0, e.name).changes;
  for (const name of banned) bannedN += setBanned.run(name).changes;
  return { draftable, banned: bannedN };
}

/** Emerald-family leagues → natdex, everything else → natdexplus. */
export function assignLeagueCostFormats(db: Database): number {
  return (
    db.prepare("UPDATE leagues SET cost_format = 'natdex' WHERE id LIKE '%emerald%'").run().changes +
    db.prepare("UPDATE leagues SET cost_format = 'natdexplus' WHERE id NOT LIKE '%emerald%'").run().changes
  );
}

// ─── Standalone entry ────────────────────────────────────────────────────────
if (import.meta.main) {
  const DB_PATH = process.env.CANNOLI_DB_PATH || resolve(import.meta.dir, '../data/cannoli.db');
  const DRY = process.argv.includes('--dry-run');

  if (!existsSync(DB_PATH)) {
    console.error(`DB not found at ${DB_PATH}.`);
    process.exit(1);
  }

  console.log(`\n=== Apply cost formats → ${DB_PATH}${DRY ? ' (dry run)' : ''} ===`);
  for (const format of Object.keys(FORMAT_SHEETS)) {
    const { byName, banned } = parseCostFormat(format);
    console.log(`  ${format.padEnd(11)} (${FORMAT_SHEETS[format]}): ${byName.size} draftable, ${banned.length} banned`);
  }

  const db = new Database(DB_PATH);
  if (DRY) {
    console.log('\nDry run — no changes written.');
    process.exit(0);
  }

  const run = db.transaction(() => {
    const baseline = refreshBaseline(db);
    const written = populateFormatCosts(db);
    const leaguesChanged = assignLeagueCostFormats(db);
    return { baseline, written, leaguesChanged };
  });
  const res = run();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

  console.log('\n=== Applied ===');
  console.log(`  pokemon baseline (NatDex+): ${res.baseline.draftable} draftable, ${res.baseline.banned} banned`);
  for (const [f, n] of Object.entries(res.written)) console.log(`  format_costs[${f}]: ${n} rows`);
  console.log(`  leagues.cost_format assigned: ${res.leaguesChanged}`);

  const byFmt = db.prepare('SELECT cost_format, COUNT(*) c FROM leagues GROUP BY cost_format').all();
  console.log(`  league format breakdown:`, JSON.stringify(byFmt));
}
