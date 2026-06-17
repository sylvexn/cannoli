/**
 * resync-deadlines.ts — repair tool for the "stale baked deadline" regression.
 *
 * Match deadlines used to be baked onto each row at schedule-generation time
 * and the auto-forfeit job preferred that literal value over the live schedule.
 * So after a league's dates were corrected (weekDates edited), the hourly
 * auto-forfeit kept firing off the OLD dates and flipped live fixtures to
 * `completed` (double_forfeit) / `disputed` (admin_review) — which then vanish
 * from the Arena (getPlayableMatches only surfaces scheduled/ready/in_progress).
 *
 * The code fix makes deadlines schedule-first, so this won't recur. This script
 * repairs the matches already wrongly forfeited:
 *
 *   1. Resyncs the stored `deadline` column on every still-open regular fixture
 *      to the live schedule (keeps admin views honest).
 *   2. Un-forfeits regular matches that were auto-forfeited but, under the
 *      CORRECTED schedule, are NOT actually past deadline — resetting them to
 *      `scheduled` and clearing the forfeit fields. A match that is still
 *      genuinely overdue under the corrected schedule is left forfeited (the
 *      cron would just re-decide it) and reported separately.
 *
 * Dry-run by default. Pass --apply to write. Optional first positional arg
 * limits to one league id (else every regular-phase, non-paused league).
 *
 *   bun run scripts/resync-deadlines.ts                 # dry-run, all leagues
 *   bun run scripts/resync-deadlines.ts s11-sapphire    # dry-run, one league
 *   bun run scripts/resync-deadlines.ts --apply         # write, all leagues
 *   bun run scripts/resync-deadlines.ts s11-sapphire --apply
 */
import { db, schema } from '../src/db';
import { and, eq, sql } from 'drizzle-orm';
import { effectiveMatchDeadline, scheduleDeadline } from '../src/lib/deadline';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const onlyLeague = args.find(a => !a.startsWith('--')) ?? null;

const now = new Date().toISOString();

const leagues = db.select().from(schema.leagues)
  .where(and(eq(schema.leagues.phase, 'regular'), eq(schema.leagues.paused, false)))
  .all()
  .filter(l => !onlyLeague || l.id === onlyLeague);

if (leagues.length === 0) {
  console.log(`No regular-phase, non-paused leagues${onlyLeague ? ` matching '${onlyLeague}'` : ''}.`);
  process.exit(0);
}

console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}  ·  now=${now}\n`);

let resynced = 0, reverted = 0, leftForfeited = 0;

for (const league of leagues) {
  const tz = league.timezone;
  const weekDates = league.weekDates;
  console.log(`── ${league.id}  (tz=${tz}, currentWeek=${league.currentWeek}) ──`);

  // (1) Resync stored deadline on still-open regular fixtures.
  const open = db.select().from(schema.matches).where(and(
    eq(schema.matches.leagueId, league.id),
    eq(schema.matches.phase, 'regular'),
    sql`(${schema.matches.status} = 'scheduled' OR ${schema.matches.status} = 'ready')`,
  )).all();
  for (const m of open) {
    const fresh = scheduleDeadline(weekDates, m.week, tz);
    if (fresh !== m.deadline) {
      console.log(`  resync  ${m.id}  w${m.week}  ${m.deadline ?? 'null'} -> ${fresh ?? 'null'}`);
      if (APPLY) db.update(schema.matches).set({ deadline: fresh }).where(eq(schema.matches.id, m.id)).run();
      resynced++;
    }
  }

  // (2) Un-forfeit regular matches auto-forfeited but not actually overdue now.
  //   double_forfeit signature: completed, forfeitedBy='both', 0-0.
  //   admin_review signature:   disputed with an auto-forfeit warning.
  const forfeited = db.select().from(schema.matches).where(and(
    eq(schema.matches.leagueId, league.id),
    eq(schema.matches.phase, 'regular'),
    sql`(
      (${schema.matches.status} = 'completed' AND ${schema.matches.forfeitedBy} = 'both'
        AND ${schema.matches.homeScore} = 0 AND ${schema.matches.awayScore} = 0)
      OR (${schema.matches.status} = 'disputed' AND ${schema.matches.warnings} LIKE '%Auto-forfeit%')
    )`,
  )).all();

  for (const m of forfeited) {
    const deadline = effectiveMatchDeadline({ deadline: m.deadline, week: m.week }, weekDates, tz);
    const overdue = deadline != null && deadline < now;
    if (overdue) {
      console.log(`  keep    ${m.id}  w${m.week}  still overdue under corrected schedule (deadline=${deadline})`);
      leftForfeited++;
      continue;
    }
    console.log(`  REVERT  ${m.id}  w${m.week}  (${m.status}) -> scheduled  [corrected deadline=${deadline ?? 'null'}]`);
    if (APPLY) {
      db.update(schema.matches).set({
        status: 'scheduled',
        homeScore: null,
        awayScore: null,
        forfeitedBy: null,
        winnerTeamId: null,
        completedAt: null,
        warnings: null,
        readyHome: false,
        readyAway: false,
        deadline: scheduleDeadline(weekDates, m.week, tz),
      }).where(eq(schema.matches.id, m.id)).run();
    }
    reverted++;
  }
  console.log('');
}

console.log(`Summary: ${resynced} deadline resync, ${reverted} un-forfeited, ${leftForfeited} left forfeited (genuinely overdue).`);
console.log(APPLY ? 'Applied.' : 'Dry-run only — re-run with --apply to write.');
