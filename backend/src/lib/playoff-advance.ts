/**
 * Playoff bracket auto-advance.
 *
 * Given a *just-completed* playoff match's id and its winner, fill the
 * appropriate TBD slot in the next round.
 *
 * Bracket layout (matches `/api/leagues/:leagueId/playoffs/generate`):
 *   QF1 (3v6) → SF1 (1 vs winner) away slot
 *   QF2 (4v5) → SF2 (2 vs winner) away slot
 *   SF1 winner → Finals home slot
 *   SF2 winner → Finals away slot
 *
 * For 4-team brackets there is no QF round; SF1 and SF2 feed Finals as above.
 *
 * Returns metadata describing what happened so callers (auto-forfeit, manual
 * result endpoint) can log uniformly.
 */
import { db, schema } from '../db';
import { and, eq, asc } from 'drizzle-orm';

export interface AdvanceResult {
  advanced: boolean;
  fromRound: 'qf' | 'sf' | 'f' | null;
  toRound: 'sf' | 'f' | null;
  toMatchId: string | null;
  filledSlot: 'home' | 'away' | null;
  winnerId: string;
  winnerSeed: number | null;
}

export function advancePlayoffWinner(params: {
  matchId: string;
  leagueId: string;
  playoffRound: string | null;
  winnerId: string;
  winnerSeed: number | null;
}): AdvanceResult {
  const { matchId, leagueId, playoffRound, winnerId, winnerSeed } = params;

  const result: AdvanceResult = {
    advanced: false,
    fromRound: (playoffRound as AdvanceResult['fromRound']) ?? null,
    toRound: null,
    toMatchId: null,
    filledSlot: null,
    winnerId,
    winnerSeed,
  };

  if (!playoffRound) return result;

  // Match number suffix: "<league>-pqf1" → 1
  const matchNumStr = matchId.replace(/.*p(qf|sf|f)/, '');
  const matchNum = parseInt(matchNumStr) || 0;

  let nextRound: 'sf' | 'f' | null = null;
  let nextMatchOffset = 0;
  let fillHome = false;

  if (playoffRound === 'qf') {
    nextRound = 'sf';

    // Bracket size detection: 6-team bracket has 2 QF matches (#3v6, #4v5) and
    // QF winners feed the away slot of SF (home = bye seed). 8-team bracket has
    // 4 QF matches and QF winners fill BOTH SF slots.
    //
    // Generation order for QF matchNum (see playoffs/generate):
    //   6-team: qf1=3v6 → SF1 away, qf2=4v5 → SF2 away
    //   8-team: qf1=1v8 → SF1 home, qf2=4v5 → SF1 away,
    //           qf3=2v7 → SF2 home, qf4=3v6 → SF2 away
    const qfCount = db.select().from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, leagueId),
        eq(schema.matches.phase, 'playoffs'),
        eq(schema.matches.playoffRound, 'qf'),
      ))
      .all().length;

    if (qfCount >= 4) {
      // 8-team: matchNum 1,2 → SF1 (home,away); 3,4 → SF2 (home,away)
      nextMatchOffset = matchNum <= 2 ? 0 : 1;
      fillHome = matchNum % 2 === 1;
    } else {
      // 6-team: matchNum 1 → SF1 away, 2 → SF2 away
      nextMatchOffset = matchNum <= 1 ? 0 : 1;
      fillHome = false;
    }
  } else if (playoffRound === 'sf') {
    nextRound = 'f';
    nextMatchOffset = 0;
    const sfMatches = db.select().from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, leagueId),
        eq(schema.matches.phase, 'playoffs'),
        eq(schema.matches.playoffRound, 'sf'),
      ))
      .orderBy(asc(schema.matches.id))
      .all();
    const sfIndex = sfMatches.findIndex(m => m.id === matchId);
    fillHome = sfIndex === 0;
  } else {
    // 'f' — no further round
    return result;
  }

  result.toRound = nextRound;

  const nextMatches = db.select().from(schema.matches)
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'playoffs'),
      eq(schema.matches.playoffRound, nextRound),
    ))
    .orderBy(asc(schema.matches.id))
    .all();

  const target = nextMatches[nextMatchOffset];
  if (!target) return result;

  const updateData: Record<string, unknown> = {};
  if (fillHome && target.homeTeamId === 'TBD') {
    updateData.homeTeamId = winnerId;
    updateData.homeSeed = winnerSeed;
    result.filledSlot = 'home';
  } else if (!fillHome && target.awayTeamId === 'TBD') {
    updateData.awayTeamId = winnerId;
    updateData.awaySeed = winnerSeed;
    result.filledSlot = 'away';
  }

  if (Object.keys(updateData).length > 0) {
    db.update(schema.matches).set(updateData).where(eq(schema.matches.id, target.id)).run();
    result.advanced = true;
    result.toMatchId = target.id;
  }

  return result;
}
