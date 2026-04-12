/**
 * Auto-award job — hands out the seeded auto pins.
 *
 * Idempotent: every insert is `INSERT OR IGNORE` against the
 * (user_id, pin_def_id, season_id) unique index. The job is safe to run
 * multiple times; it's invoked at two natural moments:
 *
 *   * `runAutoAwards(leagueId, { trigger: 'season-end' })` — called once when
 *     a league transitions to phase=offseason. Awards the season-scoped pins:
 *     Champion, MVP, Iron Man, Sweep, Trade Machine.
 *
 *   * `runAutoAwards(leagueId, { trigger: 'match', matchId })` — called after
 *     every recorded regular-season match result. Awards the per-match pins:
 *     Kingslayer, Flawless. (Sweep / MVP / Iron Man only crystallize at end
 *     of season, so they're skipped on this trigger.)
 *
 * Pins that are *not* implemented here yet — Finalist, First Blood, Tera
 * Maestro — are listed in the seed but admins mint by hand for now. Adding
 * them later is just a function in this file plus a new branch in the
 * trigger switch.
 */
import { db, schema } from '../../db';
import { and, desc, eq, sql } from 'drizzle-orm';

type Trigger = 'season-end' | 'match';

interface RunOpts {
  trigger: Trigger;
  /** Required when trigger='match'. */
  matchId?: string;
  /** Optional admin/system actor (defaults to NULL = "auto"). */
  awardedBy?: number | null;
}

interface AwardSummary {
  trigger: Trigger;
  leagueId: string;
  seasonId: number | null;
  awarded: { pinDefId: string; userId: number; metadata?: Record<string, unknown> }[];
  skipped: number;
}

const PIN = {
  champion:     'champion',
  mvp:          'mvp',
  ironMan:      'iron-man',
  sweep:        'sweep',
  kingslayer:   'kingslayer',
  flawless:     'flawless',
  tradeMachine: 'trade-machine',
} as const;

