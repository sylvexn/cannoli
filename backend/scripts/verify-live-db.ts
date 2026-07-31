#!/usr/bin/env bun
/**
 * verify-live-db.ts — assert a built live DB artifact matches the launch
 * runbook's "verify the artifact" step (live data migration, step 2).
 *
 * USAGE
 *   bun run scripts/verify-live-db.ts [DB_PATH]
 *   bun run scripts/verify-live-db.ts /tmp/cannoli-live-built.db
 *
 * Defaults to ./data/cannoli.db. Exits 0 if every invariant holds, 1 otherwise.
 *
 * This is the gate between "CANNOLI_MODE=live bun run seed:fresh" and "scp the
 * artifact onto the live volume". Run it on the artifact BEFORE shipping — a
 * red check here means do NOT ship.
 *
 * Invariants (verified against a real live build on 2026-05-25):
 *   - seasons = exactly {9 archived, 10 archived}; no other seasons (S11 is
 *     created separately on launch day, not by this build).
 *   - 6 leagues: 3 with `s9-` prefix (S9) + 3 bare (emerald/ruby/sapphire = S10);
 *     ALL in phase=offseason.
 *   - 6 finals (playoff_round='f'), all status=completed with both scores set.
 *   - S10 champions (finish_position=1): emerald=ABS, ruby=VGK, sapphire=DWG.
 *   - trades = 0 (no mock trade proposals leak into the live DB).
 *   - integrity_check = ok, foreign_key_check empty.
 */

import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const dbPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dir, '../data/cannoli.db');

const db = new Database(dbPath, { readonly: true });

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log(`\nCannoli — Live DB Artifact Verification`);
console.log(`========================================`);
console.log(`DB: ${dbPath}\n`);

// Integrity
const integ = (db.query(`PRAGMA integrity_check`).get() as { integrity_check: string }).integrity_check;
check('integrity_check = ok', integ === 'ok', integ);
const fkViolations = db.query(`PRAGMA foreign_key_check`).all();
check('no foreign-key violations', fkViolations.length === 0, `${fkViolations.length} violation(s)`);

// Seasons: exactly {9 archived, 10 archived}
const seasons = db.query(`SELECT season_number AS n, archived FROM seasons ORDER BY season_number`).all() as {
  n: number; archived: number;
}[];
check('exactly 2 seasons', seasons.length === 2, JSON.stringify(seasons));
const s9 = seasons.find((s) => s.n === 9);
const s10 = seasons.find((s) => s.n === 10);
check('S9 present and archived', !!s9 && s9.archived === 1);
check('S10 present and archived', !!s10 && s10.archived === 1);
const s11 = seasons.find((s) => s.n === 11);
check('S11 NOT present (launches separately)', !s11);

// Leagues: 6 total (3 s9-* + 3 S10), all offseason
const leagues = db.query(`SELECT id, phase FROM leagues ORDER BY id`).all() as { id: string; phase: string }[];
check('exactly 6 leagues', leagues.length === 6, JSON.stringify(leagues.map((l) => l.id)));
const s9Leagues = leagues.filter((l) => l.id.startsWith('s9-'));
const s10Leagues = leagues.filter((l) => !l.id.startsWith('s9-'));
check('3 S9 leagues (s9- prefix)', s9Leagues.length === 3, JSON.stringify(s9Leagues.map((l) => l.id)));
check('3 S10 leagues (bare ids)', s10Leagues.length === 3, JSON.stringify(s10Leagues.map((l) => l.id)));
const allOffseason = leagues.every((l) => l.phase === 'offseason');
check('all leagues phase=offseason', allOffseason, JSON.stringify(leagues));

// Finals: 6, completed + scored
const finals = db.query(
  `SELECT league_id, home_score AS hs, away_score AS as_, status FROM matches WHERE playoff_round = 'f'`,
).all() as { league_id: string; hs: number | null; as_: number | null; status: string }[];
check('6 finals (playoff_round=f)', finals.length === 6, `${finals.length}`);
const scoredFinals = finals.filter((f) => f.status === 'completed' && f.hs != null && f.as_ != null);
check('all 6 finals completed + scored', scoredFinals.length === 6, `${scoredFinals.length}/6`);

// Champions
const champs = db.query(
  `SELECT league_id, team_abbrev FROM teams WHERE finish_position = 1 AND league_id IN ('emerald','ruby','sapphire')`,
).all() as { league_id: string; team_abbrev: string }[];
const champMap = Object.fromEntries(champs.map((c) => [c.league_id, c.team_abbrev]));
check('S10 emerald champion = ABS', champMap['emerald'] === 'ABS', champMap['emerald']);
check('S10 ruby champion = VGK', champMap['ruby'] === 'VGK', champMap['ruby']);
check('S10 sapphire champion = DWG', champMap['sapphire'] === 'DWG', champMap['sapphire']);

// Trades
const tradeCount = (db.query(`SELECT count(*) AS c FROM trades`).get() as { c: number }).c;
check('trades = 0 (no mock data leaked)', tradeCount === 0, `${tradeCount}`);

console.log('');
console.log('─'.repeat(60));
if (failures === 0) {
  console.log('All artifact checks green — safe to ship to the live volume.');
} else {
  console.log(`${failures} check(s) FAILED — do NOT ship this artifact.`);
}
console.log('─'.repeat(60) + '\n');

db.close();
process.exit(failures === 0 ? 0 : 1);
