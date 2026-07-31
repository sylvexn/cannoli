/**
 * Pure winner-picking helpers for lib/pins/archive-mint.ts — split out to
 * keep archive-mint.ts under the file-size limit. Each `pickXxx` takes
 * pre-fetched rows and returns the winner(s); the DB-querying `awardXxx`
 * orchestrators live in archive-mint.ts. Unit-testable without a DB.
 */
import { matchWinner } from '../standings';

export interface ChampionFinalsRow {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  /** Explicit winner flag — see matchWinner(). Null for legacy/sim rows. */
  winnerTeamId: string | null;
}
export interface ChampionWinner {
  winnerTeamId: string;
  loserTeamId: string;
  winnerSum: number;
  loserSum: number;
}

/**
 * Pick the finals winner from one or more finals matches (best-of-N is
 * resolved by game wins first — via matchWinner() on each row, so a
 * full-health forfeit still counts as a decisive game — falling back to
 * total score differential when game wins are tied). All matches are assumed
 * to be the same matchup (home/away pairing); the first row is used as the
 * reference for the team-id mapping.
 *
 * Returns null when:
 *   - no rows
 *   - any match is unfinished (homeScore/awayScore null)
 *   - the series is genuinely tied (equal game wins AND equal score sum)
 */
export function pickChampion(rows: ChampionFinalsRow[]): ChampionWinner | null {
  if (rows.length === 0) return null;
  let homeSum = 0;
  let awaySum = 0;
  let homeWins = 0;
  let awayWins = 0;
  for (const m of rows) {
    if (m.homeScore == null || m.awayScore == null) return null;
    homeSum += m.homeScore;
    awaySum += m.awayScore;
    const winner = matchWinner(m);
    if (winner != null && winner === m.homeTeamId) homeWins++;
    else if (winner != null && winner === m.awayTeamId) awayWins++;
  }
  const ref = rows[0];
  // A scored finals always has both teams resolved (not a NULL bracket slot).
  if (ref.homeTeamId == null || ref.awayTeamId == null) return null;

  let winnerIsHome: boolean;
  if (homeWins !== awayWins) {
    winnerIsHome = homeWins > awayWins;
  } else if (homeSum !== awaySum) {
    winnerIsHome = homeSum > awaySum;
  } else {
    return null; // genuinely tied series
  }

  return {
    winnerTeamId: winnerIsHome ? ref.homeTeamId : ref.awayTeamId,
    loserTeamId: winnerIsHome ? ref.awayTeamId : ref.homeTeamId,
    winnerSum: Math.max(homeSum, awaySum),
    loserSum: Math.min(homeSum, awaySum),
  };
}

export interface HighScoreRow {
  teamId: string;
  pokemonName: string;
  matchId: string;
  kills: number;
  week: number | null;
  phase: string | null;
}
export interface HighScoreWinner {
  teamId: string;
  pokemonName: string;
  matchId: string;
  kills: number;
  week: number | null;
  phase: string | null;
}

/**
 * Pick the highest single-match kill performance(s). Returns every row tied
 * at the top kill count. Returns [] when the top is 0 or input is empty.
 */
export function pickHighScore(rows: HighScoreRow[]): HighScoreWinner[] {
  if (rows.length === 0) return [];
  const top = rows.reduce((a, r) => Math.max(a, r.kills ?? 0), 0);
  if (top <= 0) return [];
  return rows.filter(r => (r.kills ?? 0) === top).map(r => ({
    teamId: r.teamId,
    pokemonName: r.pokemonName,
    matchId: r.matchId,
    kills: r.kills,
    week: r.week,
    phase: r.phase,
  }));
}

export interface StealRow {
  teamId: string;
  pokemonName: string;
  kills: number;
  gp: number;
  cost: number | null;
}
export interface StealWinner {
  teamId: string;
  pokemonName: string;
  kills: number;
  cost: number;
  ratio: number;
}

/**
 * Pick the best K-per-point ratio on a drafted Pokemon. Filters out rows
 * with no games played, no cost, or no kills (avoids div-by-0 and silly
 * "steals" from $0 picks). Ties on ratio mint to all.
 */
export function pickStealOfTheDraft(rows: StealRow[]): StealWinner[] {
  const candidates = rows
    .filter(r => r.gp >= 1 && (r.cost ?? 0) >= 1 && r.kills > 0)
    .map(r => ({
      teamId: r.teamId,
      pokemonName: r.pokemonName,
      kills: r.kills,
      cost: r.cost ?? 0,
      ratio: r.kills / Math.max(1, r.cost ?? 0),
    }));
  if (candidates.length === 0) return [];
  const top = candidates.reduce((a, r) => Math.max(a, r.ratio), 0);
  return candidates
    .filter(r => r.ratio === top)
    .map(r => ({
      teamId: r.teamId,
      pokemonName: r.pokemonName,
      kills: r.kills,
      cost: r.cost,
      ratio: Number(r.ratio.toFixed(3)),
    }));
}

export interface SweeperMatchRow {
  matchId: string;
  winnerTeamId: string;
  winnerGp: number;
  winnerDeaths: number;
}
export interface SweeperWinner {
  teamId: string;
  sweeps: number;
}

/**
 * Pick the top sweeper(s) from per-match results. Each row represents one
 * completed, decided match plus the winning team's death/game-played totals.
 * A sweep = winner had 0 deaths and at least 1 Pokemon recorded. Returns
 * all teams tied at the top sweep count, or [] when nobody swept.
 */
export function pickSweeper(rows: SweeperMatchRow[]): SweeperWinner[] {
  const sweeps = new Map<string, number>();
  for (const m of rows) {
    if (m.winnerGp <= 0) continue;
    if (m.winnerDeaths > 0) continue;
    sweeps.set(m.winnerTeamId, (sweeps.get(m.winnerTeamId) ?? 0) + 1);
  }
  let topCount = 0;
  for (const [, c] of sweeps) if (c > topCount) topCount = c;
  if (topCount === 0) return [];
  return [...sweeps.entries()]
    .filter(([, c]) => c === topCount)
    .map(([teamId, c]) => ({ teamId, sweeps: c }));
}
