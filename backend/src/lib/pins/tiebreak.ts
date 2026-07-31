/**
 * Shared last-resort tiebreak for pin winner selection.
 *
 * Product decision (S11): a pin awards exactly ONE winner per league, never
 * a split. Each picker narrows ties with its own pin-specific criterion
 * FIRST (fewest deaths, earliest match, raw kills, canonical standings for
 * Cannoli — see each pickXxx docstring in auto-award.ts / archive-mint-
 * pickers.ts), then falls through to this general fallback so the result is
 * always exactly one winner, fully deterministic, and stable across re-runs:
 *
 *   1. Better (lower) `teams.rank` — the team's final regular-season
 *      standing, stamped when playoffs are generated (routes/matches.ts) or
 *      by assignFinishPositions (scripts/import-xlsx.ts). Missing rank sorts
 *      last, not first.
 *   2. Lexicographically smallest team id.
 *
 * Pure — callers thread `teams.rank` into their row shape (the impure
 * awardXxx orchestrators fetch it) so this never touches the DB itself and
 * stays unit-testable.
 */
export function breakTieByRank<T>(
  candidates: T[],
  rankOf: (c: T) => number | null,
  teamIdOf: (c: T) => string,
): T {
  return candidates.reduce((best, c) => {
    const r = rankOf(c) ?? Number.MAX_SAFE_INTEGER;
    const br = rankOf(best) ?? Number.MAX_SAFE_INTEGER;
    if (r !== br) return r < br ? c : best;
    return teamIdOf(c) < teamIdOf(best) ? c : best;
  });
}
