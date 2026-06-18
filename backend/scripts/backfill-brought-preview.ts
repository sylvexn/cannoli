#!/usr/bin/env bun
/**
 * Backfill matches.brought_preview from stored replay_log.
 *
 * The replay card grid wants all 12 brought mons (6 per side, including
 * benched ones that never appeared in battle). match_pokemon only stores
 * appeared mons, so the brought team-of-6 is recovered by re-parsing the
 * stored replay_log (|poke| team-preview lines survive log truncation) and
 * cached in matches.brought_preview as JSON {home: string[], away: string[]}.
 *
 * The live PS bot now writes this cache proactively; this script backfills
 * existing matches and the replay-summary endpoint self-heals on read, so
 * running this is optional — it just warms the cache up front.
 *
 * Scope (REQUIRED — refuses to run with no scope unless --all):
 *   --all              every match with a replay_log
 *   --season=N         matches in leagues of season number N
 *   --league=ID        matches in a single league
 *   --match=ID         a single match
 *   --force            recompute even when brought_preview is already set
 *
 * Run from backend/:  bun run scripts/backfill-brought-preview.ts --all
 */

import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { computeBroughtPreviewFromLog } from '../src/lib/brought-preview';

// Honor CANNOLI_DB_PATH (what the app + deploy boot scripts use) first, then a
// bare DB_PATH override, else the canonical backend/data/cannoli.db — so a live
// backfill targets the same volume DB the running backend does.
const DB_PATH = process.env.CANNOLI_DB_PATH
  ? resolve(process.env.CANNOLI_DB_PATH)
  : process.env.DB_PATH || resolve(import.meta.dir, '../data/cannoli.db');

interface MatchRow {
  id: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  replayLog: string;
  broughtPreview: string | null;
}

function parseArgs(argv: string[]) {
  const flags = {
    all: false,
    force: false,
    season: null as number | null,
    league: null as string | null,
    match: null as string | null,
  };
  for (const arg of argv) {
    if (arg === '--all') flags.all = true;
    else if (arg === '--force') flags.force = true;
    else if (arg.startsWith('--season=')) flags.season = Number(arg.slice('--season='.length));
    else if (arg.startsWith('--league=')) flags.league = arg.slice('--league='.length);
    else if (arg.startsWith('--match=')) flags.match = arg.slice('--match='.length);
  }
  return flags;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));

  const hasScope = flags.all || flags.season != null || flags.league != null || flags.match != null;
  if (!hasScope) {
    console.error('Refusing to run with no scope. Pass --all, --season=N, --league=ID, or --match=ID.');
    process.exit(1);
  }

  const db = new Database(DB_PATH);

  // Build the candidate query from the chosen scope.
  const where: string[] = ['m.replay_log IS NOT NULL'];
  const params: (string | number)[] = [];
  if (!flags.force) where.push('m.brought_preview IS NULL');
  if (flags.match != null) {
    where.push('m.id = ?');
    params.push(flags.match);
  }
  if (flags.league != null) {
    where.push('m.league_id = ?');
    params.push(flags.league);
  }
  if (flags.season != null) {
    where.push(`m.league_id IN (
      SELECT l.id FROM leagues l
      JOIN seasons s ON s.id = l.season_id
      WHERE s.season_number = ?
    )`);
    params.push(flags.season);
  }

  const candidates = db.prepare(
    `SELECT m.id, m.home_team_id AS homeTeamId, m.away_team_id AS awayTeamId,
            m.replay_log AS replayLog, m.brought_preview AS broughtPreview
       FROM matches m
      WHERE ${where.join(' AND ')}`,
  ).all(...params) as MatchRow[];

  console.log(`Found ${candidates.length} candidate match(es).`);

  const recordedStmt = db.prepare(
    `SELECT team_id AS teamId, pokemon_name AS pokemonName
       FROM match_pokemon WHERE match_id = ?`,
  );
  const rosterStmt = db.prepare(
    `SELECT pokemon_name AS pokemonName FROM rosters WHERE team_id = ?`,
  );
  const updateStmt = db.prepare(
    `UPDATE matches SET brought_preview = ? WHERE id = ?`,
  );

  let updated = 0;
  let skipped = 0;
  let undecidable = 0;

  const tx = db.transaction((rows: MatchRow[]) => {
    for (const m of rows) {
      const recorded = recordedStmt.all(m.id) as { teamId: string; pokemonName: string }[];
      const homeRoster = m.homeTeamId
        ? (rosterStmt.all(m.homeTeamId) as { pokemonName: string }[]).map(r => r.pokemonName)
        : [];
      const awayRoster = m.awayTeamId
        ? (rosterStmt.all(m.awayTeamId) as { pokemonName: string }[]).map(r => r.pokemonName)
        : [];

      const computed = computeBroughtPreviewFromLog(m.replayLog, {
        recorded,
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        homeRoster,
        awayRoster,
      });

      if (!computed) {
        undecidable++;
        continue;
      }

      const json = JSON.stringify(computed);
      if (!flags.force && m.broughtPreview === json) {
        skipped++;
        continue;
      }
      updateStmt.run(json, m.id);
      updated++;
    }
  });

  tx(candidates);
  db.close();

  console.log('');
  console.log('── Summary ──');
  console.log(`  updated:     ${updated}`);
  console.log(`  skipped:     ${skipped}`);
  console.log(`  undecidable: ${undecidable}`);
}

if (import.meta.path === Bun.main) {
  main();
}
