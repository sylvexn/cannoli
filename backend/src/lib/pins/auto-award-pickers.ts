/**
 * Pure winner-picking helpers for lib/pins/auto-award.ts — split out to keep
 * auto-award.ts under the file-size limit. Each `pickXxx` takes pre-fetched
 * rows and returns at most one winner (see lib/pins/tiebreak.ts for the
 * shared tiebreak policy); the DB-querying `awardXxx` orchestrators live in
 * auto-award.ts. Unit-testable without a DB.
 */
import { matchWinner } from '../standings';
import { breakTieByRank } from './tiebreak';

export interface GarchompRow {
  teamId: string; pokemon: string; kills: number; deaths: number;
  /** The team's final standings rank (teams.rank), for the general tiebreak
   *  fallback below. Null when not yet stamped. */
  teamRank: number | null;
}
export interface GarchompWinner { teamId: string; pokemon: string; kills: number }

/**
 * Pick the Garchomp winner from pre-aggregated rows. Rows are expected to be
 * grouped by (teamId, LOWER(pokemonName)) — the SQL caller already does this,
 * but the pure helper additionally re-coalesces casing variants defensively
 * so unit tests can pass raw mixed-case inputs.
 *
 * Ties on kills narrow by fewest deaths on that Pokemon, then the general
 * rank/id fallback (breakTieByRank) — always at most one winner.
 */
export function pickGarchompWinners(rows: GarchompRow[]): GarchompWinner[] {
  if (rows.length === 0) return [];
  const merged = new Map<string, GarchompRow>();
  for (const r of rows) {
    const key = `${r.teamId}|${(r.pokemon ?? '').toLowerCase()}`;
    const prev = merged.get(key);
    if (prev) { prev.kills += (r.kills ?? 0); prev.deaths += (r.deaths ?? 0); }
    else merged.set(key, {
      teamId: r.teamId, pokemon: (r.pokemon ?? '').toLowerCase(),
      kills: r.kills ?? 0, deaths: r.deaths ?? 0, teamRank: r.teamRank,
    });
  }
  const all = [...merged.values()];
  const topKills = all.reduce((acc, r) => Math.max(acc, r.kills), 0);
  if (topKills === 0) return [];
  const killTied = all.filter(r => r.kills === topKills);
  const minDeaths = Math.min(...killTied.map(r => r.deaths));
  const deathTied = killTied.filter(r => r.deaths === minDeaths);
  const winner = breakTieByRank(deathTied, r => r.teamRank, r => r.teamId);
  return [{ teamId: winner.teamId, pokemon: winner.pokemon, kills: winner.kills }];
}

export interface CannoliRecord {
  teamId: string;
  userId: number | null;
  wins: number;
  losses: number;
  diff: number;
  played: number;
  /** 1-based position in computeStandings(leagueId) order (best first) — the
   *  canonical wins/diff/h2h/kills/id tiebreak chain, reused rather than
   *  reimplemented as the final Cannoli tiebreak below. */
  standingsRank: number;
}

/**
 * Pick the Cannoli winner (best regular-season record) from pre-computed
 * records. Most wins, tiebreak by diff, then — if still tied — the canonical
 * standings ordering (`standingsRank`, from computeStandings()) picks the
 * single winner. Always at most one winner.
 */
export function pickCannoliWinners(records: CannoliRecord[]): CannoliRecord[] {
  const playing = records.filter(r => r.played > 0);
  if (playing.length === 0) return [];
  const topWins = playing.reduce((a, r) => Math.max(a, r.wins), 0);
  const winners = playing.filter(r => r.wins === topWins);
  const topDiff = winners.reduce((a, r) => Math.max(a, r.diff), Number.NEGATIVE_INFINITY);
  const tied = winners.filter(r => r.diff === topDiff);
  if (tied.length <= 1) return tied;
  return [tied.reduce((a, b) => (a.standingsRank <= b.standingsRank ? a : b))];
}

export interface CynthiaStreak {
  teamId: string; userId: number | null; best: number;
  teamRank: number | null;
}

/**
 * Pick the Cynthia winner from pre-computed streaks — the top streak
 * (provided it's >= `min`, default 2), narrowed to one via the general
 * rank/id fallback (breakTieByRank) when multiple teams tie.
 */
export function pickCynthiaWinners(streaks: CynthiaStreak[], min = 2): CynthiaStreak[] {
  if (streaks.length === 0) return [];
  const top = streaks.reduce((a, s) => Math.max(a, s.best), 0);
  if (top < min) return [];
  const tied = streaks.filter(s => s.best === top);
  return [breakTieByRank(tied, s => s.teamRank, s => s.teamId)];
}

export interface StreakMatch {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  /** Explicit winner flag — see matchWinner(). Null for legacy/sim rows. */
  winnerTeamId: string | null;
  forfeitedBy?: 'home' | 'away' | 'both' | null;
}

/**
 * Compute the longest consecutive-win streak for `teamId` over `matches`.
 * Matches are consumed in the order given (caller orders by week, id).
 * Rules:
 *   - `forfeitedBy === 'both'` matches are SKIPPED (neither extend nor break).
 *   - NULL scores reset the streak (treated as a non-win).
 *   - The win/loss/tie call is `matchWinner(m)` (winnerTeamId first, score
 *     comparison fallback) — a full-health forfeit (equal score, real winner)
 *     correctly extends the streak instead of breaking it.
 */
export function computeStreak(matches: StreakMatch[], teamId: string): number {
  let best = 0, current = 0;
  for (const m of matches) {
    if (m.forfeitedBy === 'both') continue;
    if (m.homeScore == null || m.awayScore == null) { current = 0; continue; }
    const winner = matchWinner(m);
    if (winner === teamId) { current++; if (current > best) best = current; }
    else { current = 0; }
  }
  return best;
}
