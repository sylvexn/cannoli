/**
 * Standings — single source of truth for team ordering.
 *
 * Tiebreaker hierarchy (applied in order):
 *   1. Wins (desc)
 *   2. Head-to-head record between tied teams. For a multi-way tie, every member's
 *      H2H record is computed only against the *other* members of the tied set.
 *   3. Point differential (kills - deaths) — desc
 *   4. Total kills (points-for) — desc
 *   5. Team ID (asc) — last-resort stable tiebreaker
 *
 * Each returned row carries a `tiebreaker` field describing which rule
 * disambiguated it from the team(s) directly above/below at the same wins-bucket.
 * For unique wins-buckets (no tie at all), tiebreaker is null.
 */
import { db, schema } from '../db';
import { and, eq, sql } from 'drizzle-orm';

export type TiebreakerRule = 'h2h' | 'diff' | 'kills' | 'id';

export interface TeamStandingRow {
  id: string;
  wins: number;
  losses: number;
  differential: number;
  kills: number;
  deaths: number;
  /** When this row is part of a wins-bucket of size > 1, which rule resolved its
   *  position relative to the other tied teams. Null otherwise. */
  tiebreaker: { rule: TiebreakerRule; value: number | string } | null;
}

export interface RawRecord {
  id: string;
  wins: number;
  losses: number;
  pointsFor: number;   // total kills (sum of own scores)
  pointsAgainst: number; // total deaths (sum of opponent scores)
}

/**
 * Pure ranking function — separated so tests can exercise the tiebreaker
 * hierarchy without standing up a SQLite DB. `h2hLookup(tiedIds)` returns the
 * head-to-head wins map for the given set of tied team IDs.
 */
export function orderRecords(
  records: RawRecord[],
  h2hLookup: (tiedIds: string[]) => Map<string, number>,
): TeamStandingRow[] {
  // Group by wins
  const buckets = new Map<number, RawRecord[]>();
  for (const r of records) {
    const arr = buckets.get(r.wins) ?? [];
    arr.push(r);
    buckets.set(r.wins, arr);
  }

  const sortedWins = Array.from(buckets.keys()).sort((a, b) => b - a);
  const out: TeamStandingRow[] = [];
  for (const w of sortedWins) {
    out.push(...resolveBucketPure(buckets.get(w)!, h2hLookup));
  }
  return out;
}

function resolveBucketPure(
  bucket: RawRecord[],
  h2hLookup: (tiedIds: string[]) => Map<string, number>,
): TeamStandingRow[] {
  if (bucket.length === 1) {
    const r = bucket[0];
    return [{
      id: r.id,
      wins: r.wins,
      losses: r.losses,
      differential: r.pointsFor - r.pointsAgainst,
      kills: r.pointsFor,
      deaths: r.pointsAgainst,
      tiebreaker: null,
    }];
  }

  const tiedIds = bucket.map(r => r.id);
  const h2h = h2hLookup(tiedIds);

  const enriched = bucket.map(r => ({
    ...r,
    differential: r.pointsFor - r.pointsAgainst,
    h2hWins: h2h.get(r.id) ?? 0,
  }));

  enriched.sort((a, b) => {
    if (b.h2hWins !== a.h2hWins) return b.h2hWins - a.h2hWins;
    if (b.differential !== a.differential) return b.differential - a.differential;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.id.localeCompare(b.id);
  });

  const allSameH2h = enriched.every(r => r.h2hWins === enriched[0].h2hWins);
  const allSameDiff = enriched.every(r => r.differential === enriched[0].differential);
  const allSameKills = enriched.every(r => r.pointsFor === enriched[0].pointsFor);

  return enriched.map(r => {
    let tb: TeamStandingRow['tiebreaker'];
    if (!allSameH2h) tb = { rule: 'h2h', value: r.h2hWins };
    else if (!allSameDiff) tb = { rule: 'diff', value: r.differential };
    else if (!allSameKills) tb = { rule: 'kills', value: r.pointsFor };
    else tb = { rule: 'id', value: r.id };
    return {
      id: r.id,
      wins: r.wins,
      losses: r.losses,
      differential: r.differential,
      kills: r.pointsFor,
      deaths: r.pointsAgainst,
      tiebreaker: tb,
    };
  });
}

/**
 * Decide the winner of a completed match. Prefers the explicit `winnerTeamId`
 * (set from the Showdown |win| flag / adjudicated forfeit survivor) so a
 * forfeit at full health — which emits equal KO scores like 2-2 — still records
 * a correct W/L. Falls back to score comparison for legacy/sim rows that
 * predate the column. Returns null for ties / no-contests (double-forfeit 0-0).
 */
