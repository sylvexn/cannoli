/**
 * Stale in_progress sweep — flips matches stuck in `in_progress` for over
 * 24 hours into `disputed` for admin review.
 *
 * Mid-battle disconnects without a `|win|` event leave the match's status
 * frozen at in_progress: the PS bot's monitor loses the room, and the
 * disk-replay fallback skips matches that aren't in `scheduled` / `ready`.
 * Without this sweep the row sits forever on the active-matches surface and
 * blocks downstream stats / week advancement.
 *
 * The sweep is intentionally a flag-only operation — no score guess, no
 * replay re-fetch. Admin review is the right resolution because the cause
 * (bot crash, PS server reboot, network partition) varies per incident.
 */

import { db, schema } from '../../db';
import { and, eq, sql } from 'drizzle-orm';
import { tx } from '../tx';

/** Stuck-threshold: how long an in_progress match can linger before sweep. */
export const STALE_IN_PROGRESS_MS = 24 * 60 * 60 * 1000;

/**
 * Pure deadline check — exposed for unit tests. Returns true if a match
 * whose `startedAt` is `startedAt` should be considered stale at `now`.
 */
export function isStaleInProgress(
  startedAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!startedAt) return false;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return false;
  return now.getTime() - started >= STALE_IN_PROGRESS_MS;
}

export function runStaleInProgressSweep(): { swept: number } {
  const now = new Date();
  const cutoffIso = new Date(now.getTime() - STALE_IN_PROGRESS_MS).toISOString();

  const candidates = db.select().from(schema.matches)
    .where(and(
      eq(schema.matches.status, 'in_progress'),
      sql`${schema.matches.startedAt} IS NOT NULL`,
      sql`${schema.matches.startedAt} < ${cutoffIso}`,
    ))
    .all();

  if (candidates.length === 0) return { swept: 0 };

  let swept = 0;
  for (const match of candidates) {
    tx(() => {
      db.update(schema.matches)
        .set({
          status: 'disputed',
          warnings: JSON.stringify([
            'Match stuck in_progress > 24h — bot/connection issue, admin review required',
          ]),
        })
        .where(eq(schema.matches.id, match.id))
        .run();

      db.insert(schema.activityLog).values({
        type: 'match_stale_swept',
        category: 'match',
        actor: 'system',
        leagueId: match.leagueId,
        description: `Stale in_progress swept: ${match.id} (started ${match.startedAt})`,
        metadata: JSON.stringify({
          matchId: match.id,
          startedAt: match.startedAt,
          phase: match.phase,
          playoffRound: match.playoffRound,
          psRoomId: match.psRoomId,
        }),
      }).run();
    });

    swept++;
    console.log(`[stale-in-progress] ${match.id} → disputed (started ${match.startedAt})`);
  }

  return { swept };
}
