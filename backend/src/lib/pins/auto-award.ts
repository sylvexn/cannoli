/**
 * Auto-award job — hands out the season's stat-derived pins.
 *
 * Idempotent: every insert is `INSERT OR IGNORE` against the
 * (user_id, pin_def_id, season_id) unique index. Safe to re-run.
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
 * The subjective Elite-4 / Mix / Player awards (Baxcalibur, Kingambit, Ash,
 * Best Draft, Dragapult, Charizard, Florges, Rotom, Pikachu, Red) are
 * minted by hand from the admin UI.
 */
import { db, schema } from '../../db';
import { and, eq, sql } from 'drizzle-orm';

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
  // re-run after a data correction picks the new winners cleanly. Scope
  // by metadata.teamId (set by all three awarders) rather than user_id —
  // a season runs 3 concurrent leagues, and a coach who plays in multiple
  // leagues would otherwise have their sibling-league pins clobbered when
  // any one league finalizes. Only touches awarded_by IS NULL rows (auto
  // pins) — admin-minted pins are preserved.
  db.run(sql`
    DELETE FROM pins
    WHERE pin_def_id IN (${PIN.garchomp}, ${PIN.cannoli}, ${PIN.cynthia})
      AND season_id = ${seasonId}
      AND awarded_by IS NULL
      AND json_extract(metadata, '$.teamId') IN (
        SELECT id FROM teams WHERE league_id = ${leagueId}
      )
  `);

  awardGarchomp(leagueId, seasonId, opts.awardedBy ?? null, summary);
  awardCannoli(leagueId, seasonId, opts.awardedBy ?? null, summary);
  awardCynthia(leagueId, seasonId, opts.awardedBy ?? null, summary);

  return summary;
}

// ─── Pure helpers (testable without DB) ───────────────────────────────────

export interface GarchompRow { teamId: string; pokemon: string; kills: number }
export interface GarchompWinner { teamId: string; pokemon: string; kills: number }

/**
 * Pick Garchomp winners from pre-aggregated rows. Rows are expected to be
 * grouped by (teamId, LOWER(pokemonName)) — the SQL caller already does this,
 * but the pure helper additionally re-coalesces casing variants defensively
 * so unit tests can pass raw mixed-case inputs.
 */
export function pickGarchompWinners(rows: GarchompRow[]): GarchompWinner[] {
  if (rows.length === 0) return [];
  const merged = new Map<string, GarchompWinner>();
  for (const r of rows) {
    const key = `${r.teamId}|${(r.pokemon ?? '').toLowerCase()}`;
    const prev = merged.get(key);
    if (prev) prev.kills += (r.kills ?? 0);
    else merged.set(key, { teamId: r.teamId, pokemon: (r.pokemon ?? '').toLowerCase(), kills: r.kills ?? 0 });
  }
  const all = [...merged.values()];
  const top = all.reduce((acc, r) => Math.max(acc, r.kills), 0);
  if (top === 0) return [];
  return all.filter(r => r.kills === top);
}

export interface CannoliRecord {
  teamId: string;
  userId: number | null;
  wins: number;
  losses: number;
  diff: number;
  played: number;
}

/**
 * Pick Cannoli winners (best regular-season record) from pre-computed records.
 * Most wins, tiebreak by diff. Excludes teams with no userId (orphans) from
 * the winner set but they still participate in the wins/diff comparison.
 */
export function pickCannoliWinners(records: CannoliRecord[]): CannoliRecord[] {
  const playing = records.filter(r => r.played > 0);
  if (playing.length === 0) return [];
  const topWins = playing.reduce((a, r) => Math.max(a, r.wins), 0);
  const winners = playing.filter(r => r.wins === topWins);
  const topDiff = winners.reduce((a, r) => Math.max(a, r.diff), Number.NEGATIVE_INFINITY);
  return winners.filter(r => r.diff === topDiff);
}

export interface CynthiaStreak { teamId: string; userId: number | null; best: number }

/**
 * Pick Cynthia winners from pre-computed streaks. Returns all teams tied at
 * the top, provided the top streak >= `min` (default 2).
 */
export function pickCynthiaWinners(streaks: CynthiaStreak[], min = 2): CynthiaStreak[] {
  if (streaks.length === 0) return [];
  const top = streaks.reduce((a, s) => Math.max(a, s.best), 0);
  if (top < min) return [];
  return streaks.filter(s => s.best === top);
}

export interface StreakMatch {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  forfeitedBy?: 'home' | 'away' | 'both' | null;
}

/**
 * Compute the longest consecutive-win streak for `teamId` over `matches`.
 * Matches are consumed in the order given (caller orders by week, id).
 * Rules:
 *   - `forfeitedBy === 'both'` matches are SKIPPED (neither extend nor break).
 *   - NULL scores reset the streak (treated as a non-win).
 *   - Ties (homeScore === awayScore) reset the streak.
 *   - Wins increment current streak; current is reset on any loss/tie/null.
 */
