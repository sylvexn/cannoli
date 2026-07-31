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
import { advancePlayoffWinner, decidePlayoffForfeit } from '../playoff-advance';
import { effectiveMatchDeadline } from '../deadline';
import { runAutoAwards } from '../pins/auto-award';

// Deadline derivation now lives in ../deadline (schedule-first: the league's
// live weekDates drive the cutoff, so a stale date baked onto a match row can't
// trigger a forfeit). Re-exported here for back-compat with existing importers.
export { endOfDayInZone, effectiveMatchDeadline } from '../deadline';

export function runAutoForfeit() {
  const now = new Date().toISOString();

  // Candidate matches: scheduled or ready, no result yet. We DO NOT filter
  // on `deadline IS NOT NULL` here — schedule generator now populates
  // deadline from weekDates, but historical / manually-created matches may
  // lack it. We compute an effective deadline below using the league's
  // weekDates as fallback so regular-season matches still flip at week-end.
  const candidates = db.select().from(schema.matches)
    .where(and(
      sql`(${schema.matches.status} = 'scheduled' OR ${schema.matches.status} = 'ready')`,
      sql`${schema.matches.homeScore} IS NULL`,
    ))
    .all();

  if (candidates.length === 0) return;

  const broadcaster = getArenaBroadcaster();

  // Cache leagues by id so we don't requery for every match in the same league.
  const leagueCache = new Map<string, typeof schema.leagues.$inferSelect>();
  function getLeague(id: string) {
    let row = leagueCache.get(id);
    if (!row) {
      const fetched = db.select().from(schema.leagues).where(eq(schema.leagues.id, id)).get();
      if (fetched) {
        leagueCache.set(id, fetched);
        row = fetched;
      }
    }
    return row;
  }

  for (const match of candidates) {
    const league = getLeague(match.leagueId);
    if (!league || league.paused) continue;

    const effectiveDeadline = effectiveMatchDeadline(match, league.weekDates, league.timezone);
    if (!effectiveDeadline || effectiveDeadline >= now) continue;

    const policy = league.forfeitPolicy;
    const isPlayoff = match.phase === 'playoffs';

    // Set inside the tx below when a playoff forfeit decides a winner — a
    // forfeit-driven upset can earn Kingslayer same as any other result, but
    // the award call itself runs AFTER the tx commits (see comment below).
    let awardMatchId: string | null = null;

    tx(() => {
      // Re-read the match inside the tx to guard against a concurrent result
      // landing between the outer scan and this write. Mirror expire-trades.ts.
      const fresh = db.select().from(schema.matches).where(eq(schema.matches.id, match.id)).get();
      if (!fresh) return;
      if (fresh.status !== 'scheduled' && fresh.status !== 'ready') return;
      if (fresh.homeScore != null) return;

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
            effectiveDeadline,
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
      // A bracket slot that's still NULL (feeding round not yet decided) has no
      // determined opponent — there's nothing to forfeit yet, so skip it.
      if (match.homeTeamId == null || match.awayTeamId == null) return;
      const { forfeiter, reason: forfeitReason } = decidePlayoffForfeit({
        readyHome: match.readyHome,
        readyAway: match.readyAway,
        homeSeed: match.homeSeed,
        awaySeed: match.awaySeed,
      });

      const winnerIsHome = forfeiter === 'away';
      // Both sides are non-null here (guarded above).
      const winnerId = (winnerIsHome ? match.homeTeamId : match.awayTeamId)!;
      const winnerSeed = winnerIsHome ? match.homeSeed : match.awaySeed;
      const homeScore = winnerIsHome ? 1 : 0;
      const awayScore = winnerIsHome ? 0 : 1;

      db.update(schema.matches)
        .set({
          status: 'completed',
          homeScore,
          awayScore,
          forfeitedBy: forfeiter,
          // The survivor wins by the forfeit flag, not the 1-0 score.
          winnerTeamId: winnerId,
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
            effectiveDeadline,
          bracketAdvanced: adv.advanced,
          advancedTo: adv.toMatchId,
          advancedSlot: adv.filledSlot,
        }),
      }).run();

      awardMatchId = match.id;
    });

    // Auto-award per-match pins (Kingslayer, Flawless) for a playoff forfeit
    // decision — AFTER the tx above commits, not inside it. A forfeit-driven
    // upset can earn Kingslayer same as any recorded result; without this a
    // forfeit could never mint it. Best-effort — a throw here must never
    // unwind the match write.
    if (awardMatchId) {
      try {
        runAutoAwards(match.leagueId, { trigger: 'match', matchId: awardMatchId });
      } catch (err) {
        console.error(`[auto-forfeit] runAutoAwards failed for ${awardMatchId}:`, err);
      }
    }

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
