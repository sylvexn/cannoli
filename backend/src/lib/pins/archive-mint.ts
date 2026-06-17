/**
 * Archive-time pin minter for the four awards added when the archive feature
 * shipped: champion, high-score, steal-of-the-draft, sweeper.
 *
 * The existing season-end auto-awards (garchomp/cannoli/cynthia) live in
 * lib/pins/auto-award.ts and run via runAutoAwards(leagueId, season-end).
 * This module is the companion that mints the four new pins; both fire from
 * the admin "Archive Season" action so the UI sees one unified award set.
 *
 * Idempotent: every insert is INSERT OR IGNORE against the
 * (user_id, pin_def_id, season_id) unique index. Re-running on an already-
 * archived season is safe (and useful when stats are corrected post-archive).
 *
 * Each minter tries to find a winner; on a tie we mint to all tied users
 * (rare; metadata records the value).
 *
 * Pure-vs-impure boundary mirrors lib/pins/auto-award.ts: each award has a
 * `pickXxx` pure function (input rows → output winners) for unit testing,
 * and a `awardXxx` orchestrator that queries DB → calls picker → inserts
 * pins.
 */

import { db, schema } from '../../db';
import { and, eq, sql } from 'drizzle-orm';
import { tx } from '../tx';

const PIN = {
  champion: 'champion',
  highScore: 'high-score',
  stealOfTheDraft: 'steal-of-the-draft',
  sweeper: 'sweeper',
} as const;

export interface ArchiveMintSummary {
  leagueId: string;
  seasonId: number;
  awarded: { pinDefId: string; userId: number; metadata: Record<string, unknown> }[];
  skipped: number;
}

interface MintOpts {
  awardedBy?: number | null;
  /** Default true. Pass false to keep prior auto-award rows for the league.
   *  Useful when re-running just one league without losing sibling data. */
  clearPrevious?: boolean;
}

export function mintArchivePins(leagueId: string, opts: MintOpts = {}): ArchiveMintSummary {
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  const summary: ArchiveMintSummary = {
    leagueId,
    seasonId: league?.seasonId ?? 0,
    awarded: [],
    skipped: 0,
  };
  if (!league) return summary;

  const { seasonId } = league;
  const awardedBy = opts.awardedBy ?? null;
  const clear = opts.clearPrevious !== false;

  // Re-runs after stats corrections need a clean slate for THIS league's
  // teams. Match auto-award.ts: scope by metadata.teamId to avoid stomping
  // on sibling-league pins for coaches who play in multiple leagues.
  //
  // Wrapped in tx() so the clear and the re-inserts are atomic — a crash
  // between them can no longer leave this league's season pins in a deleted
  // but not yet re-awarded state.
  tx(() => {
    if (clear) {
      db.run(sql`
        DELETE FROM pins
        WHERE pin_def_id IN (${PIN.champion}, ${PIN.highScore}, ${PIN.stealOfTheDraft}, ${PIN.sweeper})
          AND season_id = ${seasonId}
          AND awarded_by IS NULL
          AND json_extract(metadata, '$.teamId') IN (
            SELECT id FROM teams WHERE league_id = ${leagueId}
          )
      `);
    }

    awardChampion(leagueId, seasonId, awardedBy, summary);
    awardHighScore(leagueId, seasonId, awardedBy, summary);
    awardStealOfTheDraft(leagueId, seasonId, awardedBy, summary);
    awardSweeper(leagueId, seasonId, awardedBy, summary);
  });

  return summary;
}

// ─── Pure helpers (testable without DB) ───────────────────────────────────

export interface ChampionFinalsRow {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
}
export interface ChampionWinner {
  winnerTeamId: string;
  loserTeamId: string;
  winnerSum: number;
  loserSum: number;
}

/**
 * Pick the finals winner from one or more finals matches (best-of-N is
 * resolved by summing scores). All matches are assumed to be the same
 * matchup (home/away pairing); the first row is used as the reference for
 * the team-id mapping.
 *
 * Returns null when:
 *   - no rows
 *   - any match is unfinished (homeScore/awayScore null)
 *   - the series is tied (homeSum === awaySum)
 */
export function pickChampion(rows: ChampionFinalsRow[]): ChampionWinner | null {
  if (rows.length === 0) return null;
  let homeSum = 0;
  let awaySum = 0;
  for (const m of rows) {
    if (m.homeScore == null || m.awayScore == null) return null;
    homeSum += m.homeScore;
    awaySum += m.awayScore;
  }
  if (homeSum === awaySum) return null;
  const ref = rows[0];
  // A scored finals always has both teams resolved (not a NULL bracket slot).
  if (ref.homeTeamId == null || ref.awayTeamId == null) return null;
  const winnerIsHome = homeSum > awaySum;
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

// ─── Helpers ──────────────────────────────────────────────────────────────

function teamUserId(teamId: string): number | null {
  const team = db.select({ userId: schema.teams.userId })
    .from(schema.teams).where(eq(schema.teams.id, teamId)).get();
  return team?.userId ?? null;
}

function tryInsert(
  pinDefId: string,
  userId: number,
  seasonId: number,
  awardedBy: number | null,
  metadata: Record<string, unknown>,
  summary: ArchiveMintSummary,
): boolean {
  const res = db.run(sql`
    INSERT OR IGNORE INTO pins (user_id, pin_def_id, season_id, awarded_by, metadata)
    VALUES (${userId}, ${pinDefId}, ${seasonId}, ${awardedBy}, ${JSON.stringify(metadata)})
  `);
  const changed = (res as unknown as { changes?: number } | undefined)?.changes ?? 0;
  if (changed > 0) {
    summary.awarded.push({ pinDefId, userId, metadata });
    return true;
  }
  summary.skipped += 1;
  return false;
}

// ─── Champion (finals winner) ─────────────────────────────────────────────

function awardChampion(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: ArchiveMintSummary,
) {
  const finals = db.select().from(schema.matches)
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'playoffs'),
      eq(schema.matches.playoffRound, 'f'),
    ))
    .all();

  const winner = pickChampion(finals.map(m => ({
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
  })));
  if (!winner) return;

  const uid = teamUserId(winner.winnerTeamId);
  if (!uid) return;
  tryInsert(
    PIN.champion, uid, seasonId, awardedBy,
    {
      teamId: winner.winnerTeamId,
      runnerUpTeamId: winner.loserTeamId,
      seriesScore: `${winner.winnerSum}-${winner.loserSum}`,
    },
    summary,
  );
}

