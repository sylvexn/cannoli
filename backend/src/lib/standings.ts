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
 * Compute raw W/L/PF/PA for every team in a league, using regular-season completed
 * matches only (forfeits count: a forfeited match has homeScore/awayScore set to
 * 0/whatever by the forfeit policy and a winner already determined by the score).
 */
function rawRecords(leagueId: string, opts: { phase?: 'regular' | 'all' } = {}): RawRecord[] {
  const phase = opts.phase ?? 'regular';
  const teams = db.select().from(schema.teams)
    .where(eq(schema.teams.leagueId, leagueId))
    .all();

  return teams.map(team => {
    const phaseClause = phase === 'regular'
      ? eq(schema.matches.phase, 'regular')
      : undefined;

    const home = db.select({
      w: sql<number>`COALESCE(SUM(CASE WHEN home_score > away_score THEN 1 ELSE 0 END), 0)`,
      l: sql<number>`COALESCE(SUM(CASE WHEN home_score < away_score THEN 1 ELSE 0 END), 0)`,
      pf: sql<number>`COALESCE(SUM(home_score), 0)`,
      pa: sql<number>`COALESCE(SUM(away_score), 0)`,
    }).from(schema.matches)
      .where(and(
        eq(schema.matches.homeTeamId, team.id),
        eq(schema.matches.status, 'completed'),
        sql`home_score IS NOT NULL`,
        phaseClause,
      ))
      .get() ?? { w: 0, l: 0, pf: 0, pa: 0 };

    const away = db.select({
      w: sql<number>`COALESCE(SUM(CASE WHEN away_score > home_score THEN 1 ELSE 0 END), 0)`,
      l: sql<number>`COALESCE(SUM(CASE WHEN away_score < home_score THEN 1 ELSE 0 END), 0)`,
      pf: sql<number>`COALESCE(SUM(away_score), 0)`,
      pa: sql<number>`COALESCE(SUM(home_score), 0)`,
    }).from(schema.matches)
      .where(and(
        eq(schema.matches.awayTeamId, team.id),
        eq(schema.matches.status, 'completed'),
        sql`away_score IS NOT NULL`,
        phaseClause,
      ))
      .get() ?? { w: 0, l: 0, pf: 0, pa: 0 };

    return {
      id: team.id,
      wins: (home.w || 0) + (away.w || 0),
      losses: (home.l || 0) + (away.l || 0),
      pointsFor: (home.pf || 0) + (away.pf || 0),
      pointsAgainst: (home.pa || 0) + (away.pa || 0),
    };
  });
}

/**
 * Head-to-head wins map for a tied set: returns each teamId's win count *only*
 * in matches whose both participants are in `tiedIds`. Losses can be derived as
 * (gamesPlayedInSet - wins) but we only need wins for ordering.
 *
 * For a multi-way tie this naturally produces a sub-cycle ordering; if every
 * team in the set has the same H2H record, the next tiebreaker (diff) applies.
 */
function headToHeadWins(leagueId: string, tiedIds: string[]): Map<string, number> {
  const result = new Map<string, number>(tiedIds.map(id => [id, 0]));
  if (tiedIds.length < 2) return result;

  // Use IN clause via SQL — fetch all completed regular-season matches between
  // members of the set.
  const placeholders = tiedIds.map(() => '?').join(',');
  // Safer: filter in JS after fetching matches that involve any of these teams.
  const setIds = new Set(tiedIds);
  const matches = db.select().from(schema.matches)
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'regular'),
      eq(schema.matches.status, 'completed'),
      sql`home_score IS NOT NULL`,
    ))
    .all()
    .filter(m => setIds.has(m.homeTeamId) && setIds.has(m.awayTeamId));

  for (const m of matches) {
    if (m.homeScore == null || m.awayScore == null) continue;
    if (m.homeScore > m.awayScore) {
      result.set(m.homeTeamId, (result.get(m.homeTeamId) ?? 0) + 1);
    } else if (m.awayScore > m.homeScore) {
      result.set(m.awayTeamId, (result.get(m.awayTeamId) ?? 0) + 1);
    }
    // ties (shouldn't happen in pokemon scoring) contribute nothing
  }
  // Suppress unused placeholder warning
  void placeholders;
  return result;
}

/**
 * Compute the fully sorted standings for a league using the documented
 * tiebreaker hierarchy. Deterministic and stable across calls.
 */
export function computeStandings(
  leagueId: string,
  opts: { phase?: 'regular' | 'all' } = {},
): TeamStandingRow[] {
  const records = rawRecords(leagueId, opts);
  return orderRecords(records, tiedIds => headToHeadWins(leagueId, tiedIds));
}
