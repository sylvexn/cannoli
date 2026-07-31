/**
 * Auto-award job — hands out the season's stat-derived pins.
 *
 * Idempotent: every insert is `INSERT OR IGNORE` against the
 * `pins_identity_idx` unique index on (user_id, pin_def_id, season_id,
 * league_id). Safe to re-run.
 *
 *   * `runAutoAwards(leagueId, { trigger: 'season-end' })` — called once when
 *     a league transitions to phase=offseason. Awards the season-scoped
 *     stats pins: Garchomp (most KOs), Cannoli (best regular-season record),
 *     Cynthia (longest win streak).
 *
 *   * `runAutoAwards(leagueId, { trigger: 'match', matchId })` — called after
 *     every recorded regular-season match result. Awards the per-match
 *     bonus pins: Kingslayer, Flawless.
 *
 * Every insert here is `source: 'auto'` and carries the league_id it was
 * computed for. A `source: 'manual'` pin for the same (pinDefId, seasonId,
 * leagueId) is human-authoritative — this job never deletes one and never
 * mints a competing row over one; see `hasManualPin` below.
 *
 * Winners are read off `matches.winnerTeamId` (via the shared `matchWinner()`
 * helper) rather than re-deriving from score comparison, so a forfeit at full
 * health (equal KO score, e.g. 2-2, but a real winner) is credited correctly.
 *
 * Every stat pin awards exactly ONE winner per league — never a split. Each
 * `pickXxx` narrows ties with its own criterion, then falls through to the
 * shared `breakTieByRank` (lib/pins/tiebreak.ts) so the result is always
 * deterministic and stable across re-runs.
 *
 * The subjective Elite-4 / Mix / Player awards (Baxcalibur, Kingambit, Ash,
 * Best Draft, Dragapult, Charizard, Florges, Rotom, Pikachu, Red) are
 * minted by hand from the admin UI.
 */
import { db, schema } from '../../db';
import { and, eq, lte, sql } from 'drizzle-orm';
import { tx } from '../tx';
import { matchWinner, computeStandings } from '../standings';
import {
  pickGarchompWinners, pickCannoliWinners, pickCynthiaWinners, computeStreak,
  type GarchompRow, type GarchompWinner,
  type CannoliRecord, type CynthiaStreak, type StreakMatch,
} from './auto-award-pickers';

export {
  pickGarchompWinners, pickCannoliWinners, pickCynthiaWinners, computeStreak,
  type GarchompRow, type GarchompWinner,
  type CannoliRecord, type CynthiaStreak, type StreakMatch,
};

type Trigger = 'season-end' | 'match';

interface RunOpts {
  trigger: Trigger;
  /** Required when trigger='match'. */
  matchId?: string;
  /** Optional admin/system actor (defaults to NULL = "auto"). */
  awardedBy?: number | null;
}

export interface UnresolvedEntry {
  pinDefId: string;
  reason: 'team-has-no-user' | 'no-eligible-matches' | 'manual-pin-present' | 'tie-unresolved';
  teamId?: string;
  leagueId?: string;
}

interface AwardSummary {
  trigger: Trigger;
  leagueId: string;
  seasonId: number | null;
  awarded: { pinDefId: string; userId: number; metadata?: Record<string, unknown> }[];
  skipped: number;
  unresolved: UnresolvedEntry[];
}

const PIN = {
  garchomp:   'garchomp',
  cannoli:    'cannoli',
  cynthia:    'cynthia',
  kingslayer: 'kingslayer',
  flawless:   'flawless',
} as const;

export function runAutoAwards(leagueId: string, opts: RunOpts): AwardSummary {
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  const summary: AwardSummary = {
    trigger: opts.trigger,
    leagueId,
    seasonId: league?.seasonId ?? null,
    awarded: [],
    skipped: 0,
    unresolved: [],
  };
  if (!league) return summary;

  const seasonId = league.seasonId;

  if (opts.trigger === 'match') {
    if (!opts.matchId) return summary;
    awardKingslayer(leagueId, seasonId, opts.matchId, opts.awardedBy ?? null, summary);
    awardFlawless(leagueId, seasonId, opts.matchId, opts.awardedBy ?? null, summary);
    return summary;
  }

  // trigger === 'season-end'
  // Clear prior auto-awarded season-end pins for THIS league/season so a
  // re-run after a data correction picks the new winners cleanly. Keyed on
  // `source = 'auto'` (never `awarded_by`, which is provenance only — see
  // migration 0069) and the real `league_id` column, so a coach who plays in
  // multiple leagues never has a sibling league's pin touched, and a
  // human-authoritative (`source = 'manual'`) pin is never deleted.
  //
  // Wrapped in tx() so the clear and the re-inserts are atomic — a crash
  // between them can no longer leave this league's season pins in a deleted
  // but not yet re-awarded state.
  tx(() => {
    db.run(sql`
      DELETE FROM pins
      WHERE pin_def_id IN (${PIN.garchomp}, ${PIN.cannoli}, ${PIN.cynthia})
        AND season_id = ${seasonId}
        AND source = 'auto'
        AND league_id = ${leagueId}
    `);

    awardGarchomp(leagueId, seasonId, opts.awardedBy ?? null, summary);
    awardCannoli(leagueId, seasonId, opts.awardedBy ?? null, summary);
    awardCynthia(leagueId, seasonId, opts.awardedBy ?? null, summary);
  });

  return summary;
}