export function runAutoAwards(leagueId: string, opts: RunOpts): AwardSummary {
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  const summary: AwardSummary = {
    trigger: opts.trigger,
    leagueId,
    seasonId: league?.seasonId ?? null,
    awarded: [],
    skipped: 0,
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
  awardChampion(leagueId, seasonId, opts.awardedBy ?? null, summary);
  awardSeasonSweep(leagueId, seasonId, opts.awardedBy ?? null, summary);
  awardMvp(leagueId, seasonId, opts.awardedBy ?? null, summary);
  awardIronMan(leagueId, seasonId, opts.awardedBy ?? null, summary);
  awardTradeMachine(leagueId, seasonId, opts.awardedBy ?? null, summary);

  return summary;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function tryInsert(
  pinDefId: string,
  userId: number,
  seasonId: number | null,
  awardedBy: number | null,
  metadata: Record<string, unknown> | null,
  summary: AwardSummary,
): boolean {
  // INSERT OR IGNORE so re-runs are no-ops.
  const stmt = sql`
    INSERT OR IGNORE INTO pins (user_id, pin_def_id, season_id, awarded_by, metadata)
    VALUES (${userId}, ${pinDefId}, ${seasonId}, ${awardedBy}, ${metadata ? JSON.stringify(metadata) : null})
  `;
  const res = db.run(stmt);
  // drizzle's run() return is typed as `void` but bun:sqlite resolves to a
  // Changes object with a `changes` count — go through `unknown` to satisfy
  // strict tsc.
  const changed = (res as unknown as { changes?: number } | undefined)?.changes ?? 0;
  if (changed > 0) {
    summary.awarded.push({ pinDefId, userId, metadata: metadata ?? undefined });
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

// ─── Champion ─────────────────────────────────────────────────────────────
// Find the completed Finals match for this league; winner gets the pin.

function awardChampion(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: AwardSummary,
) {
  const finals = db.select().from(schema.matches).where(and(
    eq(schema.matches.leagueId, leagueId),
    eq(schema.matches.phase, 'playoffs'),
    eq(schema.matches.playoffRound, 'f'),
    eq(schema.matches.status, 'completed'),
  )).get();
  if (!finals || finals.homeScore == null || finals.awayScore == null) return;
  const winnerTeamId = finals.homeScore > finals.awayScore ? finals.homeTeamId : finals.awayTeamId;
  const userId = teamUserId(winnerTeamId);
  if (!userId) return;
  tryInsert(
    PIN.champion, userId, seasonId, awardedBy,
    { teamId: winnerTeamId, matchId: finals.id, scoreLine: `${finals.homeScore}-${finals.awayScore}` },
    summary,
  );
}

// ─── Sweep (regular season undefeated) ────────────────────────────────────
// A team that finished the regular season with zero losses (no incomplete /
// disputed matches blocking us — completed only).

function awardSeasonSweep(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: AwardSummary,
) {
  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  for (const t of teams) {
    const matches = db.select().from(schema.matches).where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'regular'),
      eq(schema.matches.status, 'completed'),
      sql`(${schema.matches.homeTeamId} = ${t.id} OR ${schema.matches.awayTeamId} = ${t.id})`,
    )).all();
    if (matches.length === 0) continue;
    let undefeated = true;
    for (const m of matches) {
      if (m.homeScore == null || m.awayScore == null) { undefeated = false; break; }
      const isHome = m.homeTeamId === t.id;
      const myScore = isHome ? m.homeScore : m.awayScore;
      const oppScore = isHome ? m.awayScore : m.homeScore;
      if (myScore <= oppScore) { undefeated = false; break; }
    }
    if (!undefeated) continue;
    const uid = t.userId;
    if (!uid) continue;
    tryInsert(
      PIN.sweep, uid, seasonId, awardedBy,
      { teamId: t.id, matchesPlayed: matches.length },
      summary,
    );
  }
}

// ─── MVP (top season K/D among the league's rostered Pokemon) ────────────
// "Top season K/D" = highest sum of kills minus deaths across the team's
// match_pokemon rows, restricted to regular-season completed matches. Tie:
// every tied user gets the pin.

function awardMvp(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: AwardSummary,
) {
  // Aggregate per team in this league (regular season only).
  const rows = db.select({
    teamId: schema.matchPokemon.teamId,
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
    .groupBy(schema.matchPokemon.teamId)
    .all();
  if (rows.length === 0) return;
  const scored = rows.map(r => ({ teamId: r.teamId, diff: (r.kills ?? 0) - (r.deaths ?? 0), kills: r.kills ?? 0, deaths: r.deaths ?? 0 }));
  const top = scored.reduce((acc, r) => Math.max(acc, r.diff), Number.NEGATIVE_INFINITY);
  for (const s of scored) {
    if (s.diff !== top) continue;
    const uid = teamUserId(s.teamId);
    if (!uid) continue;
    tryInsert(
      PIN.mvp, uid, seasonId, awardedBy,
      { teamId: s.teamId, kills: s.kills, deaths: s.deaths, diff: s.diff },
      summary,
    );
  }
}

// ─── Iron Man (zero missed weeks = no forfeits charged to this team) ──────

function awardIronMan(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: AwardSummary,
) {
  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  for (const t of teams) {
    const matches = db.select().from(schema.matches).where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'regular'),
      sql`(${schema.matches.homeTeamId} = ${t.id} OR ${schema.matches.awayTeamId} = ${t.id})`,
    )).all();
    if (matches.length === 0) continue;
    // A team is "iron" if every regular-season match they were in is
    // completed AND none of the forfeits (single-side or both) name them.
    let iron = true;
    for (const m of matches) {
      if (m.status !== 'completed') { iron = false; break; }
      if (m.forfeitedBy === 'both') { iron = false; break; }
      if (m.forfeitedBy === 'home' && m.homeTeamId === t.id) { iron = false; break; }
      if (m.forfeitedBy === 'away' && m.awayTeamId === t.id) { iron = false; break; }
    }
    if (!iron) continue;
    const uid = t.userId;
    if (!uid) continue;
    tryInsert(
      PIN.ironMan, uid, seasonId, awardedBy,
      { teamId: t.id, matchesPlayed: matches.length },
      summary,
    );
  }
}

