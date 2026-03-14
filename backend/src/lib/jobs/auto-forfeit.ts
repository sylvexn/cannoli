/**
 * Auto-forfeit job — scans matches whose deadline has passed without a result
 * and applies the season's forfeitPolicy.
 *
 *   - 'double_forfeit' → status='completed', 0-0, forfeitedBy='both'
 *   - 'admin_review'    → status='disputed' for admin to manually adjudicate
 */

import { db, schema } from '../../db';
import { and, eq, sql } from 'drizzle-orm';
import { tx } from '../tx';
import { getArenaBroadcaster } from '../../routes/arena';

export function runAutoForfeit() {
  const now = new Date().toISOString();

  // Candidate matches: scheduled or ready, deadline passed, no result yet
  const due = db.select().from(schema.matches)
    .where(and(
      sql`(${schema.matches.status} = 'scheduled' OR ${schema.matches.status} = 'ready')`,
      sql`${schema.matches.deadline} IS NOT NULL`,
      sql`${schema.matches.deadline} < ${now}`,
      sql`${schema.matches.homeScore} IS NULL`,
    ))
    .all();

  if (due.length === 0) return;

  const broadcaster = getArenaBroadcaster();

  for (const match of due) {
    // Look up season for this league to determine policy + paused
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, match.leagueId)).get();
    const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;
    if (!season || season.paused) continue;

    const policy = season.forfeitPolicy;

    tx(() => {
      if (policy === 'admin_review') {
        db.update(schema.matches)
          .set({ status: 'disputed', warnings: JSON.stringify(['Auto-forfeit: deadline passed, admin review required']) })
          .where(eq(schema.matches.id, match.id))
          .run();
      } else {
        // double_forfeit: completed, 0-0, both
        db.update(schema.matches)
          .set({
            status: 'completed',
            homeScore: 0,
            awayScore: 0,
            forfeitedBy: 'both',
            completedAt: now,
            readyHome: false,
            readyAway: false,
          })
          .where(eq(schema.matches.id, match.id))
          .run();
      }

      db.insert(schema.activityLog).values({
        type: 'match_auto_forfeit',
        category: 'match',
        actor: 'system',
        leagueId: match.leagueId,
        description: `Auto-forfeit (${policy}): ${match.id}`,
        metadata: JSON.stringify({ matchId: match.id, policy, deadline: match.deadline }),
      }).run();
    });

    if (broadcaster) {
      broadcaster.publish(`arena:match:${match.id}`, JSON.stringify({
        type: 'match_state',
        matchId: match.id,
        status: policy === 'admin_review' ? 'disputed' : 'completed',
        forfeit: true,
        policy,
      }));
    }

    console.log(`[auto-forfeit] ${match.id} → ${policy}`);
  }
}