// Helpers

/**
 * True when a `source = 'manual'` pin already exists for this exact
 * (pinDefId, seasonId, leagueId) slot. Manual pins are human-authoritative —
 * the auto job must not mint a competing row for the slot even for a
 * DIFFERENT winner/user, so callers check this once per award, before doing
 * any per-winner work, and skip the whole slot when true.
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

function tryInsert(
  pinDefId: string,
  userId: number,
  seasonId: number | null,
  leagueId: string,
  awardedBy: number | null,
  metadata: Record<string, unknown> | null,
  summary: AwardSummary,
): boolean {
  const stmt = sql`
    INSERT OR IGNORE INTO pins (user_id, pin_def_id, season_id, league_id, awarded_by, source, metadata)
    VALUES (${userId}, ${pinDefId}, ${seasonId}, ${leagueId}, ${awardedBy}, 'auto', ${metadata ? JSON.stringify(metadata) : null})
  `;
  const res = db.run(stmt);
  const changed = (res as unknown as { changes?: number } | undefined)?.changes ?? 0;
  if (changed > 0) {
    summary.awarded.push({ pinDefId, userId, metadata: metadata ?? undefined });

    // Mirror the admin-mint path: emit a `pin_awarded` activity-log event so
    // auto-awarded pins show up in the admin Activity Log alongside hand-mints.
    // Best-effort — don't fail the award if logging trips for any reason.
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
          ...(metadata ?? {}),
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

// Garchomp (most KOs across the regular season)
// Sums match_pokemon.kills per team across regular-season completed matches;
// the team owning the Pokemon (well, the team) with the highest single-Mon
// kill count gets it. We track per-Pokemon to surface the actual headline
// ("DRAGAPULT with 16 kills"), not per-team.

function awardGarchomp(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: AwardSummary,
) {
  if (hasManualPin(PIN.garchomp, seasonId, leagueId)) {
    summary.unresolved.push({ pinDefId: PIN.garchomp, reason: 'manual-pin-present', leagueId });
    return;
  }

  // NOTE: groups by LOWER(pokemonName) to coalesce casing variants. Does NOT
  // canonicalize form variants (e.g. "Urshifu" vs "Urshifu-Rapid-Strike") —
  // those still split. Admin UI re-canonicalizes display casing against roster.
  const rows = db.select({
    teamId: schema.matchPokemon.teamId,
    pokemon: sql<string>`LOWER(${schema.matchPokemon.pokemonName})`,
    kills: sql<number>`COALESCE(SUM(${schema.matchPokemon.kills}), 0)`,
    deaths: sql<number>`COALESCE(SUM(${schema.matchPokemon.deaths}), 0)`,
  })
    .from(schema.matchPokemon)
    .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPokemon.matchId))
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'regular'),
      eq(schema.matches.status, 'completed'),
    ))
    .groupBy(schema.matchPokemon.teamId, sql`LOWER(${schema.matchPokemon.pokemonName})`)
    .all();
  if (rows.length === 0) {
    summary.unresolved.push({ pinDefId: PIN.garchomp, reason: 'no-eligible-matches', leagueId });
    return;
  }

  const rankOf = teamRankMap(leagueId);
  const winners = pickGarchompWinners(rows.map(r => ({
    teamId: r.teamId, pokemon: r.pokemon, kills: r.kills ?? 0, deaths: r.deaths ?? 0,
    teamRank: rankOf.get(r.teamId) ?? null,
  })));
  for (const r of winners) {
    const uid = teamUserId(r.teamId);
    if (!uid) {
      summary.unresolved.push({ pinDefId: PIN.garchomp, reason: 'team-has-no-user', teamId: r.teamId, leagueId });
      continue;
    }
    tryInsert(
      PIN.garchomp, uid, seasonId, leagueId, awardedBy,
      { teamId: r.teamId, pokemon: r.pokemon, kills: r.kills },
      summary,
    );
  }
}

// Cannoli (best regular-season record)
// Most wins; tiebreak on point differential. Ties on both columns split the
// pin (each tied user gets a copy).

function awardCannoli(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: AwardSummary,
) {
  if (hasManualPin(PIN.cannoli, seasonId, leagueId)) {
    summary.unresolved.push({ pinDefId: PIN.cannoli, reason: 'manual-pin-present', leagueId });
    return;
  }

  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  if (teams.length === 0) {
    summary.unresolved.push({ pinDefId: PIN.cannoli, reason: 'no-eligible-matches', leagueId });
    return;
  }

  // Canonical standings order (wins/diff/h2h/kills/id) — reused as-is for
  // the final Cannoli tiebreak rather than reimplementing that chain here.
  const standingsRankOf = new Map(computeStandings(leagueId).map((s, i) => [s.id, i + 1]));

  const records = teams.map(t => {
    const matches = db.select().from(schema.matches).where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'regular'),
      eq(schema.matches.status, 'completed'),
      sql`(${schema.matches.homeTeamId} = ${t.id} OR ${schema.matches.awayTeamId} = ${t.id})`,
    )).all();
    let wins = 0, losses = 0, diff = 0;
    for (const m of matches) {
      if (m.homeScore == null || m.awayScore == null) continue;
      const isHome = m.homeTeamId === t.id;
      const my = isHome ? m.homeScore : m.awayScore;
      const opp = isHome ? m.awayScore : m.homeScore;
      diff += my - opp;
      // Winner via matchWinner() (winnerTeamId first, score fallback) so a
      // full-health forfeit (equal score, real winner) counts as a W/L
      // instead of neither.
      const winner = matchWinner(m);
      if (winner === t.id) wins++;
      else if (winner != null) losses++;
    }
    return {
      teamId: t.id, userId: t.userId, wins, losses, diff, played: matches.length,
      standingsRank: standingsRankOf.get(t.id) ?? Number.MAX_SAFE_INTEGER,
    };
  }).filter(r => r.played > 0);

  if (records.length === 0) {
    summary.unresolved.push({ pinDefId: PIN.cannoli, reason: 'no-eligible-matches', leagueId });
    return;
  }

  const finalists = pickCannoliWinners(records);
  for (const w of finalists) {
    if (!w.userId) {
      summary.unresolved.push({ pinDefId: PIN.cannoli, reason: 'team-has-no-user', teamId: w.teamId, leagueId });
      continue;
    }
    tryInsert(
      PIN.cannoli, w.userId, seasonId, leagueId, awardedBy,
      { teamId: w.teamId, wins: w.wins, losses: w.losses, diff: w.diff },
      summary,
    );
  }
}

// Cynthia (longest consecutive-win streak in the regular season)
// Streak is broken by losses *and* ties; we order matches by week then a
// stable id fallback.

function awardCynthia(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: AwardSummary,
) {
  if (hasManualPin(PIN.cynthia, seasonId, leagueId)) {
    summary.unresolved.push({ pinDefId: PIN.cynthia, reason: 'manual-pin-present', leagueId });
    return;
  }

  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  if (teams.length === 0) {
    summary.unresolved.push({ pinDefId: PIN.cynthia, reason: 'no-eligible-matches', leagueId });
    return;
  }

  const rankOf = teamRankMap(leagueId);
  const streaks = teams.map(t => {
    const matches = db.select().from(schema.matches).where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'regular'),
      eq(schema.matches.status, 'completed'),
      sql`(${schema.matches.homeTeamId} = ${t.id} OR ${schema.matches.awayTeamId} = ${t.id})`,
    )).orderBy(schema.matches.week, schema.matches.id).all();

    const best = computeStreak(matches, t.id);
    return { teamId: t.id, userId: t.userId, best, teamRank: rankOf.get(t.id) ?? null };
  });

  const winners = pickCynthiaWinners(streaks, 2);
  for (const s of winners) {
    if (!s.userId) {
      summary.unresolved.push({ pinDefId: PIN.cynthia, reason: 'team-has-no-user', teamId: s.teamId, leagueId });
      continue;
    }
    tryInsert(
      PIN.cynthia, s.userId, seasonId, leagueId, awardedBy,
      { teamId: s.teamId, streak: s.best },
      summary,
    );
  }
}

// Kingslayer (post-match: bottom-half team beat a top-3 team)
// Snapshot the standings as of the match being recorded — only regular-season
// matches through (and including) this match's week count toward rank.

function awardKingslayer(
  leagueId: string,
  seasonId: number,
  matchId: string,
  awardedBy: number | null,
  summary: AwardSummary,
) {
  const match = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get();
  if (!match) return;
  if (match.phase !== 'regular' || match.status !== 'completed') return;
  if (match.homeScore == null || match.awayScore == null) return;

  const winnerId = matchWinner(match);
  if (winnerId == null) return; // genuine tie / no-contest — no winner to credit
  const loserId = winnerId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;
  if (loserId == null) return; // undetermined bracket slot (shouldn't happen in regular phase)

  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  if (teams.length === 0) return;

  const recordByTeam = new Map<string, { wins: number; losses: number; diff: number }>();
  for (const t of teams) recordByTeam.set(t.id, { wins: 0, losses: 0, diff: 0 });

  // Point-in-time: only matches through this match's own week count toward
  // the standings snapshot, matching the "as of the match" contract.
  const completed = db.select().from(schema.matches).where(and(
    eq(schema.matches.leagueId, leagueId),
    eq(schema.matches.phase, 'regular'),
    eq(schema.matches.status, 'completed'),
    lte(schema.matches.week, match.week),
  )).all();

  for (const m of completed) {
    if (m.homeScore == null || m.awayScore == null) continue;
    if (m.homeTeamId == null || m.awayTeamId == null) continue;
    const h = recordByTeam.get(m.homeTeamId);
    const a = recordByTeam.get(m.awayTeamId);
    const w = matchWinner(m);
    if (h) {
      h.diff += m.homeScore - m.awayScore;
      if (w === m.homeTeamId) h.wins++;
      else if (w === m.awayTeamId) h.losses++;
    }
    if (a) {
      a.diff += m.awayScore - m.homeScore;
      if (w === m.awayTeamId) a.wins++;
      else if (w === m.homeTeamId) a.losses++;
    }
  }

  const ranked = [...teams].map(t => ({ id: t.id, ...recordByTeam.get(t.id)! }))
    .sort((a, b) => (b.wins - a.wins) || (b.diff - a.diff) || a.id.localeCompare(b.id));

  const rankOf = new Map<string, number>();
  ranked.forEach((r, i) => rankOf.set(r.id, i + 1));

  const winnerRank = rankOf.get(winnerId);
  const loserRank = rankOf.get(loserId);
  if (!winnerRank || !loserRank) return;

  const half = Math.ceil(ranked.length / 2);
  const winnerIsBottomHalf = winnerRank > half;
  const loserIsTop3 = loserRank <= 3;
  if (!winnerIsBottomHalf || !loserIsTop3) return; // doesn't qualify — not an error, most matches don't

  if (hasManualPin(PIN.kingslayer, seasonId, leagueId)) {
    summary.unresolved.push({ pinDefId: PIN.kingslayer, reason: 'manual-pin-present', leagueId });
    return;
  }

  const uid = teamUserId(winnerId);
  if (!uid) {
    summary.unresolved.push({ pinDefId: PIN.kingslayer, reason: 'team-has-no-user', teamId: winnerId, leagueId });
    return;
  }
  tryInsert(
    PIN.kingslayer, uid, seasonId, leagueId, awardedBy,
    { matchId, winnerTeamId: winnerId, loserTeamId: loserId, winnerRank, loserRank },
    summary,
  );
}

// Flawless (won a match without losing a single Pokemon)

function awardFlawless(
  leagueId: string,
  seasonId: number,
  matchId: string,
  awardedBy: number | null,
  summary: AwardSummary,
) {
  const match = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get();
  if (!match) return;
  if (match.status !== 'completed') return;
  if (match.homeScore == null || match.awayScore == null) return;

  const winnerId = matchWinner(match);
  if (winnerId == null) return; // genuine tie / no-contest — no winner to credit

  const row = db.select({
    deaths: sql<number>`COALESCE(SUM(${schema.matchPokemon.deaths}), 0)`,
    rowCount: sql<number>`COUNT(*)`,
  })
    .from(schema.matchPokemon)
    .where(and(
      eq(schema.matchPokemon.matchId, matchId),
      eq(schema.matchPokemon.teamId, winnerId),
    ))
    .get();
  if (!row || (row.rowCount ?? 0) === 0) return; // nothing recorded — not a sweep
  if ((row.deaths ?? 0) > 0) return; // not a sweep — not an error, most wins aren't

  if (hasManualPin(PIN.flawless, seasonId, leagueId)) {
    summary.unresolved.push({ pinDefId: PIN.flawless, reason: 'manual-pin-present', leagueId });
    return;
  }

  const uid = teamUserId(winnerId);
  if (!uid) {
    summary.unresolved.push({ pinDefId: PIN.flawless, reason: 'team-has-no-user', teamId: winnerId, leagueId });
    return;
  }
  tryInsert(
    PIN.flawless, uid, seasonId, leagueId, awardedBy,
    { matchId, winnerTeamId: winnerId, scoreLine: `${match.homeScore}-${match.awayScore}` },
    summary,
  );
}
