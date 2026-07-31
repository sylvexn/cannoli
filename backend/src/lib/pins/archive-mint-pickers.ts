/**
 * Pure winner-picking helpers for lib/pins/archive-mint.ts — split out to
 * keep archive-mint.ts under the file-size limit. Each `pickXxx` takes
 * pre-fetched rows and returns the winner(s); the DB-querying `awardXxx`
 * orchestrators live in archive-mint.ts. Unit-testable without a DB.
 */
import { matchWinner } from '../standings';
import { breakTieByRank } from './tiebreak';

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
  deaths: number;
  week: number | null;
  phase: string | null;
  /** The team's final standings rank (teams.rank), for the general tiebreak
   *  fallback below. Null when not yet stamped. */
  teamRank: number | null;
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
 * Pick the highest single-match kill performance. Ties on kills narrow by
 * fewest deaths in that match, then earliest (lowest week, then lowest
 * match id), then the general rank/id fallback (breakTieByRank). Returns []
 * when the top is 0 or input is empty, else exactly one winner.
 */
export function pickHighScore(rows: HighScoreRow[]): HighScoreWinner[] {
  if (rows.length === 0) return [];
  const top = rows.reduce((a, r) => Math.max(a, r.kills ?? 0), 0);
  if (top <= 0) return [];
  let tied = rows.filter(r => (r.kills ?? 0) === top);

  const minDeaths = Math.min(...tied.map(r => r.deaths ?? 0));
  tied = tied.filter(r => (r.deaths ?? 0) === minDeaths);

  const minWeek = Math.min(...tied.map(r => r.week ?? Number.MAX_SAFE_INTEGER));
  tied = tied.filter(r => (r.week ?? Number.MAX_SAFE_INTEGER) === minWeek);

  const minMatchId = tied.map(r => r.matchId).sort()[0];
  tied = tied.filter(r => r.matchId === minMatchId);

  const winner = breakTieByRank(tied, r => r.teamRank, r => r.teamId);
  return [{
    teamId: winner.teamId, pokemonName: winner.pokemonName, matchId: winner.matchId,
    kills: winner.kills, week: winner.week, phase: winner.phase,
  }];
}

export interface StealRow {
  teamId: string;
  pokemonName: string;
  kills: number;
  gp: number;
  cost: number | null;
  /** The team's final standings rank (teams.rank), for the general tiebreak
   *  fallback below. Null when not yet stamped. */
  teamRank: number | null;
}
export interface StealWinner {
  teamId: string;
  pokemonName: string;
  kills: number;
  cost: number;
  ratio: number;
}

/** Minimum season kills a Pokemon must have to be eligible for Steal of the
 *  Draft — otherwise a 2-kill $1 pick (ratio 2.0) beats a 19-kill workhorse.
 *  One constant, one edit to retune. */
export const STEAL_MIN_KILLS = 5;

/**
 * Pick the best K-per-point ratio on a drafted Pokemon with at least
 * `STEAL_MIN_KILLS` season kills (also filters out rows with no games
 * played or no cost, avoiding div-by-0). Ties on ratio narrow by higher raw
 * kills, then the general rank/id fallback (breakTieByRank). Returns [] when
 * nobody clears the floor, else exactly one winner.
 */
export function pickStealOfTheDraft(rows: StealRow[]): StealWinner[] {
  const candidates = rows
    .filter(r => r.gp >= 1 && (r.cost ?? 0) >= 1 && r.kills >= STEAL_MIN_KILLS)
    .map(r => ({
      teamId: r.teamId,
      pokemonName: r.pokemonName,
      kills: r.kills,
      cost: r.cost ?? 0,
      ratio: r.kills / Math.max(1, r.cost ?? 0),
      teamRank: r.teamRank,
    }));
  if (candidates.length === 0) return [];
  const topRatio = candidates.reduce((a, r) => Math.max(a, r.ratio), 0);
  let tied = candidates.filter(r => r.ratio === topRatio);
  const maxKills = Math.max(...tied.map(r => r.kills));
  tied = tied.filter(r => r.kills === maxKills);
  const winner = breakTieByRank(tied, r => r.teamRank, r => r.teamId);
  return [{
    teamId: winner.teamId, pokemonName: winner.pokemonName, kills: winner.kills,
    cost: winner.cost, ratio: Number(winner.ratio.toFixed(3)),
  }];
}

export interface SweeperMatchRow {
  matchId: string;
  winnerTeamId: string;
  winnerGp: number;
  winnerDeaths: number;
  /** The winning team's final standings rank (teams.rank), for the general
   *  tiebreak fallback below. Null when not yet stamped. */
  teamRank: number | null;
}
export interface SweeperWinner {
  teamId: string;
  sweeps: number;
}

/**
 * Pick the top sweeper from per-match results. Each row represents one
 * completed, decided match plus the winning team's death/game-played totals.
 * A sweep = winner had 0 deaths and at least 1 Pokemon recorded. Ties narrow
 * via the general rank/id fallback (breakTieByRank). Returns [] when nobody
 * swept, else exactly one winner.
 */
export function pickSweeper(rows: SweeperMatchRow[]): SweeperWinner[] {
  const sweeps = new Map<string, { count: number; teamRank: number | null }>();
  for (const m of rows) {
    if (m.winnerGp <= 0) continue;
    if (m.winnerDeaths > 0) continue;
    const prev = sweeps.get(m.winnerTeamId);
    if (prev) prev.count++;
    else sweeps.set(m.winnerTeamId, { count: 1, teamRank: m.teamRank });
  }
  let topCount = 0;
  for (const [, v] of sweeps) if (v.count > topCount) topCount = v.count;
  if (topCount === 0) return [];
  const tied = [...sweeps.entries()]
    .filter(([, v]) => v.count === topCount)
    .map(([teamId, v]) => ({ teamId, sweeps: v.count, teamRank: v.teamRank }));
  const winner = breakTieByRank(tied, t => t.teamRank, t => t.teamId);
  return [{ teamId: winner.teamId, sweeps: winner.sweeps }];
}
