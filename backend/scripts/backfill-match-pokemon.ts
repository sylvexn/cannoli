#!/usr/bin/env bun
/**
 * Backfill match_pokemon rows from stored replay_log for matches that have
 * a log but no per-Pokemon K/D entries. Bridges the gap between the replay
 * scraper (which only writes replay_url/replay_log) and the live PS bot
 * pipeline (which writes match_pokemon as battles complete).
 *
 * Skips:
 *   - matches with no replay_log
 *   - matches that already have match_pokemon rows (idempotent re-runs)
 *   - S9 leagues (historical XLSX RawKills sheet is the source of truth;
 *     re-parsing logs would clobber kill attribution edge cases — see the
 *     same note in scripts/import-replays.ts)
 *
 * Side resolution (which PS player → which Cannoli team):
 *   1. Try team-owner PS username (toUserid(user.username)) — same join
 *      key the live bot uses (refreshUserMap in ps-bot.ts).
 *   2. Fall back to roster overlap — count Pokemon-name matches between
 *      each PS side's |poke| preview and each Cannoli team's roster.
 *      Highest-overlap pairing wins.
 *   3. If both signals are silent or contradictory, skip the match
 *      (logged) rather than guess.
 *
 * Run from backend/:  bun run scripts/backfill-match-pokemon.ts
 */

import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { ReplayParser } from '../src/lib/replay-parser';
import { toUserid } from '../src/lib/ps-login';
import { resolveRosterPokemonName } from '../src/lib/pokedex';

const DB_PATH = process.env.DB_PATH || resolve(import.meta.dir, '../data/cannoli.db');

interface MatchRow {
  id: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  replayLog: string;
}

export interface BackfillStats {
  scanned: number;
  parsed: number;
  inserted: number;
  skippedS9: number;
  skippedAmbiguous: number;
  skippedNoMons: number;
  ambiguousSamples: string[];
}

export interface BackfillOptions {
  /**
   * Skip S9 leagues. Default true — the import-replays.ts comment claims
   * S9 historical XLSX RawKills are the source of truth, though as of
   * 2026-05 this DB has no match_pokemon rows for S9 anyway, so flipping
   * to false is the way to actually populate the S9 replay previews.
   */
  skipS9?: boolean;
}

/**
 * Backfill match_pokemon for every match with a stored replay_log but no
 * per-Pokemon entries. Idempotent — safe to call repeatedly. Pass an
 * already-open Database (e.g. from the seed pipeline) to share the
 * connection/transaction; pass nothing to open one against DB_PATH.
 */