export function matchWinner(m: { winnerTeamId: string | null; homeTeamId: string | null; awayTeamId: string | null; homeScore: number | null; awayScore: number | null }): string | null {
  if (m.winnerTeamId) return m.winnerTeamId;
  if (m.homeScore == null || m.awayScore == null) return null;
  if (m.homeScore > m.awayScore) return m.homeTeamId;
  if (m.awayScore > m.homeScore) return m.awayTeamId;
  return null;
}

/**
 * Compute raw W/L/PF/PA for every team in a league, using regular-season completed
 * matches only. The winner is taken from `winnerTeamId` when present (score
 * comparison fallback) so forfeits scored e.g. 2-2 credit the right side; PF/PA
 * remain the raw KO totals.
 */
function rawRecords(leagueId: string, opts: { phase?: 'regular' | 'all'; maxWeek?: number | null } = {}): RawRecord[] {
  const phase = opts.phase ?? 'regular';
  const maxWeek = opts.maxWeek;
  const teams = db.select().from(schema.teams)
    .where(eq(schema.teams.leagueId, leagueId))
    .all();

  const phaseClause = phase === 'regular'
    ? eq(schema.matches.phase, 'regular')
    : undefined;

  // Results-reveal gate: when maxWeek is set, only count matches up through that
  // week so standings/records don't move until an admin reveals later weeks.
  const weekClause = maxWeek != null
    ? sql`${schema.matches.week} <= ${maxWeek}`
    : undefined;

  const completed = db.select().from(schema.matches)
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.status, 'completed'),
      sql`home_score IS NOT NULL`,
      phaseClause,
      weekClause,
    ))
    .all();

  const byTeam = new Map<string, RawRecord>(
    teams.map(t => [t.id, { id: t.id, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }]),
  );

  for (const m of completed) {
    // Completed matches always have both teams resolved; guard for the type.
    if (m.homeTeamId == null || m.awayTeamId == null) continue;
    const home = byTeam.get(m.homeTeamId);
    const away = byTeam.get(m.awayTeamId);
    const hs = m.homeScore ?? 0;
    const as = m.awayScore ?? 0;
    if (home) { home.pointsFor += hs; home.pointsAgainst += as; }
    if (away) { away.pointsFor += as; away.pointsAgainst += hs; }

    const winner = matchWinner(m);
    if (winner === m.homeTeamId) {
      if (home) home.wins++;
      if (away) away.losses++;
    } else if (winner === m.awayTeamId) {
      if (away) away.wins++;
      if (home) home.losses++;
    }
    // null winner → tie / no-contest; no W or L credited to either side.
  }

  return teams.map(t => byTeam.get(t.id)!);
}

/**
 * Head-to-head wins map for a tied set: returns each teamId's win count *only*
 * in matches whose both participants are in `tiedIds`. Losses can be derived as
 * (gamesPlayedInSet - wins) but we only need wins for ordering.
 *
 * For a multi-way tie this naturally produces a sub-cycle ordering; if every
 * team in the set has the same H2H record, the next tiebreaker (diff) applies.
 */
function headToHeadWins(leagueId: string, tiedIds: string[], maxWeek?: number | null): Map<string, number> {
  const result = new Map<string, number>(tiedIds.map(id => [id, 0]));
  if (tiedIds.length < 2) return result;

  // Results-reveal gate: mirror rawRecords so H2H tiebreaks only consider
  // revealed weeks when the gate is on.
  const weekClause = maxWeek != null
    ? sql`${schema.matches.week} <= ${maxWeek}`
    : undefined;

  // Filter in JS after fetching matches that involve any of these teams.
  const setIds = new Set(tiedIds);
  const matches = db.select().from(schema.matches)
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'regular'),
      eq(schema.matches.status, 'completed'),
      sql`home_score IS NOT NULL`,
      weekClause,
    ))
    .all()
    .filter(m => m.homeTeamId != null && m.awayTeamId != null
      && setIds.has(m.homeTeamId) && setIds.has(m.awayTeamId));

  for (const m of matches) {
    const winner = matchWinner(m);
    if (winner == null) continue; // ties / no-contests contribute nothing
    if (winner === m.homeTeamId) {
      result.set(winner, (result.get(winner) ?? 0) + 1);
    } else if (winner === m.awayTeamId) {
      result.set(winner, (result.get(winner) ?? 0) + 1);
    }
    // ties / no-contests contribute nothing
  }
  return result;
}

/**
 * Compute the fully sorted standings for a league using the documented
 * tiebreaker hierarchy. Deterministic and stable across calls.
 */
export function computeStandings(
  leagueId: string,
  opts: { phase?: 'regular' | 'all'; maxWeek?: number | null } = {},
): TeamStandingRow[] {
  const records = rawRecords(leagueId, opts);
  return orderRecords(records, tiedIds => headToHeadWins(leagueId, tiedIds, opts.maxWeek));
}
