#!/usr/bin/env bun
/**
 * Wire scraped S10 replay JSON files into the matches table.
 *
 * Reads cache produced by scrape-s10-replays.ts under
 *   backend/imports/replays/s10/<league>/<phase>/<...>.json
 *
 * For each cached match record, finds the corresponding `matches` row by
 * (league_id, week|playoff_round, home_team_id, away_team_id) — trying both
 * orientations — and writes `replay_url` + `replay_log`.
 *
 * Idempotent: re-running overwrites with the freshest cache.
 *
 * Designed to be invoked from seed.ts AFTER xlsx import has populated matches.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Database } from 'bun:sqlite';

const REPLAYS_DIR = resolve(import.meta.dir, '../imports/replays/s10');

interface CachedMatch {
  league: 'emerald' | 'ruby' | 'sapphire';
  phase: 'regular' | 'qf' | 'sf' | 'f';
  week?: number;
  matchNumber?: number;
  homeAbbrev: string;
  awayAbbrev: string;
  forfeitSide: 'home' | 'away' | null;
  pageUrl: string;
  replayId: string | null;
  replayUrl: string | null;
  log: string | null;
}

function walkJson(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkJson(full));
    else if (entry.endsWith('.json')) out.push(full);
  }
  return out;
}

export function importReplays(sqlite: Database): {
  updated: number;
  skippedNoReplay: number;
  skippedForfeit: number;
  unmatched: number;
} {
  if (!existsSync(REPLAYS_DIR)) {
    console.log(`  No replay cache at ${REPLAYS_DIR}; skipping`);
    return { updated: 0, skippedNoReplay: 0, skippedForfeit: 0, unmatched: 0 };
  }

  const files = walkJson(REPLAYS_DIR);
  console.log(`  Found ${files.length} cached replay records`);

  const findRegular = sqlite.prepare(
    `SELECT id FROM matches
     WHERE league_id = ? AND week = ?
       AND ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))`,
  );
  const findPlayoff = sqlite.prepare(
    `SELECT id FROM matches
     WHERE league_id = ? AND playoff_round = ?
       AND ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))`,
  );
  const update = sqlite.prepare(
    `UPDATE matches SET replay_url = ?, replay_log = ? WHERE id = ?`,
  );

  let updated = 0;
  let skippedNoReplay = 0;
  let skippedForfeit = 0;
  let unmatched = 0;
  const unmatchedSamples: string[] = [];

  for (const file of files) {
    const data = JSON.parse(readFileSync(file, 'utf-8')) as CachedMatch;

    if (data.forfeitSide && !data.replayId) {
      skippedForfeit++;
      continue;
    }
    if (!data.replayId || !data.log) {
      skippedNoReplay++;
      continue;
    }

    const home = `${data.league}-${data.homeAbbrev}`;
    const away = `${data.league}-${data.awayAbbrev}`;

    let match: { id: string } | undefined;
    if (data.phase === 'regular') {
      match = findRegular.get(data.league, data.week, home, away, away, home) as
        | { id: string }
        | undefined;
    } else {
      match = findPlayoff.get(data.league, data.phase, home, away, away, home) as
        | { id: string }
        | undefined;
    }

    if (!match) {
      unmatched++;
      if (unmatchedSamples.length < 5) {
        unmatchedSamples.push(
          `${data.league} ${data.phase}${data.week ? ' w' + data.week : ''} ${data.homeAbbrev} vs ${data.awayAbbrev}`,
        );
      }
      continue;
    }

    update.run(data.replayUrl, data.log, match.id);
    updated++;
  }

  console.log(
    `  Updated ${updated}; forfeit-skip ${skippedForfeit}; no-replay ${skippedNoReplay}; unmatched ${unmatched}`,
  );
  if (unmatchedSamples.length) {
    console.log(`  Unmatched samples:`);
    for (const s of unmatchedSamples) console.log(`    - ${s}`);
  }

  return { updated, skippedNoReplay, skippedForfeit, unmatched };
}

// Allow running standalone: `bun run scripts/import-replays.ts`
if (import.meta.main) {
  const dbPath = process.env.CANNOLI_DB || resolve(import.meta.dir, '../data/cannoli.db');
  console.log(`Importing replays into ${dbPath}...`);
  const sqlite = new Database(dbPath);
  importReplays(sqlite);
  sqlite.close();
}
