/**
 * Finalize a season's leagues — score any pending finals, advance phase to
 * offseason, and run the full pin-award pipeline.
 *
 * Usage:
 *   bun run scripts/finalize-season.ts                    # finalizes S10
 *   bun run scripts/finalize-season.ts --season=10        # explicit
 *   bun run scripts/finalize-season.ts --league=sapphire  # one league
 *   bun run scripts/finalize-season.ts --dry-run          # preview only
 *
 * What it does, per league:
 *   1. If the finals match is `scheduled` with NULL scores, stamp a
 *      synthetic 4-3 result (higher seed wins). Mirrors the convention used
 *      by `fabricatePlayoffBracket` for S9. Skip if already completed.
 *   2. Run `assignFinishPositions` so champion / runner-up / SF / QF /
 *      regular-season labels stamp onto teams.finish_position/label.
 *   3. Advance leagues.phase = 'offseason' (only if not already there).
 *   4. Mark seasons.archived = 1.
 *   5. Run runAutoAwards(season-end) — mints garchomp / cannoli / cynthia.
 *   6. Run mintArchivePins — mints champion / high-score / steal-of-the-draft
 *      / sweeper.
 *
 * Idempotent: re-running on an already-finalized season simply re-runs steps
 * 5/6 (which are themselves INSERT OR IGNORE + scoped DELETE). Safe.
 *
 * NOT included: the manual award pins (baxcalibur / kingambit / ash /
 * best-draft / dragapult / charizard / florges / rotom / pikachu / red).
 * Those need a hand-curated list and ship via the admin UI's "Award Pin"
 * action or a sibling import script.
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';
import { assignFinishPositions } from './import-xlsx';

const DB_PATH = resolve(import.meta.dir, '../data/cannoli.db');

interface CliArgs {
  season: number;
  league: string | null;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { season: 10, league: null, dryRun: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run' || a === '-n') args.dryRun = true;
    else if (a.startsWith('--season=')) args.season = parseInt(a.slice('--season='.length), 10);
    else if (a.startsWith('--league=')) args.league = a.slice('--league='.length);
  }
  if (!Number.isFinite(args.season)) {
    console.error(`--season must be a number; got '${args.season}'`);
    process.exit(1);
  }
  return args;
}

async function main() {
  const argv = parseArgs();
  console.log(`Finalize: season=${argv.season} league=${argv.league ?? '<all>'} dry-run=${argv.dryRun}`);

  const sqlite = new Database(DB_PATH);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');

  const season = sqlite.prepare(
    `SELECT id, season_number, archived FROM seasons WHERE season_number = ?`,
  ).get(argv.season) as { id: number; season_number: number; archived: number } | undefined;
  if (!season) {
    console.error(`No season with season_number=${argv.season}`);
    sqlite.close();
    process.exit(1);
  }

  let leagueQuery = `SELECT id, phase FROM leagues WHERE season_id = ?`;
  const leagueParams: (string | number)[] = [season.id];
  if (argv.league) {
    leagueQuery += ` AND id = ?`;
    leagueParams.push(argv.league);
  }
  const leagues = sqlite.prepare(leagueQuery).all(...leagueParams) as { id: string; phase: string }[];

  if (leagues.length === 0) {
    console.error('No matching leagues.');
    sqlite.close();
    process.exit(1);
  }

  console.log(`Found ${leagues.length} league(s): ${leagues.map(l => `${l.id}(${l.phase})`).join(', ')}`);

  // 1. Score pending finals
  const finalsToScore: {
    matchId: string;
    leagueId: string;
    homeId: string;
    awayId: string;
    homeSeed: number | null;
    awaySeed: number | null;
  }[] = [];
  for (const l of leagues) {
    const f = sqlite.prepare(
      `SELECT id, home_team_id, away_team_id, home_seed, away_seed, status, home_score, away_score
         FROM matches
        WHERE league_id = ? AND phase = 'playoffs' AND playoff_round = 'f'`,
    ).get(l.id) as {
      id: string; home_team_id: string; away_team_id: string;
      home_seed: number | null; away_seed: number | null;
      status: string; home_score: number | null; away_score: number | null;
    } | undefined;
    if (!f) {
      console.warn(`  ${l.id}: no finals match found, skipping`);
      continue;
    }
    if (f.status === 'completed' && f.home_score != null && f.away_score != null) {
      console.log(`  ${l.id}: finals already scored (${f.home_score}-${f.away_score})`);
      continue;
    }
    finalsToScore.push({
      matchId: f.id,
      leagueId: l.id,
      homeId: f.home_team_id,
      awayId: f.away_team_id,
      homeSeed: f.home_seed,
      awaySeed: f.away_seed,
    });
  }

  // 2-6. Apply changes
  if (argv.dryRun) {
    console.log('\nDry-run plan:');
    for (const f of finalsToScore) {
      const homeBetter = f.homeSeed != null && f.awaySeed != null
        ? f.homeSeed <= f.awaySeed
        : true;
      console.log(`  score finals ${f.matchId} → ${homeBetter ? '4-3 (home wins)' : '3-4 (away wins)'}`);
    }
    for (const l of leagues) {
      if (l.phase !== 'offseason') {
        console.log(`  advance ${l.id} phase ${l.phase} → offseason`);
      }
    }
    if (!season.archived) console.log(`  mark season ${season.season_number} archived`);
    console.log(`  run runAutoAwards(season-end) for ${leagues.length} league(s)`);
    console.log(`  run mintArchivePins for ${leagues.length} league(s)`);
    sqlite.close();
    return;
  }

  const tx = sqlite.transaction(() => {
    // 1. Score finals
    for (const f of finalsToScore) {
      const homeBetter = f.homeSeed != null && f.awaySeed != null
        ? f.homeSeed <= f.awaySeed
        : true;
      const homeScore = homeBetter ? 4 : 3;
      const awayScore = homeBetter ? 3 : 4;
      sqlite.prepare(
        `UPDATE matches
            SET home_score = ?, away_score = ?, status = 'completed',
                completed_at = COALESCE(completed_at, datetime('now'))
          WHERE id = ?`,
      ).run(homeScore, awayScore, f.matchId);
      console.log(`  scored ${f.matchId}: ${homeScore}-${awayScore}`);
    }

    // 2. Stamp finish positions for the affected leagues
    const leagueIds = leagues.map(l => l.id);
    const finish = assignFinishPositions(sqlite, leagueIds);
    console.log(`  stamped ${finish.teamsUpdated} team(s) with finish positions`);

    // 3. Advance phase → offseason
    for (const l of leagues) {
      if (l.phase !== 'offseason') {
        sqlite.prepare(`UPDATE leagues SET phase = 'offseason' WHERE id = ?`).run(l.id);
      }
    }

    // 4. Archive season
    if (!season.archived) {
      sqlite.prepare(`UPDATE seasons SET archived = 1 WHERE id = ?`).run(season.id);
    }
  });
  tx();

  // 5+6. Pin awards (not inside the SQL transaction — runAutoAwards/mintArchivePins
  // open their own writes via the Drizzle layer, and nesting transactions is
  // unsafe in bun:sqlite when both layers reach for BEGIN.)
  sqlite.close();

  const { runAutoAwards } = await import('../src/lib/pins/auto-award');
  const { mintArchivePins } = await import('../src/lib/pins/archive-mint');

  console.log('\nAwarding pins:');
  for (const l of leagues) {
    const auto = runAutoAwards(l.id, { trigger: 'season-end' });
    const archive = mintArchivePins(l.id);
    console.log(
      `  ${l.id}: auto +${auto.awarded.length}/-${auto.skipped}, ` +
      `archive +${archive.awarded.length}/-${archive.skipped}`,
    );
    for (const a of auto.awarded) {
      console.log(`    [auto] ${a.pinDefId} → user#${a.userId}`);
    }
    for (const a of archive.awarded) {
      console.log(`    [archive] ${a.pinDefId} → user#${a.userId}`);
    }
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
