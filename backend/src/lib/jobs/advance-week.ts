/**
 * Auto week-advancement — runs hourly. For each regular-phase league:
 *   - if league is paused → skip
 *   - if any current-week match is still scheduled/ready/in_progress → skip (let auto-forfeit resolve first)
 *   - if weekDates[currentWeek+1] is in the past → bump currentWeek
 *
 * Phase / paused / weekDates / currentWeek now all live on the league row,
 * so each league advances independently of its siblings in the same season.
 */

import { db, schema } from '../../db';
import { and, eq, sql } from 'drizzle-orm';
import { tx } from '../tx';

export function runAdvanceWeek() {
  const leagues = db.select().from(schema.leagues)
    .where(and(eq(schema.leagues.phase, 'regular'), eq(schema.leagues.paused, false)))
    .all();

  if (leagues.length === 0) return;

  const now = new Date();

  for (const league of leagues) {
    const weekDates: Record<string, string> = league.weekDates ? JSON.parse(league.weekDates) : {};
    const nextWeek = league.currentWeek + 1;

    if (nextWeek > league.totalWeeks) continue;

    const nextDateStr = weekDates[String(nextWeek)];
    if (!nextDateStr) continue; // no schedule defined → skip
    const nextDate = new Date(nextDateStr);
    if (nextDate.getTime() > now.getTime()) continue; // not yet time

    // Skip if this league has unfinished current-week matches
    const unfinished = db.select({ count: sql<number>`COUNT(*)` })
      .from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, league.id),
        eq(schema.matches.week, league.currentWeek),
        sql`(${schema.matches.status} = 'scheduled' OR ${schema.matches.status} = 'ready' OR ${schema.matches.status} = 'in_progress')`,
      ))
      .get()?.count ?? 0;

    if (unfinished > 0) {
      console.log(`[advance-week] league ${league.id}: ${league.currentWeek} not advancing (unfinished matches)`);
      continue;
    }

    tx(() => {
      db.update(schema.leagues).set({ currentWeek: nextWeek }).where(eq(schema.leagues.id, league.id)).run();
      db.insert(schema.activityLog).values({
        type: 'week_auto_advanced',
        category: 'config',
        actor: 'system',
        leagueId: league.id,
        description: `Auto-advanced ${league.name}: week ${league.currentWeek} → ${nextWeek}`,
        metadata: JSON.stringify({ leagueId: league.id, from: league.currentWeek, to: nextWeek }),
      }).run();
    });

    console.log(`[advance-week] league ${league.id}: ${league.currentWeek} → ${nextWeek}`);
  }
}