export function computeStreak(matches: StreakMatch[], teamId: string): number {
  let best = 0, current = 0;
  for (const m of matches) {
    if (m.forfeitedBy === 'both') continue;
    if (m.homeScore == null || m.awayScore == null) { current = 0; continue; }
    const isHome = m.homeTeamId === teamId;
    const my = isHome ? m.homeScore : m.awayScore;
    const opp = isHome ? m.awayScore : m.homeScore;
    if (my > opp) { current++; if (current > best) best = current; }
    else { current = 0; }
  }
  return best;
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
  const stmt = sql`
    INSERT OR IGNORE INTO pins (user_id, pin_def_id, season_id, awarded_by, metadata)
    VALUES (${userId}, ${pinDefId}, ${seasonId}, ${awardedBy}, ${metadata ? JSON.stringify(metadata) : null})
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

// ─── Garchomp (most KOs across the regular season) ────────────────────────
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
  // NOTE: groups by LOWER(pokemonName) to coalesce casing variants. Does NOT
  // canonicalize form variants (e.g. "Urshifu" vs "Urshifu-Rapid-Strike") —
  // those still split. Admin UI re-canonicalizes display casing against roster.
  const rows = db.select({
    teamId: schema.matchPokemon.teamId,
    pokemon: sql<string>`LOWER(${schema.matchPokemon.pokemonName})`,
    kills: sql<number>`COALESCE(SUM(${schema.matchPokemon.kills}), 0)`,
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
  const winners = pickGarchompWinners(rows.map(r => ({
    teamId: r.teamId, pokemon: r.pokemon, kills: r.kills ?? 0,
  })));
  for (const r of winners) {
    const uid = teamUserId(r.teamId);
    if (!uid) continue;
    tryInsert(
      PIN.garchomp, uid, seasonId, awardedBy,
      { teamId: r.teamId, pokemon: r.pokemon, kills: r.kills },
      summary,
    );
  }
}

// ─── Cannoli (best regular-season record) ─────────────────────────────────
// Most wins; tiebreak on point differential. Ties on both columns split the
// pin (each tied user gets a copy).

function awardCannoli(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: AwardSummary,
) {
  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  if (teams.length === 0) return;

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
      if (my > opp) wins++; else if (opp > my) losses++;
    }
    return { teamId: t.id, userId: t.userId, wins, losses, diff, played: matches.length };
  }).filter(r => r.played > 0);

  const finalists = pickCannoliWinners(records);
  for (const w of finalists) {
    if (!w.userId) continue;
    tryInsert(
      PIN.cannoli, w.userId, seasonId, awardedBy,
      { teamId: w.teamId, wins: w.wins, losses: w.losses, diff: w.diff },
      summary,
    );
  }
}

// ─── Cynthia (longest consecutive-win streak in the regular season) ──────
// Streak is broken by losses *and* ties; we order matches by week then a
// stable id fallback.

function awardCynthia(
  leagueId: string,
  seasonId: number,
  awardedBy: number | null,
  summary: AwardSummary,
) {
  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  if (teams.length === 0) return;

  const streaks = teams.map(t => {
    const matches = db.select().from(schema.matches).where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'regular'),
      eq(schema.matches.status, 'completed'),
      sql`(${schema.matches.homeTeamId} = ${t.id} OR ${schema.matches.awayTeamId} = ${t.id})`,
    )).orderBy(schema.matches.week, schema.matches.id).all();

    const best = computeStreak(matches, t.id);
    return { teamId: t.id, userId: t.userId, best };
  });

  const winners = pickCynthiaWinners(streaks, 2);
  for (const s of winners) {
    if (!s.userId) continue;
    tryInsert(
      PIN.cynthia, s.userId, seasonId, awardedBy,
      { teamId: s.teamId, streak: s.best },
      summary,
    );
  }
}

// ─── Kingslayer (post-match: bottom-half team beat a top-3 team) ─────────
// Snapshot the standings as of the match being recorded.

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
  if (match.homeScore === match.awayScore) return;

  const winnerId = match.homeScore > match.awayScore ? match.homeTeamId : match.awayTeamId;
  const loserId = match.homeScore > match.awayScore ? match.awayTeamId : match.homeTeamId;
  if (winnerId == null || loserId == null) return; // undetermined bracket slot

  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  if (teams.length === 0) return;

  const recordByTeam = new Map<string, { wins: number; losses: number; diff: number }>();
  for (const t of teams) recordByTeam.set(t.id, { wins: 0, losses: 0, diff: 0 });

  const completed = db.select().from(schema.matches).where(and(
    eq(schema.matches.leagueId, leagueId),
    eq(schema.matches.phase, 'regular'),
    eq(schema.matches.status, 'completed'),
  )).all();

  for (const m of completed) {
    if (m.homeScore == null || m.awayScore == null) continue;
    if (m.homeTeamId == null || m.awayTeamId == null) continue;
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
  if (winnerId == null) return; // undetermined bracket slot

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
