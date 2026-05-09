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

/**
 * Compute the effective deadline for a match. Schedule generator populates
 * `match.deadline` from `league.weekDates[week]` at create time, but matches
 * that pre-date that column or were inserted manually may have a null
 * deadline. In that case fall back to the live league.weekDates so the
 * forfeit policy still kicks in at week-end.
 *
 * Returns an ISO timestamp or null if no deadline can be derived.
 */
export function effectiveMatchDeadline(
  match: { deadline: string | null; week: number },
  weekDatesJson: string | null,
): string | null {
  if (match.deadline) return match.deadline;
  if (!weekDatesJson) return null;
  try {
    const map = JSON.parse(weekDatesJson) as Record<string, string>;
    const dateStr = map[String(match.week)];
    if (!dateStr) return null;
    return new Date(dateStr + 'T23:59:59Z').toISOString();
  } catch {
    return null;
  }
}

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

    const effectiveDeadline = effectiveMatchDeadline(match, league.weekDates);
    if (!effectiveDeadline || effectiveDeadline >= now) continue;

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
      const { forfeiter, reason: forfeitReason } = decidePlayoffForfeit({
        readyHome: match.readyHome,
        readyAway: match.readyAway,
        homeSeed: match.homeSeed,
        awaySeed: match.awaySeed,
      });

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
            effectiveDeadline,
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
