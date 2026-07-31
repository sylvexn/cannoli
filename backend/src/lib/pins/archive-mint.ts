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
 * `pins_identity_idx` unique index on (user_id, pin_def_id, season_id,
 * league_id). Re-running on an already-archived season is safe (and useful
 * when stats are corrected post-archive).
 *
 * Every insert here is `source: 'auto'`. A `source: 'manual'` pin for the
 * same (pinDefId, seasonId, leagueId) is human-authoritative — this job
 * never deletes one and never mints a competing row over one; see
 * `hasManualPin` below.
 *
 * Winners are read off `matches.winnerTeamId` (via the shared `matchWinner()`
 * helper) rather than re-deriving from score comparison, so a forfeit at full
 * health (equal KO score, e.g. 2-2, but a real winner) resolves a champion /
 * sweeper correctly instead of being treated as an unfinished/tied series.
 *
 * Every stat pin awards exactly ONE winner per league — never a split. Each
 * `pickXxx` narrows ties with its own criterion, then falls through to the
 * shared `breakTieByRank` (lib/pins/tiebreak.ts) so the result is always
 * deterministic and stable across re-runs. Champion is the one exception —
 * it's inherently 1v1, so its own home/away resolution already produces at
 * most one winner.
 *
 * Pure-vs-impure boundary mirrors lib/pins/auto-award.ts: each award has a
 * `pickXxx` pure function (input rows → output winners, in
 * archive-mint-pickers.ts, re-exported here for callers) for unit testing,
 * and a `awardXxx` orchestrator that queries DB → calls picker → inserts
 * pins.
 */

import { db, schema } from '../../db';
import { and, eq, sql } from 'drizzle-orm';
import { tx } from '../tx';
import { matchWinner } from '../standings';
import {
  pickChampion, pickHighScore, pickStealOfTheDraft, pickSweeper, STEAL_MIN_KILLS,
  type ChampionFinalsRow, type ChampionWinner,
  type HighScoreRow, type HighScoreWinner,
  type StealRow, type StealWinner,
  type SweeperMatchRow, type SweeperWinner,
} from './archive-mint-pickers';

export {
  pickChampion, pickHighScore, pickStealOfTheDraft, pickSweeper, STEAL_MIN_KILLS,
  type ChampionFinalsRow, type ChampionWinner,
  type HighScoreRow, type HighScoreWinner,
  type StealRow, type StealWinner,
  type SweeperMatchRow, type SweeperWinner,
};

const PIN = {
  champion: 'champion',
  highScore: 'high-score',
  stealOfTheDraft: 'steal-of-the-draft',
  sweeper: 'sweeper',
} as const;

export interface UnresolvedEntry {
  pinDefId: string;
  reason: 'team-has-no-user' | 'no-eligible-matches' | 'manual-pin-present' | 'tie-unresolved'
    | 'no-pokemon-met-kill-floor';
  teamId?: string;
  leagueId?: string;
}

