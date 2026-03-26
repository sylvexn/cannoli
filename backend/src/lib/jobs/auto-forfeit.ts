/**
 * Auto-forfeit job — scans matches whose deadline has passed without a result
 * and applies the season's forfeitPolicy.
 *
 *   Regular season:
 *     - 'double_forfeit' → status='completed', 0-0, forfeitedBy='both'
 *     - 'admin_review'    → status='disputed' for admin to manually adjudicate
 *
 *   Playoffs:
 *     A double-forfeit in playoffs would orphan the bracket (no advancing team),
 *     so we never apply 'double_forfeit' here. Instead:
 *       - if exactly one side is `ready`, the *other* side is the forfeiter:
 *         the ready side advances 1-0.
 *       - if neither (or both) sides are ready, the higher seed advances 1-0
 *         (deterministic; matches the convention that the bye-receiver / better
 *         regular-season finisher gets the benefit of the doubt).
 *       - 'admin_review' policy still escalates to disputed instead of auto-deciding.
 *     After auto-deciding, the bracket is auto-advanced via advancePlayoffWinner
 *     so the next-round TBD slot fills (a forfeit in QF still lets the bye-receiver
 *     in SF face the surviving QF side; a forfeit in SF lets the surviving SF
 *     winner walk into Finals).
 */

import { db, schema } from '../../db';
import { and, eq, sql } from 'drizzle-orm';
import { tx } from '../tx';
import { getArenaBroadcaster } from '../../routes/arena';
import { advancePlayoffWinner } from '../playoff-advance';

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
    // Look up the league to determine policy + paused (both per-league now).
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, match.leagueId)).get();
    if (!league || league.paused) continue;

    const policy = league.forfeitPolicy;
    const isPlayoff = match.phase === 'playoffs';

    tx(() => {
      if (policy === 'admin_review') {
        // Admin-review: same behavior in both phases — flag for adjudication.
        db.update(schema.matches)
          .set({ status: 'disputed', warnings: JSON.stringify(['Auto-forfeit: deadline passed, admin review required']) })
          .where(eq(schema.matches.id, match.id))
          .run();

        db.insert(schema.activityLog).values({
          type: 'match_auto_forfeit',
          category: 'match',
          actor: 'system',
          leagueId: match.leagueId,
          description: `Auto-forfeit (admin_review): ${match.id}${isPlayoff ? ' [playoffs — bracket NOT advanced]' : ''}`,
          metadata: JSON.stringify({
            matchId: match.id,
            policy,
            phase: match.phase,
            playoffRound: match.playoffRound,
            deadline: match.deadline,
          }),
        }).run();
        return;
      }

      // policy === 'double_forfeit'
      if (!isPlayoff) {
        // Regular season: existing behavior — both sides forfeit, 0-0.
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

        db.insert(schema.activityLog).values({
          type: 'match_auto_forfeit',
          category: 'match',
          actor: 'system',
          leagueId: match.leagueId,
          description: `Auto-forfeit (double_forfeit): ${match.id}`,
          metadata: JSON.stringify({ matchId: match.id, policy, phase: 'regular', deadline: match.deadline }),
        }).run();
        return;
      }

      // Playoffs: pick a survivor. A double-forfeit would orphan the bracket.
      const homeReady = match.readyHome;
      const awayReady = match.readyAway;
      let forfeiter: 'home' | 'away';
      let forfeitReason: 'ready_asymmetry' | 'higher_seed_default';

      if (homeReady && !awayReady) {
        forfeiter = 'away';
        forfeitReason = 'ready_asymmetry';
      } else if (!homeReady && awayReady) {
        forfeiter = 'home';
        forfeitReason = 'ready_asymmetry';
      } else {
        // Neither (or both) ready — defer to seeding. Lower seed number = better.
        const homeSeed = match.homeSeed ?? Number.POSITIVE_INFINITY;
        const awaySeed = match.awaySeed ?? Number.POSITIVE_INFINITY;
        if (homeSeed <= awaySeed) {
          forfeiter = 'away';
        } else {
          forfeiter = 'home';
        }
        forfeitReason = 'higher_seed_default';
      }

      const winnerIsHome = forfeiter === 'away';
      const winnerId = winnerIsHome ? match.homeTeamId : match.awayTeamId;
      const winnerSeed = winnerIsHome ? match.homeSeed : match.awaySeed;
      const homeScore = winnerIsHome ? 1 : 0;
      const awayScore = winnerIsHome ? 0 : 1;

      db.update(schema.matches)
        .set({
          status: 'completed',
          homeScore,
          awayScore,
          forfeitedBy: forfeiter,
          completedAt: now,
          readyHome: false,
          readyAway: false,
        })
        .where(eq(schema.matches.id, match.id))
        .run();

      // Advance the bracket. Will no-op for the finals or if downstream slot
      // is already filled.
      const adv = advancePlayoffWinner({
        matchId: match.id,
        leagueId: match.leagueId,
        playoffRound: match.playoffRound,
        winnerId,
        winnerSeed,
      });

      db.insert(schema.activityLog).values({
        type: 'match_auto_forfeit',
        category: 'match',
        actor: 'system',
        leagueId: match.leagueId,
        description: `Auto-forfeit (playoff ${match.playoffRound ?? '?'}): ${match.id} — ${forfeiter} forfeits, ${winnerId} advances` +
          (adv.advanced ? ` (→ ${adv.toRound} ${adv.toMatchId} ${adv.filledSlot})` : ''),
        metadata: JSON.stringify({
          matchId: match.id,
          policy,
          phase: 'playoffs',
          playoffRound: match.playoffRound,
          round: match.playoffRound,
          forfeiter,
          forfeitReason,
          winnerId,
          winnerSeed,
          homeSeed: match.homeSeed,
          awaySeed: match.awaySeed,
          deadline: match.deadline,
          bracketAdvanced: adv.advanced,
          advancedTo: adv.toMatchId,
          advancedSlot: adv.filledSlot,
        }),
      }).run();
    });

    if (broadcaster) {
      const wsStatus = policy === 'admin_review' ? 'disputed' : 'completed';
      broadcaster.publish(`arena:match:${match.id}`, JSON.stringify({
        type: 'match_state',
        matchId: match.id,
        status: wsStatus,
        forfeit: true,
        policy,
        phase: match.phase,
      }));
    }

    console.log(`[auto-forfeit] ${match.id} (${match.phase}) → ${policy}`);
  }
}