export function backfillMatchPokemon(database?: Database, opts: BackfillOptions = {}): BackfillStats {
  const db = database ?? new Database(DB_PATH);
  const ownsDb = !database;
  const skipS9 = opts.skipS9 ?? true;

  // Build season → leagueIds index so we can skip S9 cheaply.
  const s9LeagueIds = skipS9 ? new Set(
    (db.prepare(
      `SELECT l.id FROM leagues l
       JOIN seasons s ON s.id = l.season_id
       WHERE s.season_number = 9`,
    ).all() as { id: string }[]).map(r => r.id),
  ) : new Set<string>();
  if (skipS9) console.log(`Skipping ${s9LeagueIds.size} S9 leagues (pass --include-s9 to override)`);

  // Candidate matches: have a log, lack match_pokemon entries.
  const candidates = db.prepare(
    `SELECT m.id, m.league_id AS leagueId, m.home_team_id AS homeTeamId,
            m.away_team_id AS awayTeamId, m.replay_log AS replayLog
       FROM matches m
      WHERE m.replay_log IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM match_pokemon mp WHERE mp.match_id = m.id)`,
  ).all() as MatchRow[];

  console.log(`Found ${candidates.length} matches missing match_pokemon`);

  // Lookups reused per match
  const teamOwnerUserid = db.prepare(
    `SELECT u.username AS username
       FROM teams t
       LEFT JOIN users u ON u.id = t.user_id
      WHERE t.id = ?`,
  );
  const rosterByTeam = db.prepare(
    `SELECT pokemon_name AS pokemonName FROM rosters WHERE team_id = ?`,
  );
  const insertMon = db.prepare(
    `INSERT INTO match_pokemon
      (match_id, team_id, pokemon_name, kills, deaths, tera_used, tera_type)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  let inserted = 0;
  let parsed = 0;
  let skippedS9 = 0;
  let skippedAmbiguous = 0;
  let skippedNoMons = 0;
  const ambiguousSamples: string[] = [];

  // Cache each team's drafted roster names so a battle-log mon name resolves to
  // its exact roster slot (Mega/Primal + in-battle transform formes). Rosters
  // don't change during the run, so this is safe to memoize across matches.
  const rosterNameCache = new Map<string, string[]>();
  const rosterNamesFor = (teamId: string): string[] => {
    let names = rosterNameCache.get(teamId);
    if (!names) {
      names = (rosterByTeam.all(teamId) as { pokemonName: string }[]).map(r => r.pokemonName);
      rosterNameCache.set(teamId, names);
    }
    return names;
  };

  // Wrap in a single transaction — fast + atomic.
  const tx = db.transaction((rows: MatchRow[]) => {
    for (const m of rows) {
      if (s9LeagueIds.has(m.leagueId)) {
        skippedS9++;
        continue;
      }

      let result;
      try {
        result = ReplayParser.parse(m.replayLog);
      } catch (err) {
        console.warn(`[parse-error] ${m.id}: ${(err as Error).message}`);
        continue;
      }
      parsed++;

      if (result.pokemon.length === 0) {
        skippedNoMons++;
        continue;
      }

      // Side → team mapping
      const homeUser = teamOwnerUserid.get(m.homeTeamId) as { username: string | null } | undefined;
      const awayUser = teamOwnerUserid.get(m.awayTeamId) as { username: string | null } | undefined;
      const homeUserid = homeUser?.username ? toUserid(homeUser.username) : '';
      const awayUserid = awayUser?.username ? toUserid(awayUser.username) : '';

      const p1Userid = toUserid(result.players.p1 || '');
      const p2Userid = toUserid(result.players.p2 || '');

      let p1Team: string | null = null;
      let p2Team: string | null = null;

      if (homeUserid && p1Userid === homeUserid) p1Team = m.homeTeamId;
      else if (awayUserid && p1Userid === awayUserid) p1Team = m.awayTeamId;

      if (homeUserid && p2Userid === homeUserid) p2Team = m.homeTeamId;
      else if (awayUserid && p2Userid === awayUserid) p2Team = m.awayTeamId;

      // Roster fallback — score each (PS side → Cannoli team) pairing by
      // species overlap. Higher = better. Only used to fill in or arbitrate
      // mappings the username pass missed.
      if (!p1Team || !p2Team) {
        const homeRoster = new Set((rosterByTeam.all(m.homeTeamId) as { pokemonName: string }[])
          .map(r => r.pokemonName.toLowerCase()));
        const awayRoster = new Set((rosterByTeam.all(m.awayTeamId) as { pokemonName: string }[])
          .map(r => r.pokemonName.toLowerCase()));

        const p1Mons = result.pokemon.filter(p => p.player === 'p1').map(p => p.species.toLowerCase());
        const p2Mons = result.pokemon.filter(p => p.player === 'p2').map(p => p.species.toLowerCase());

        const score = (mons: string[], roster: Set<string>) =>
          mons.reduce((n, s) => n + (roster.has(s) ? 1 : 0), 0);

        const p1Home = score(p1Mons, homeRoster);
        const p1Away = score(p1Mons, awayRoster);
        const p2Home = score(p2Mons, homeRoster);
        const p2Away = score(p2Mons, awayRoster);

        // Prefer the orientation with the higher combined match count.
        const p1HomeP2Away = p1Home + p2Away;
        const p1AwayP2Home = p1Away + p2Home;

        if (p1HomeP2Away > p1AwayP2Home && p1HomeP2Away > 0) {
          p1Team ??= m.homeTeamId;
          p2Team ??= m.awayTeamId;
        } else if (p1AwayP2Home > p1HomeP2Away && p1AwayP2Home > 0) {
          p1Team ??= m.awayTeamId;
          p2Team ??= m.homeTeamId;
        }
      }

      if (!p1Team || !p2Team || p1Team === p2Team) {
        skippedAmbiguous++;
        if (ambiguousSamples.length < 8) {
          ambiguousSamples.push(
            `${m.id} (p1=${result.players.p1 || '?'} p2=${result.players.p2 || '?'})`,
          );
        }
        continue;
      }

      for (const mon of result.pokemon) {
        if (!mon.appeared) continue;
        const teamId = mon.player === 'p1' ? p1Team : p2Team;
        insertMon.run(
          m.id,
          teamId,
          // Resolve to the team's exact drafted roster name so per-Pokemon K/D
          // JOINs the roster entry by exact string.
          resolveRosterPokemonName(rosterNamesFor(teamId), mon.species),
          mon.kills,
          mon.deaths,
          mon.teraUsed ? 1 : 0,
          mon.teraType ?? null,
        );
        inserted++;
      }
    }
  });

  tx(candidates);

  if (ownsDb) db.close();

  return {
    scanned: candidates.length,
    parsed,
    inserted,
    skippedS9,
    skippedAmbiguous,
    skippedNoMons,
    ambiguousSamples,
  };
}

// CLI entry point — `bun run scripts/backfill-match-pokemon.ts [--include-s9]`.
if (import.meta.path === Bun.main) {
  const includeS9 = process.argv.includes('--include-s9');
  const stats = backfillMatchPokemon(undefined, { skipS9: !includeS9 });
  console.log('');
  console.log('── Summary ──');
  console.log(`  scanned:           ${stats.scanned}`);
  console.log(`  parsed:            ${stats.parsed}`);
  console.log(`  inserted rows:     ${stats.inserted}`);
  console.log(`  skipped (S9):      ${stats.skippedS9}`);
  console.log(`  skipped (no mons): ${stats.skippedNoMons}`);
  console.log(`  skipped (mapping): ${stats.skippedAmbiguous}`);
  if (stats.ambiguousSamples.length > 0) {
    console.log('  ambiguous samples:');
    for (const s of stats.ambiguousSamples) console.log('    -', s);
  }
}
