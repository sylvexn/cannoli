/**
 * One-shot: re-read the per-team color band (B2 fill) from each league's XLSX
 * and update the `teams.team_color` column in place. Does NOT touch any other
 * data — safe to run on a live dev/mock DB.
 *
 * Maps each XLSX file to a leagueId by filename → season + league color name.
 * If a league has no rows in the DB it is silently skipped.
 *
 * Usage: bun run scripts/sync-team-colors.ts
 */

import XLSX from 'xlsx';
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const IMPORTS_DIR = resolve(import.meta.dir, '../imports');
const DB_PATH = resolve(import.meta.dir, '../data/cannoli.db');

interface FileMap {
  file: string;
  /** matches against leagues.id; we resolve dynamically based on season + color name */
  leagueColor: 'sapphire' | 'ruby' | 'emerald';
  seasonNumber: number;
}

const FILES: FileMap[] = [
  { file: 'Cannoli Sapphire Season 10.xlsx', leagueColor: 'sapphire', seasonNumber: 10 },
  { file: 'Cannoli Ruby Season 10.xlsx', leagueColor: 'ruby', seasonNumber: 10 },
  { file: 'Cannoli Emerald Season 10.xlsx', leagueColor: 'emerald', seasonNumber: 10 },
  { file: 'Cannoli Sapphire Season 9.xlsx', leagueColor: 'sapphire', seasonNumber: 9 },
  { file: 'Cannoli Ruby Season 9.xlsx', leagueColor: 'ruby', seasonNumber: 9 },
  { file: 'Cannoli Emerald Season 9 .xlsx', leagueColor: 'emerald', seasonNumber: 9 },
  { file: 'Cannoli Sapphire Season 11.xlsx', leagueColor: 'sapphire', seasonNumber: 11 },
  { file: 'Cannoli Ruby Season 11.xlsx', leagueColor: 'ruby', seasonNumber: 11 },
  { file: 'Cannoli Emerald Season 11.xlsx', leagueColor: 'emerald', seasonNumber: 11 },
];

function readTeamColorFromSheet(wb: XLSX.WorkBook, abbrev: string): string | null {
  const ws = wb.Sheets[abbrev];
  if (!ws) return null;
  const cell = ws['B2'];
  const rgb = cell?.s?.fgColor?.rgb ?? cell?.s?.bgColor?.rgb;
  if (typeof rgb !== 'string' || !/^[0-9A-Fa-f]{6}$/.test(rgb)) return null;
  if (/^(000000|FFFFFF|EFEFEF|434343|666666)$/i.test(rgb)) return null;
  return `#${rgb.toUpperCase()}`;
}

const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

let totalUpdated = 0;
let totalSkipped = 0;

for (const fm of FILES) {
  const path = resolve(IMPORTS_DIR, fm.file);
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.readFile(path, { cellStyles: true });
  } catch {
    console.log(`skip ${fm.file} (not found)`);
    continue;
  }

  // Find leagueId(s) for this file. For S10 the leagues use bare ids
  // ('sapphire','ruby','emerald'); S9 uses 's9-<name>'; S11 will use 's11-<name>'.
  // We just resolve by season + name match.
  const candidateIds = fm.seasonNumber === 10
    ? [fm.leagueColor]
    : [`s${fm.seasonNumber}-${fm.leagueColor}`];

  // Filter to leagues that actually exist in this DB.
  const leagueRow = candidateIds
    .map(id => db.prepare('SELECT id FROM leagues WHERE id = ?').get(id) as { id: string } | undefined)
    .find(r => r);

  if (!leagueRow) {
    console.log(`skip ${fm.file} (no matching league row)`);
    continue;
  }
  const leagueId = leagueRow.id;

  const teams = db.prepare(
    'SELECT id, team_abbrev, team_color FROM teams WHERE league_id = ?',
  ).all(leagueId) as { id: string; team_abbrev: string; team_color: string }[];

  console.log(`\n${fm.file} → ${leagueId} (${teams.length} teams)`);

  for (const t of teams) {
    const next = readTeamColorFromSheet(wb, t.team_abbrev);
    if (!next) {
      console.log(`  ${t.team_abbrev.padEnd(4)} no color in sheet, kept ${t.team_color}`);
      totalSkipped++;
      continue;
    }
    if (next.toLowerCase() === t.team_color.toLowerCase()) {
      console.log(`  ${t.team_abbrev.padEnd(4)} already ${next}`);
      continue;
    }
    db.prepare('UPDATE teams SET team_color = ? WHERE id = ?').run(next, t.id);
    console.log(`  ${t.team_abbrev.padEnd(4)} ${t.team_color} → ${next}`);
    totalUpdated++;
  }
}

console.log(`\nDone — ${totalUpdated} updated, ${totalSkipped} skipped (no color in sheet).`);
db.close();