// ─── Trade Machine (5+ accepted trades in this season) ────────────────────

function awardTradeMachine(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: AwardSummary,
) {
  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  for (const t of teams) {
    const row = db.select({ count: sql<number>`COUNT(*)` })
      .from(schema.trades)
      .where(and(
        eq(schema.trades.leagueId, leagueId),
        eq(schema.trades.status, 'accepted'),
        sql`(${schema.trades.proposerId} = ${t.id} OR ${schema.trades.recipientId} = ${t.id})`,
      ))
      .get();
    const count = row?.count ?? 0;
    if (count < 5) continue;
    const uid = t.userId;
    if (!uid) continue;
    tryInsert(
      PIN.tradeMachine, uid, seasonId, awardedBy,
      { teamId: t.id, tradeCount: count },
      summary,
    );
  }
}

// ─── Kingslayer (post-match: bottom-half team beat a top-3 team) ─────────
// "Bottom-half" / "top-3" computed from the standings *as of right now* —
// snapshotted at the moment the result is recorded. We pre-compute team
// records from completed regular-season matches in this league.

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
  if (match.homeScore === match.awayScore) return; // ties skipped

  const winnerId = match.homeScore > match.awayScore ? match.homeTeamId : match.awayTeamId;
  const loserId = match.homeScore > match.awayScore ? match.awayTeamId : match.homeTeamId;

  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  if (teams.length === 0) return;

  // Build records (wins, losses, diff) at this point in the season.
  const recordByTeam = new Map<string, { wins: number; losses: number; diff: number }>();
  for (const t of teams) recordByTeam.set(t.id, { wins: 0, losses: 0, diff: 0 });

  const completed = db.select().from(schema.matches).where(and(
    eq(schema.matches.leagueId, leagueId),
    eq(schema.matches.phase, 'regular'),
    eq(schema.matches.status, 'completed'),
  )).all();

  for (const m of completed) {
    if (m.homeScore == null || m.awayScore == null) continue;
    const h = recordByTeam.get(m.homeTeamId);
    const a = recordByTeam.get(m.awayTeamId);
    if (h) {
      h.diff += m.homeScore - m.awayScore;
      if (m.homeScore > m.awayScore) h.wins++;
      else if (m.homeScore < m.awayScore) h.losses++;
    }
    if (a) {
      a.diff += m.awayScore - m.homeScore;
      if (m.awayScore > m.homeScore) a.wins++;
      else if (m.awayScore < m.homeScore) a.losses++;
    }
  }

  // Sort by wins desc, diff desc to derive standings rank (good enough for
  // a Kingslayer trigger; the full tiebreaker hierarchy lives in
  // lib/standings.ts and is not worth duplicating here).
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
  if (!winnerIsBottomHalf || !loserIsTop3) return;

  const uid = teamUserId(winnerId);
  if (!uid) return;
  tryInsert(
    PIN.kingslayer, uid, seasonId, awardedBy,
    { matchId, winnerTeamId: winnerId, loserTeamId: loserId, winnerRank, loserRank },
    summary,
  );
}

// ─── Flawless (won a match without losing a single Pokemon) ──────────────

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
  if (match.homeScore === match.awayScore) return;

  const winnerId = match.homeScore > match.awayScore ? match.homeTeamId : match.awayTeamId;

  // Sum deaths on the winning team's Pokemon for this match. 0 deaths = flawless.
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
  // If we have no per-pokemon rows for this match, we can't verify "no deaths"
  // — skip rather than false-positive.
  if (!row || (row.rowCount ?? 0) === 0) return;
  if ((row.deaths ?? 0) > 0) return;

  const uid = teamUserId(winnerId);
  if (!uid) return;
  tryInsert(
    PIN.flawless, uid, seasonId, awardedBy,
    { matchId, winnerTeamId: winnerId, scoreLine: `${match.homeScore}-${match.awayScore}` },
    summary,
  );
}

// Re-export for tests / scripts that want to silence the "unused" linter
// noise — `desc` is no longer referenced after the rewrite.
export const __internals = { desc };
