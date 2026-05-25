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

/** Pure forfeit-survivor decision used in playoffs. Mirrors the rules in the
 *  auto-forfeit job: a single ready side keeps its slot ('ready_asymmetry');
 *  if both/neither are ready, the higher seed (lower seed number) advances
 *  ('higher_seed_default'). Returned `forfeiter` describes who loses. */
export function decidePlayoffForfeit(args: {
  readyHome: boolean;
  readyAway: boolean;
  homeSeed: number | null;
  awaySeed: number | null;
}): { forfeiter: 'home' | 'away'; reason: 'ready_asymmetry' | 'higher_seed_default' } {
  const { readyHome, readyAway, homeSeed, awaySeed } = args;
  if (readyHome && !readyAway) return { forfeiter: 'away', reason: 'ready_asymmetry' };
  if (!readyHome && readyAway) return { forfeiter: 'home', reason: 'ready_asymmetry' };
  // Lower seed number = better seed. If tied / nulls, default to home advancing.
  const hs = homeSeed ?? Number.POSITIVE_INFINITY;
  const as = awaySeed ?? Number.POSITIVE_INFINITY;
  if (hs <= as) return { forfeiter: 'away', reason: 'higher_seed_default' };
  return { forfeiter: 'home', reason: 'higher_seed_default' };
}

/** Pure bracket routing: given a finished match, decide which slot of which
 *  next-round match to fill. The caller supplies bracket-shape context so this
 *  function stays DB-free and unit-testable.
 *
 * Returns null if the match is a finals (no next round) or the next round /
 * slot is not deterministically defined for the inputs.
 */
export function computeAdvanceTarget(args: {
  matchId: string;
  playoffRound: 'qf' | 'sf' | 'f';
  /** Number of QF matches in the bracket (2 → 6-team, 4 → 8-team). */
  qfCount: number;
  /** SF match ids in ascending id order — only required when advancing from sf. */
  sfMatchIds?: string[];
}): { nextRound: 'sf' | 'f'; nextMatchOffset: number; fillHome: boolean } | null {
  const { matchId, playoffRound, qfCount, sfMatchIds } = args;

  if (playoffRound === 'f') return null;

  // Match number suffix: "<league>-pqf1" → 1
  const matchNumStr = matchId.replace(/.*p(qf|sf|f)/, '');
  const matchNum = parseInt(matchNumStr) || 0;

  if (playoffRound === 'qf') {
    // 8-team bracket: matchNums 1,2 → SF1 (home, away); 3,4 → SF2 (home, away)
    // 6-team bracket: matchNum 1 → SF1 away; 2 → SF2 away
    if (qfCount >= 4) {
      return {
        nextRound: 'sf',
        nextMatchOffset: matchNum <= 2 ? 0 : 1,
        fillHome: matchNum % 2 === 1,
      };
    }
    return {
      nextRound: 'sf',
      nextMatchOffset: matchNum <= 1 ? 0 : 1,
      fillHome: false,
    };
  }

  // playoffRound === 'sf' → finals
  if (!sfMatchIds || sfMatchIds.length === 0) return null;
  const sfIndex = sfMatchIds.findIndex(id => id === matchId);
  return {
    nextRound: 'f',
    nextMatchOffset: 0,
    fillHome: sfIndex === 0,
  };
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
  if (playoffRound !== 'qf' && playoffRound !== 'sf' && playoffRound !== 'f') return result;

  let qfCount = 0;
  let sfMatchIds: string[] | undefined;

  if (playoffRound === 'qf') {
    qfCount = db.select().from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, leagueId),
        eq(schema.matches.phase, 'playoffs'),
        eq(schema.matches.playoffRound, 'qf'),
      ))
      .all().length;
  } else if (playoffRound === 'sf') {
    sfMatchIds = db.select().from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, leagueId),
        eq(schema.matches.phase, 'playoffs'),
        eq(schema.matches.playoffRound, 'sf'),
      ))
      .orderBy(asc(schema.matches.id))
      .all()
      .map(m => m.id);
  }

  const target = computeAdvanceTarget({
    matchId,
    playoffRound: playoffRound as 'qf' | 'sf' | 'f',
    qfCount,
    sfMatchIds,
  });
  if (!target) return result;

  const { nextRound, nextMatchOffset, fillHome } = target;
  result.toRound = nextRound;

  const nextMatches = db.select().from(schema.matches)
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'playoffs'),
      eq(schema.matches.playoffRound, nextRound),
    ))
    .orderBy(asc(schema.matches.id))
    .all();

  const targetMatch = nextMatches[nextMatchOffset];
  if (!targetMatch) return result;

  const updateData: Record<string, unknown> = {};
  if (fillHome && targetMatch.homeTeamId == null) {
    updateData.homeTeamId = winnerId;
    updateData.homeSeed = winnerSeed;
    result.filledSlot = 'home';
  } else if (!fillHome && targetMatch.awayTeamId == null) {
    updateData.awayTeamId = winnerId;
    updateData.awaySeed = winnerSeed;
    result.filledSlot = 'away';
  }

  if (Object.keys(updateData).length > 0) {
    db.update(schema.matches).set(updateData).where(eq(schema.matches.id, targetMatch.id)).run();
    result.advanced = true;
    result.toMatchId = targetMatch.id;
  }

  return result;
}
