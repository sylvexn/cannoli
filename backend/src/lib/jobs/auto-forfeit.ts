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
 * Resolve "end of day (23:59:59) on `dateStr` (YYYY-MM-DD) in IANA `timeZone`"
 * to a UTC ISO timestamp. We can't just append 'T23:59:59Z' (that's UTC
 * midnight-minus-1s, not the league's local end-of-day) nor a fixed offset
 * (DST changes it). Instead we ask Intl what wall-clock time the zone shows
 * for a candidate UTC instant, derive the zone's offset for that date, and
 * back the UTC instant out of the desired local time. One iteration is enough
 * for the once-a-day boundary we care about.
 */
export function endOfDayInZone(dateStr: string, timeZone: string): string {
  // Desired local wall-clock: dateStr 23:59:59.
  const [y, m, d] = dateStr.split('-').map(Number);
  const desiredLocalMs = Date.UTC(y, m - 1, d, 23, 59, 59);

  // Offset (minutes) the zone is ahead of UTC, computed at the candidate
  // instant. tzOffset = localWallClock - utc.
  function offsetMinutes(utcMs: number): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
    let hour = get('hour');
    if (hour === 24) hour = 0; // some engines render midnight as 24
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
    return Math.round((asUtc - utcMs) / 60000);
  }

  // First guess: treat the desired local time as if it were UTC, find the
  // zone's offset there, then correct. Re-derive the offset at the corrected
  // instant to handle the rare case the first guess straddled a DST change.
  let utcMs = desiredLocalMs - offsetMinutes(desiredLocalMs) * 60000;
  utcMs = desiredLocalMs - offsetMinutes(utcMs) * 60000;
  return new Date(utcMs).toISOString();
}

/**
 * Compute the effective deadline for a match. Schedule generator populates
 * `match.deadline` from `league.weekDates[week]` at create time, but matches
 * that pre-date that column or were inserted manually may have a null
 * deadline. In that case fall back to the live league.weekDates so the
 * forfeit policy still kicks in at week-end.
 *
 * The week-end fallback is computed as 23:59:59 IN THE LEAGUE'S timezone
 * (TZ-DEADLINE), so the enforced cutoff matches what coaches see rather than
 * hard-coded UTC.
 *
 * Returns an ISO timestamp or null if no deadline can be derived.
 */
export function effectiveMatchDeadline(
  match: { deadline: string | null; week: number },
  weekDatesJson: string | null,
  timeZone: string = 'America/New_York',
): string | null {
  if (match.deadline) return match.deadline;
  if (!weekDatesJson) return null;
  try {
    const map = JSON.parse(weekDatesJson) as Record<string, string>;
    const dateStr = map[String(match.week)];
    if (!dateStr) return null;
    return endOfDayInZone(dateStr, timeZone);
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

    const effectiveDeadline = effectiveMatchDeadline(match, league.weekDates, league.timezone);
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
