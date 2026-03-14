/**
 * Auto week-advancement — runs hourly. For each regular-phase league:
 *   - if season is paused → skip
 *   - if any current-week match is still scheduled/ready/in_progress → skip (let auto-forfeit resolve first)
 *   - if weekDates[currentWeek+1] is in the past → bump currentWeek
 */

import { db, schema } from '../../db';
import { and, eq, sql } from 'drizzle-orm';
import { tx } from '../tx';

export function runAdvanceWeek() {
  const seasons = db.select().from(schema.seasons)
    .where(and(eq(schema.seasons.phase, 'regular'), eq(schema.seasons.paused, false)))
    .all();

  if (seasons.length === 0) return;

  const now = new Date();

  for (const season of seasons) {
    const weekDates: Record<string, string> = season.weekDates ? JSON.parse(season.weekDates) : {};
    const nextWeek = season.currentWeek + 1;

    if (nextWeek > season.totalWeeks) continue;

    const nextDateStr = weekDates[String(nextWeek)];
    if (!nextDateStr) continue; // no schedule defined → skip
    const nextDate = new Date(nextDateStr);
    if (nextDate.getTime() > now.getTime()) continue; // not yet time

    // Skip if any leagues in this season have unfinished current-week matches
    const leagues = db.select().from(schema.leagues).where(eq(schema.leagues.seasonId, season.id)).all();
    let blocked = false;
    for (const lg of leagues) {
      const unfinished = db.select({ count: sql<number>`COUNT(*)` })
        .from(schema.matches)
        .where(and(
          eq(schema.matches.leagueId, lg.id),
          eq(schema.matches.week, season.currentWeek),
          sql`(${schema.matches.status} = 'scheduled' OR ${schema.matches.status} = 'ready' OR ${schema.matches.status} = 'in_progress')`,
        ))
        .get()?.count ?? 0;
      if (unfinished > 0) { blocked = true; break; }
    }

    if (blocked) {
      console.log(`[advance-week] season ${season.seasonNumber}: ${season.currentWeek} not advancing (unfinished matches)`);
      continue;
    }

    tx(() => {
      db.update(schema.seasons).set({ currentWeek: nextWeek }).where(eq(schema.seasons.id, season.id)).run();
      db.insert(schema.activityLog).values({
        type: 'week_auto_advanced',
        category: 'config',
        actor: 'system',
        leagueId: null,
        description: `Auto-advanced season ${season.seasonNumber}: week ${season.currentWeek} → ${nextWeek}`,
        metadata: JSON.stringify({ seasonId: season.id, from: season.currentWeek, to: nextWeek }),
      }).run();
    });

    console.log(`[advance-week] season ${season.seasonNumber}: ${season.currentWeek} → ${nextWeek}`);
  }
}