// ─── High Score (most kills by a single Pokemon in a single match) ────────

function awardHighScore(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: ArchiveMintSummary,
) {
  const rows = db.select({
    pokemonName: schema.matchPokemon.pokemonName,
    teamId: schema.matchPokemon.teamId,
    matchId: schema.matchPokemon.matchId,
    kills: schema.matchPokemon.kills,
    week: schema.matches.week,
    phase: schema.matches.phase,
  })
    .from(schema.matchPokemon)
    .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPokemon.matchId))
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.status, 'completed'),
    ))
    .all();

  const winners = pickHighScore(rows.map(r => ({
    teamId: r.teamId,
    pokemonName: r.pokemonName,
    matchId: r.matchId,
    kills: r.kills ?? 0,
    week: r.week,
    phase: r.phase,
  })));

  for (const r of winners) {
    const uid = teamUserId(r.teamId);
    if (!uid) continue;
    tryInsert(
      PIN.highScore, uid, seasonId, awardedBy,
      { teamId: r.teamId, pokemon: r.pokemonName, kills: r.kills, matchId: r.matchId, week: r.week, phase: r.phase },
      summary,
    );
  }
}

// ─── Steal of the Draft (best K-per-point on a drafted Pokemon) ───────────
// Uses costAtDraft (or falls back to roster.tier) so trade arrivals don't
// skew a team's "draft value". Minimum 1 GP and cost >= 1 to avoid div-by-0
// and silly steals from $0 picks.

function awardStealOfTheDraft(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: ArchiveMintSummary,
) {
  const rows = db.select({
    teamId: schema.matchPokemon.teamId,
    pokemonName: schema.matchPokemon.pokemonName,
    kills: sql<number>`COALESCE(SUM(${schema.matchPokemon.kills}), 0)`,
    gp: sql<number>`COUNT(*)`,
    cost: sql<number>`COALESCE(MAX(${schema.rosters.costAtDraft}), MAX(${schema.rosters.tier}))`,
  })
    .from(schema.matchPokemon)
    .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPokemon.matchId))
    .innerJoin(schema.rosters, and(
      eq(schema.rosters.teamId, schema.matchPokemon.teamId),
      eq(schema.rosters.pokemonName, schema.matchPokemon.pokemonName),
    ))
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.status, 'completed'),
      eq(schema.rosters.acquiredVia, 'draft'),
    ))
    .groupBy(schema.matchPokemon.teamId, schema.matchPokemon.pokemonName)
    .all();

  const winners = pickStealOfTheDraft(rows.map(r => ({
    teamId: r.teamId,
    pokemonName: r.pokemonName,
    kills: r.kills,
    gp: r.gp,
    cost: r.cost,
  })));

  for (const w of winners) {
    const uid = teamUserId(w.teamId);
    if (!uid) continue;
    tryInsert(
      PIN.stealOfTheDraft, uid, seasonId, awardedBy,
      { teamId: w.teamId, pokemon: w.pokemonName, kills: w.kills, cost: w.cost, ratio: w.ratio },
      summary,
    );
  }
}

// ─── Sweeper (most 6-0 sweeps logged across the season) ──────────────────
// A sweep = winning a match with 0 deaths. Reuses the same logic as the
// per-match `flawless` award but aggregated over the season.

function awardSweeper(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: ArchiveMintSummary,
) {
  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  if (teams.length === 0) return;
  const teamIds = new Set(teams.map(t => t.id));

  const matches = db.select({
    id: schema.matches.id,
    homeTeamId: schema.matches.homeTeamId,
    awayTeamId: schema.matches.awayTeamId,
    homeScore: schema.matches.homeScore,
    awayScore: schema.matches.awayScore,
  })
    .from(schema.matches)
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.status, 'completed'),
    ))
    .all();

  const sweeperRows: SweeperMatchRow[] = [];
  for (const m of matches) {
    if (m.homeScore == null || m.awayScore == null) continue;
    if (m.homeScore === m.awayScore) continue;
    const winnerId = m.homeScore > m.awayScore ? m.homeTeamId : m.awayTeamId;
    if (winnerId == null || !teamIds.has(winnerId)) continue;

    const row = db.select({
      deaths: sql<number>`COALESCE(SUM(${schema.matchPokemon.deaths}), 0)`,
      gp: sql<number>`COUNT(*)`,
    })
      .from(schema.matchPokemon)
      .where(and(
        eq(schema.matchPokemon.matchId, m.id),
        eq(schema.matchPokemon.teamId, winnerId),
      ))
      .get();
    sweeperRows.push({
      matchId: m.id,
      winnerTeamId: winnerId,
      winnerGp: row?.gp ?? 0,
      winnerDeaths: row?.deaths ?? 0,
    });
  }

  const winners = pickSweeper(sweeperRows);
  for (const w of winners) {
    const uid = teamUserId(w.teamId);
    if (!uid) continue;
    tryInsert(
      PIN.sweeper, uid, seasonId, awardedBy,
      { teamId: w.teamId, sweeps: w.sweeps },
      summary,
    );
  }
}