export interface ArchiveMintSummary {
  leagueId: string;
  seasonId: number;
  awarded: { pinDefId: string; userId: number; metadata: Record<string, unknown> }[];
  skipped: number;
  unresolved: UnresolvedEntry[];
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
    unresolved: [],
  };
  if (!league) return summary;

  const { seasonId } = league;
  const awardedBy = opts.awardedBy ?? null;
  const clear = opts.clearPrevious !== false;

  // Re-runs after stats corrections need a clean slate for THIS league's
  // auto pins. Keyed on `source = 'auto'` (never `awarded_by`, which is
  // provenance only — see migration 0069) and the real `league_id` column,
  // so a coach who plays in multiple leagues never has a sibling league's pin
  // touched, and a human-authoritative (`source = 'manual'`) pin survives.
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
          AND source = 'auto'
          AND league_id = ${leagueId}
      `);
    }

    awardChampion(leagueId, seasonId, awardedBy, summary);
    awardHighScore(leagueId, seasonId, awardedBy, summary);
    awardStealOfTheDraft(leagueId, seasonId, awardedBy, summary);
    awardSweeper(leagueId, seasonId, awardedBy, summary);
  });

  return summary;
}

// Helpers

/**
 * True when a `source = 'manual'` pin already exists for this exact
 * (pinDefId, seasonId, leagueId) slot. Manual pins are human-authoritative —
 * this job must not mint a competing row for the slot even for a DIFFERENT
 * winner/user, so callers check this once per award, before doing any
 * per-winner work, and skip the whole slot when true.
 */
function hasManualPin(pinDefId: string, seasonId: number | null, leagueId: string): boolean {
  const row = db.select({ c: sql<number>`COUNT(*)` })
    .from(schema.pins)
    .where(and(
      eq(schema.pins.pinDefId, pinDefId),
      eq(schema.pins.source, 'manual'),
      seasonId == null ? sql`${schema.pins.seasonId} IS NULL` : eq(schema.pins.seasonId, seasonId),
      eq(schema.pins.leagueId, leagueId),
    ))
    .get();
  return (row?.c ?? 0) > 0;
}

function teamUserId(teamId: string): number | null {
  const team = db.select({ userId: schema.teams.userId })
    .from(schema.teams).where(eq(schema.teams.id, teamId)).get();
  return team?.userId ?? null;
}

/** Team id → teams.rank for every team in the league, for the general
 *  tiebreak fallback (see lib/pins/tiebreak.ts). */
function teamRankMap(leagueId: string): Map<string, number | null> {
  const rows = db.select({ id: schema.teams.id, rank: schema.teams.rank })
    .from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  return new Map(rows.map(r => [r.id, r.rank]));
}

function tryInsert(
  pinDefId: string,
  userId: number,
  seasonId: number,
  leagueId: string,
  awardedBy: number | null,
  metadata: Record<string, unknown>,
  summary: ArchiveMintSummary,
): boolean {
  const res = db.run(sql`
    INSERT OR IGNORE INTO pins (user_id, pin_def_id, season_id, league_id, awarded_by, source, metadata)
    VALUES (${userId}, ${pinDefId}, ${seasonId}, ${leagueId}, ${awardedBy}, 'auto', ${JSON.stringify(metadata)})
  `);
  const changed = (res as unknown as { changes?: number } | undefined)?.changes ?? 0;
  if (changed > 0) {
    summary.awarded.push({ pinDefId, userId, metadata });

    // Mirror auto-award.ts's tryInsert: emit a `pin_awarded` activity-log
    // event so archive-minted pins show up in the admin Activity Log
    // alongside hand-mints. Best-effort — don't fail the award if logging
    // trips for any reason.
    try {
      const def = db.select().from(schema.pinDefinitions)
        .where(eq(schema.pinDefinitions.id, pinDefId)).get();
      const targetUser = db.select().from(schema.users)
        .where(eq(schema.users.id, userId)).get();
      const actor = awardedBy
        ? db.select({ username: schema.users.username })
            .from(schema.users).where(eq(schema.users.id, awardedBy)).get()?.username ?? 'system'
        : 'system';
      db.insert(schema.activityLog).values({
        type: 'pin_awarded',
        category: 'admin',
        actor,
        leagueId: null,
        description: `Auto-awarded '${def?.name ?? pinDefId}' to ${targetUser?.username ?? 'user#' + userId}`,
        metadata: JSON.stringify({
          userId,
          username: targetUser?.username ?? null,
          pinDefId,
          pinName: def?.name ?? pinDefId,
          seasonId,
          awardedById: awardedBy,
          auto: true,
          ...metadata,
        }),
      }).run();
    } catch {
      /* swallow — logging is best-effort */
    }
    return true;
  }
  summary.skipped += 1;
  return false;
}

// Champion (finals winner)

function awardChampion(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: ArchiveMintSummary,
) {
  if (hasManualPin(PIN.champion, seasonId, leagueId)) {
    summary.unresolved.push({ pinDefId: PIN.champion, reason: 'manual-pin-present', leagueId });
    return;
  }

  const finals = db.select().from(schema.matches)
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'playoffs'),
      eq(schema.matches.playoffRound, 'f'),
    ))
    .all();
  if (finals.length === 0) {
    summary.unresolved.push({ pinDefId: PIN.champion, reason: 'no-eligible-matches', leagueId });
    return;
  }

  const winner = pickChampion(finals.map(m => ({
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    winnerTeamId: m.winnerTeamId,
  })));
  if (!winner) {
    summary.unresolved.push({ pinDefId: PIN.champion, reason: 'tie-unresolved', leagueId });
    return;
  }

  const uid = teamUserId(winner.winnerTeamId);
  if (!uid) {
    summary.unresolved.push({ pinDefId: PIN.champion, reason: 'team-has-no-user', teamId: winner.winnerTeamId, leagueId });
    return;
  }
  tryInsert(
    PIN.champion, uid, seasonId, leagueId, awardedBy,
    {
      teamId: winner.winnerTeamId,
      runnerUpTeamId: winner.loserTeamId,
      seriesScore: `${winner.winnerSum}-${winner.loserSum}`,
    },
    summary,
  );
}

// High Score (most kills by a single Pokemon in a single match)

function awardHighScore(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: ArchiveMintSummary,
) {
  if (hasManualPin(PIN.highScore, seasonId, leagueId)) {
    summary.unresolved.push({ pinDefId: PIN.highScore, reason: 'manual-pin-present', leagueId });
    return;
  }

  const rows = db.select({
    pokemonName: schema.matchPokemon.pokemonName,
    teamId: schema.matchPokemon.teamId,
    matchId: schema.matchPokemon.matchId,
    kills: schema.matchPokemon.kills,
    deaths: schema.matchPokemon.deaths,
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
  if (rows.length === 0) {
    summary.unresolved.push({ pinDefId: PIN.highScore, reason: 'no-eligible-matches', leagueId });
    return;
  }

  const rankOf = teamRankMap(leagueId);
  const winners = pickHighScore(rows.map(r => ({
    teamId: r.teamId,
    pokemonName: r.pokemonName,
    matchId: r.matchId,
    kills: r.kills ?? 0,
    deaths: r.deaths ?? 0,
    week: r.week,
    phase: r.phase,
    teamRank: rankOf.get(r.teamId) ?? null,
  })));

  for (const r of winners) {
    const uid = teamUserId(r.teamId);
    if (!uid) {
      summary.unresolved.push({ pinDefId: PIN.highScore, reason: 'team-has-no-user', teamId: r.teamId, leagueId });
      continue;
    }
    tryInsert(
      PIN.highScore, uid, seasonId, leagueId, awardedBy,
      { teamId: r.teamId, pokemon: r.pokemonName, kills: r.kills, matchId: r.matchId, week: r.week, phase: r.phase },
      summary,
    );
  }
}

// Steal of the Draft (best K-per-point on a drafted Pokemon)
// Uses costAtDraft (or falls back to roster.tier) so trade arrivals don't
// skew a team's "draft value". Minimum 1 GP and cost >= 1 to avoid div-by-0
// and silly steals from $0 picks.

function awardStealOfTheDraft(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: ArchiveMintSummary,
) {
  if (hasManualPin(PIN.stealOfTheDraft, seasonId, leagueId)) {
    summary.unresolved.push({ pinDefId: PIN.stealOfTheDraft, reason: 'manual-pin-present', leagueId });
    return;
  }

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
  if (rows.length === 0) {
    summary.unresolved.push({ pinDefId: PIN.stealOfTheDraft, reason: 'no-eligible-matches', leagueId });
    return;
  }

  const rankOf = teamRankMap(leagueId);
  const winners = pickStealOfTheDraft(rows.map(r => ({
    teamId: r.teamId,
    pokemonName: r.pokemonName,
    kills: r.kills,
    gp: r.gp,
    cost: r.cost,
    teamRank: rankOf.get(r.teamId) ?? null,
  })));
  if (winners.length === 0) {
    // Rows existed, but nobody cleared STEAL_MIN_KILLS — distinct from
    // 'no-eligible-matches' (no data at all) so this is traceable, not silent.
    summary.unresolved.push({ pinDefId: PIN.stealOfTheDraft, reason: 'no-pokemon-met-kill-floor', leagueId });
    return;
  }

  for (const w of winners) {
    const uid = teamUserId(w.teamId);
    if (!uid) {
      summary.unresolved.push({ pinDefId: PIN.stealOfTheDraft, reason: 'team-has-no-user', teamId: w.teamId, leagueId });
      continue;
    }
    tryInsert(
      PIN.stealOfTheDraft, uid, seasonId, leagueId, awardedBy,
      { teamId: w.teamId, pokemon: w.pokemonName, kills: w.kills, cost: w.cost, ratio: w.ratio },
      summary,
    );
  }
}

// Sweeper (most 6-0 sweeps logged across the season)
// A sweep = winning a match with 0 deaths. Reuses the same logic as the
// per-match `flawless` award but aggregated over the season.

function awardSweeper(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: ArchiveMintSummary,
) {
  if (hasManualPin(PIN.sweeper, seasonId, leagueId)) {
    summary.unresolved.push({ pinDefId: PIN.sweeper, reason: 'manual-pin-present', leagueId });
    return;
  }

  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  if (teams.length === 0) {
    summary.unresolved.push({ pinDefId: PIN.sweeper, reason: 'no-eligible-matches', leagueId });
    return;
  }
  const teamIds = new Set(teams.map(t => t.id));
  const rankOf = new Map(teams.map(t => [t.id, t.rank]));

  const matches = db.select({
    id: schema.matches.id,
    homeTeamId: schema.matches.homeTeamId,
    awayTeamId: schema.matches.awayTeamId,
    homeScore: schema.matches.homeScore,
    awayScore: schema.matches.awayScore,
    winnerTeamId: schema.matches.winnerTeamId,
  })
    .from(schema.matches)
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.status, 'completed'),
    ))
    .all();
  if (matches.length === 0) {
    summary.unresolved.push({ pinDefId: PIN.sweeper, reason: 'no-eligible-matches', leagueId });
    return;
  }

  const sweeperRows: SweeperMatchRow[] = [];
  for (const m of matches) {
    if (m.homeScore == null || m.awayScore == null) continue;
    // Winner via matchWinner() (winnerTeamId first, score fallback) so a
    // full-health forfeit is still a decided match instead of a no-op tie.
    const winnerId = matchWinner(m);
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
      teamRank: rankOf.get(winnerId) ?? null,
    });
  }

  const winners = pickSweeper(sweeperRows);
  for (const w of winners) {
    const uid = teamUserId(w.teamId);
    if (!uid) {
      summary.unresolved.push({ pinDefId: PIN.sweeper, reason: 'team-has-no-user', teamId: w.teamId, leagueId });
      continue;
    }
    tryInsert(
      PIN.sweeper, uid, seasonId, leagueId, awardedBy,
      { teamId: w.teamId, sweeps: w.sweeps },
      summary,
    );
  }
}
