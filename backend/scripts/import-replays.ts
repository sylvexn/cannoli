#!/usr/bin/env bun
/**
 * Wire scraped replay JSON files (any season) into the matches table.
 *
 * Reads cache produced by scrape-sN-replays.ts under
 *   backend/imports/replays/s<N>/<league>/<phase>/<...>.json
 *
 * For each season-N directory found, resolves the season's row in `seasons`,
 * then for each cached match record resolves the corresponding `leagues.id`
 * (handles both unprefixed `sapphire` and prefixed `s9-sapphire` schemes that
 * different import scripts produce). Matches the cache record against the
 * `matches` row by (league_id, week|playoff_round, home_team_id, away_team_id)
 * — trying both orientations — and writes `replay_url` + `replay_log`.
 *
 * Idempotent: re-running overwrites with the freshest cache.
 *
 * IMPORTANT: this only writes `matches.replay_url` and `matches.replay_log`.
 * It DOES NOT re-parse the protocol log into `match_pokemon`. For S9 in
 * particular, kill/death/usage stats already come from the historical XLSX
 * import (RawKills sheet) and are the source of truth — re-parsing replay
 * logs (which can disagree on attribution edge cases) would clobber those.
 *
 * Designed to be invoked from seed.ts AFTER xlsx import has populated matches.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Database } from 'bun:sqlite';

const REPLAYS_ROOT = resolve(import.meta.dir, '../imports/replays');

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

interface SeasonStats {
  season: number;
  scanned: number;
  updated: number;
  skippedNoReplay: number;
  skippedForfeit: number;
  unmatched: number;
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

/**
 * Find every season-cache directory under imports/replays/.
 * Returns sorted ascending by season number.
 */
function listSeasonDirs(): { season: number; dir: string }[] {
  if (!existsSync(REPLAYS_ROOT)) return [];
  const out: { season: number; dir: string }[] = [];
  for (const entry of readdirSync(REPLAYS_ROOT)) {
    const m = entry.match(/^s(\d+)$/);
    if (!m) continue;
    const full = join(REPLAYS_ROOT, entry);
    if (!statSync(full).isDirectory()) continue;
    out.push({ season: parseInt(m[1]), dir: full });
  }
  return out.sort((a, b) => a.season - b.season);
}

/**
 * Resolve a base league slug (`sapphire`/`ruby`/`emerald`) to the actual
 * `leagues.id` for the given season. Different import paths use different
 * prefix schemes (`sapphire` vs `s9-sapphire`), so we look up by season + name.
 */
function buildLeagueResolver(
  sqlite: Database,
  seasonNumber: number,
): (baseSlug: string) => string | null {
  const seasonRow = sqlite
    .prepare('SELECT id FROM seasons WHERE season_number = ?')
    .get(seasonNumber) as { id: number } | undefined;
  if (!seasonRow) return () => null;

  const lookup = sqlite.prepare(
    `SELECT id FROM leagues
     WHERE season_id = ?
       AND (id = ? OR id = ? OR LOWER(name) LIKE ?)`,
  );
  const cache = new Map<string, string | null>();
  return (baseSlug: string) => {
    if (cache.has(baseSlug)) return cache.get(baseSlug)!;
    const prefixed = `s${seasonNumber}-${baseSlug}`;
    const row = lookup.get(seasonRow.id, baseSlug, prefixed, `${baseSlug}%`) as
      | { id: string }
      | undefined;
    const id = row?.id ?? null;
    cache.set(baseSlug, id);
    return id;
  };
}

function importSeasonReplays(
  sqlite: Database,
  season: number,
  dir: string,
): SeasonStats {
  const stats: SeasonStats = {
    season,
    scanned: 0,
    updated: 0,
    skippedNoReplay: 0,
    skippedForfeit: 0,
    unmatched: 0,
  };

  const files = walkJson(dir);
  stats.scanned = files.length;
  if (files.length === 0) return stats;

  const resolveLeague = buildLeagueResolver(sqlite, season);

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

  const unmatchedSamples: string[] = [];
  const missingLeagues = new Set<string>();

  for (const file of files) {
    const data = JSON.parse(readFileSync(file, 'utf-8')) as CachedMatch;

    if (data.forfeitSide && !data.replayId) {
      stats.skippedForfeit++;
      continue;
    }
    if (!data.replayId || !data.log) {
      stats.skippedNoReplay++;
      continue;
    }

    const leagueId = resolveLeague(data.league);
    if (!leagueId) {
      missingLeagues.add(data.league);
      stats.unmatched++;
      continue;
    }

    const home = `${leagueId}-${data.homeAbbrev}`;
    const away = `${leagueId}-${data.awayAbbrev}`;

    let match: { id: string } | undefined;
    if (data.phase === 'regular') {
      match = findRegular.get(leagueId, data.week, home, away, away, home) as
        | { id: string }
        | undefined;
    } else {
      match = findPlayoff.get(leagueId, data.phase, home, away, away, home) as
        | { id: string }
        | undefined;
    }

    if (!match) {
      stats.unmatched++;
      if (unmatchedSamples.length < 5) {
        unmatchedSamples.push(
          `${data.league} ${data.phase}${data.week ? ' w' + data.week : ''} ${data.homeAbbrev} vs ${data.awayAbbrev}`,
        );
      }
      continue;
    }

    update.run(data.replayUrl, data.log, match.id);
    stats.updated++;
  }

  console.log(
    `  S${season}: scanned ${stats.scanned}; updated ${stats.updated}; forfeit-skip ${stats.skippedForfeit}; no-replay ${stats.skippedNoReplay}; unmatched ${stats.unmatched}`,
  );
  if (missingLeagues.size) {
    console.log(
      `    No matching leagues row for season ${season}: ${[...missingLeagues].join(', ')}`,
    );
  }
  if (unmatchedSamples.length) {
    console.log(`    Unmatched samples:`);
    for (const s of unmatchedSamples) console.log(`      - ${s}`);
  }

  return stats;
}

export function importReplays(sqlite: Database): SeasonStats[] {
  const seasonDirs = listSeasonDirs();
  if (seasonDirs.length === 0) {
    console.log(`  No replay cache at ${REPLAYS_ROOT}; skipping`);
    return [];
  }

  console.log(
    `  Found cache for ${seasonDirs.length} season(s): ${seasonDirs.map((s) => 's' + s.season).join(', ')}`,
  );

  const all: SeasonStats[] = [];
  for (const { season, dir } of seasonDirs) {
    all.push(importSeasonReplays(sqlite, season, dir));
  }
  return all;
}

// Allow running standalone: `bun run scripts/import-replays.ts`
if (import.meta.main) {
  const dbPath = process.env.CANNOLI_DB || resolve(import.meta.dir, '../data/cannoli.db');
  console.log(`Importing replays into ${dbPath}...`);
  const sqlite = new Database(dbPath);
  importReplays(sqlite);
  sqlite.close();
}
