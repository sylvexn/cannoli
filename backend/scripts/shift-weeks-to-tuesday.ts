/**
 * shift-weeks-to-tuesday.ts — re-anchor each league week from a Monday start to
 * the TUESDAY of that week, so league weeks run Tue→Mon. A week's deadline is
 * derived (deadline.ts) as the end of the day BEFORE the next week begins, so
 * moving each start Mon→Tue moves the cutoff from Sunday night to Monday night —
 * i.e. matches resolve end-of-Monday and Monday becomes the last day of the
 * week (which is also what the replay "This Week"/"Last Week" filter pivots on,
 * since the advance-week job flips currentWeek on that same boundary).
 *
 * Idempotent: a date already on Tuesday is left alone; any other weekday snaps
 * FORWARD to the next Tuesday (≤6 days), so a Monday moves +1 day.
 *
 * Targets every NON-ARCHIVED league (the current season) by default; pass a
 * league id to limit to one. Dry-run by default; --apply writes.
 *
 * After --apply, run scripts/resync-deadlines.ts --apply to push the new
 * end-of-week cutoffs onto open match rows.
 *
 *   bun run scripts/shift-weeks-to-tuesday.ts                # dry-run, all live leagues
 *   bun run scripts/shift-weeks-to-tuesday.ts sapphire       # dry-run, one league
 *   bun run scripts/shift-weeks-to-tuesday.ts --apply        # write
 */
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { scheduleDeadline } from '../src/lib/deadline';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const onlyLeague = args.find(a => !a.startsWith('--')) ?? null;

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Days to add to reach the next Tuesday (0 if already Tuesday). UTC date math. */
function snapToTuesday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const dow = new Date(base).getUTCDay(); // 0=Sun..6=Sat
  const delta = (2 - dow + 7) % 7; // Tue = 2
  const dt = new Date(base + delta * 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

function weekday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

const rows = db.select({
  id: schema.leagues.id,
  weekDates: schema.leagues.weekDates,
  currentWeek: schema.leagues.currentWeek,
  tz: schema.leagues.timezone,
  archived: schema.seasons.archived,
  seasonNumber: schema.seasons.seasonNumber,
}).from(schema.leagues)
  .innerJoin(schema.seasons, eq(schema.leagues.seasonId, schema.seasons.id))
  .all();

const targets = rows.filter(r => !r.archived && (!onlyLeague || r.id === onlyLeague));

if (targets.length === 0) {
  console.log(`No non-archived leagues${onlyLeague ? ` matching '${onlyLeague}'` : ''}.`);
  process.exit(0);
}

console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}  ·  ${targets.length} league(s)\n`);

let changedLeagues = 0, changedWeeks = 0;

for (const lg of targets) {
  if (!lg.weekDates) {
    console.log(`── ${lg.id} (S${lg.seasonNumber}) — no weekDates, skip ──\n`);
    continue;
  }
  let map: Record<string, string>;
  try {
    map = JSON.parse(lg.weekDates);
  } catch {
    console.log(`── ${lg.id} (S${lg.seasonNumber}) — unparseable weekDates, skip ──\n`);
    continue;
  }

  const next: Record<string, string> = {};
  const lines: string[] = [];
  let leagueChanged = false;
  for (const w of Object.keys(map).map(Number).sort((a, b) => a - b)) {
    const old = map[String(w)];
    const neu = snapToTuesday(old);
    next[String(w)] = neu;
    if (neu !== old) { leagueChanged = true; changedWeeks++; }
    const marker = w === lg.currentWeek ? '   <- currentWeek' : '';
    const tag = neu !== old ? '' : '  (unchanged)';
    lines.push(`  W${String(w).padStart(2)}  ${old} ${weekday(old)} -> ${neu} ${weekday(neu)}${tag}${marker}`);
  }

  const oldDl = scheduleDeadline(map, lg.currentWeek, lg.tz);
  const newDl = scheduleDeadline(next, lg.currentWeek, lg.tz);

  console.log(`── ${lg.id} (S${lg.seasonNumber}, tz=${lg.tz}, currentWeek=${lg.currentWeek}) ──`);
  console.log(lines.join('\n'));
  console.log(`  current-week deadline: ${oldDl ?? 'null'} -> ${newDl ?? 'null'}`);

  if (leagueChanged) {
    changedLeagues++;
    if (APPLY) {
      db.update(schema.leagues).set({ weekDates: JSON.stringify(next) }).where(eq(schema.leagues.id, lg.id)).run();
      console.log('  WROTE weekDates.');
    }
  } else {
    console.log('  no change (already Tuesday-anchored).');
  }
  console.log('');
}

console.log(`Summary: ${changedLeagues} league(s), ${changedWeeks} week(s) re-anchored to Tuesday.`);
console.log(APPLY
  ? 'Applied. Next:  bun run scripts/resync-deadlines.ts --apply'
  : 'Dry-run only — re-run with --apply to write.');
