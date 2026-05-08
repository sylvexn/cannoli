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
 */

import { db, schema } from '../../db';
import { and, eq, sql } from 'drizzle-orm';

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

  return summary;
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
  if (finals.length === 0) return;

  // Multiple finals (e.g. best-of-3) — sum scores to pick the series winner.
  let homeTotal = 0, awayTotal = 0;
  for (const m of finals) {
    if (m.homeScore == null || m.awayScore == null) return; // unfinished
    homeTotal += m.homeScore;
    awayTotal += m.awayScore;
  }
  if (homeTotal === awayTotal) return; // unresolved

  const ref = finals[0];
  const winnerId = homeTotal > awayTotal ? ref.homeTeamId : ref.awayTeamId;
  const loserId = homeTotal > awayTotal ? ref.awayTeamId : ref.homeTeamId;
  const uid = teamUserId(winnerId);
  if (!uid) return;
  tryInsert(
    PIN.champion, uid, seasonId, awardedBy,
    {
      teamId: winnerId,
      runnerUpTeamId: loserId,
      seriesScore: `${Math.max(homeTotal, awayTotal)}-${Math.min(homeTotal, awayTotal)}`,
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
  const top = db.select({
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
    .orderBy(sql`${schema.matchPokemon.kills} DESC`)
    .limit(1)
    .get();

  if (!top || (top.kills ?? 0) <= 0) return;

  // Tie: any Pokemon with the same peak kills gets a copy.
  const tied = db.select({
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
      eq(schema.matchPokemon.kills, top.kills),
    ))
    .all();

  for (const r of tied) {
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

  const candidates = rows
    .filter(r => r.gp >= 1 && (r.cost ?? 0) >= 1 && r.kills > 0)
    .map(r => ({ ...r, ratio: r.kills / Math.max(1, r.cost) }));
  if (candidates.length === 0) return;

  const top = candidates.reduce((a, r) => Math.max(a, r.ratio), 0);
  const winners = candidates.filter(r => r.ratio === top);

  for (const w of winners) {
    const uid = teamUserId(w.teamId);
    if (!uid) continue;
    tryInsert(
      PIN.stealOfTheDraft, uid, seasonId, awardedBy,
      { teamId: w.teamId, pokemon: w.pokemonName, kills: w.kills, cost: w.cost, ratio: Number(w.ratio.toFixed(3)) },
      summary,
    );
  }
}

// ─── Sweeper (most 6-0 sweeps logged across the season) ──────────────────
// A sweep = winning a match with 0 deaths. Reuses the same logic as the
// per-match `flawless` award but aggregated over the season. Ties on count
// fall back to fewest losses (best sweep rate); ties on that mint to all.

function awardSweeper(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: ArchiveMintSummary,
) {
  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  if (teams.length === 0) return;

  const sweepsByTeam = new Map<string, number>();
  for (const t of teams) sweepsByTeam.set(t.id, 0);

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

  for (const m of matches) {
    if (m.homeScore == null || m.awayScore == null) continue;
    if (m.homeScore === m.awayScore) continue;
    const winnerId = m.homeScore > m.awayScore ? m.homeTeamId : m.awayTeamId;

    // Winner had 0 deaths → sweep.
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
    if (!row || (row.gp ?? 0) === 0) continue;
    if ((row.deaths ?? 0) > 0) continue;
    sweepsByTeam.set(winnerId, (sweepsByTeam.get(winnerId) ?? 0) + 1);
  }

  let topCount = 0;
  for (const [, c] of sweepsByTeam) if (c > topCount) topCount = c;
  if (topCount === 0) return;

  const winners = [...sweepsByTeam.entries()].filter(([, c]) => c === topCount).map(([teamId, c]) => ({ teamId, sweeps: c }));
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
