/**
 * Full season-lifecycle integration test (launch-readiness, area #2).
 *
 * Individual phase transitions, standings, the playoff bracket, finalize and
 * archive-mint already have unit / pure-function coverage (see
 * finalize-season.test.ts, playoff-advance.test.ts, standings.test.ts,
 * archive-mint.test.ts, schedule-generator.test.ts). What was NOT covered is
 * ONE league walking the ENTIRE path with real data accumulating end to end:
 *
 *   predraft → draft → (captain-lock gate) → regular
 *     → record every weekly result through the REAL recordMatchResult pipeline
 *     → playoffs (bracket gen + round-by-round auto-advance)
 *     → champion → offseason → archive (read-only)
 *
 * Unlike the season SIMULATOR (`backend/src/lib/sim/`, gated OUT of live mode),
 * this test exercises the PRODUCTION code paths that run in the live
 * deployment: the lib-layer functions the HTTP routes delegate to
 * (`generateLeagueSchedule`, `recordMatchResult` → standings/playoff-advance/
 * pin auto-award, `computeStandings`, `assignFinishPositions`) plus the
 * archive-write guards (`checkLeagueArchived`, `checkMatchArchived`,
 * `checkTeamArchived`). The phase-route + playoffs/generate-route orchestration
 * lives inline in the route closures (admin/leagues.ts, matches.ts) and is
 * mirrored here in `advancePhase()` / `generatePlayoffBracket()` with comments
 * pointing at the source so a drift is caught.
 *
 * ── Isolation ────────────────────────────────────────────────────────────────
 * Everything runs against the shared dev DB (the real `db`/`sqlite` singletons —
 * the production functions import them directly and we cannot redirect them) but
 * inside a single `BEGIN … ROLLBACK`. `tx()` (bun:sqlite `.transaction()`) nests
 * as a SAVEPOINT inside the outer BEGIN, and the final ROLLBACK discards every
 * write, so the dev DB is byte-for-byte unchanged. Same trick as
 * standings-disputed.test.ts. The league/team/season ids are uniquely prefixed
 * so even a partial run can't collide with seeded rows.
 *
 * Requires a seeded dev DB with the Pokemon reference table (for roster cost
 * snapshots). Skips cleanly if absent.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { generateLeagueSchedule } from '../src/lib/schedule-generator';
import { recordMatchResult } from '../src/lib/match-service';
import { computeStandings } from '../src/lib/standings';
import { assignFinishPositions } from '../scripts/import-xlsx';
import { runAutoAwards } from '../src/lib/pins/auto-award';
import { mintArchivePins } from '../src/lib/pins/archive-mint';
import {
  checkSeasonArchived,
  checkLeagueArchived,
  checkMatchArchived,
  checkTeamArchived,
} from '../src/lib/archive-guard';

// ─── Fixture identity (unique, collision-proof) ──────────────────────────────

const PFX = 'lifecyclespec';
const LEAGUE_ID = `${PFX}-league`;
const SEASON_NUMBER = 9911; // far outside any seeded season
const TEAM_COUNT = 6; // matches the league's playoffTeamCount → all teams seeded
const ROSTER_SIZE = 6;

function teamId(n: number): string {
  return `${LEAGUE_ID}-team${n}`;
}

/** Robustly extract the team number from a team id (the trailing integer). */
function teamNum(id: string): number {
  return parseInt(id.match(/team(\d+)$/)![1]!, 10);
}

// ─── Phase advance — mirrors POST /api/leagues/:id/phase (admin/leagues.ts:200) ─
// The production route's transition logic is inline in the closure; we mirror
// the precondition checks + side effects (schedule gen on draft→regular,
// currentWeek reset) here. Returns the same { success, code } shape the route
// returns so we can assert the guards fire.

const PHASE_RANK: Record<string, number> = {
  predraft: 0, draft: 1, regular: 2, playoffs: 3, offseason: 4,
};

function advancePhase(
  leagueId: string,
  phase: string,
  opts: { override?: boolean } = {},
): { success: boolean; code?: string; error?: string; scheduleGenerated?: boolean } {
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  if (!league) return { success: false, error: 'League not found' };
  const previousPhase = league.phase;

  // Monotonic guard (route lines ~218-233)
  const fromRank = PHASE_RANK[previousPhase] ?? -1;
  const toRank = PHASE_RANK[phase] ?? -1;
  if (toRank < fromRank && previousPhase !== phase && !opts.override) {
    return { success: false, code: 'phase_backward_requires_override' };
  }

  const draftState = db.select().from(schema.draftState)
    .where(eq(schema.draftState.leagueId, leagueId)).get();

  // draft→regular precondition (route lines ~257-263)
  if (phase === 'regular' && previousPhase === 'draft') {
    if ((!draftState || draftState.status !== 'completed') && !opts.override) {
      return { success: false, code: 'DRAFT_NOT_COMPLETE' };
    }
  }

  // playoffs precondition (route lines ~265-277)
  if (phase === 'playoffs') {
    const incomplete = db.select({ count: sql<number>`COUNT(*)` })
      .from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, leagueId),
        eq(schema.matches.phase, 'regular'),
        sql`(home_score IS NULL OR away_score IS NULL OR status = 'disputed')`,
      )).get()?.count ?? 0;
    if (incomplete > 0 && !opts.override) {
      return { success: false, code: 'REGULAR_INCOMPLETE' };
    }
  }

  let scheduleGenerated = false;
  const updates: Record<string, unknown> = { phase };
  if (phase === 'regular' && previousPhase !== 'regular') updates.currentWeek = 1;
  db.update(schema.leagues).set(updates).where(eq(schema.leagues.id, leagueId)).run();
  if (previousPhase === 'draft' && phase === 'regular') {
    scheduleGenerated = generateLeagueSchedule(leagueId).success;
  }
  // OFFSEASON-FINALIZE: mirror the production route (admin/leagues.ts) — a
  // transition INTO offseason now stamps finish positions, mints archive pins,
  // then runs the generic season-end auto-awards, in that order.
  if (phase === 'offseason' && previousPhase !== 'offseason') {
    assignFinishPositions(sqlite, [leagueId]);
    mintArchivePins(leagueId);
    runAutoAwards(leagueId, { trigger: 'season-end' });
  }
  return { success: true, scheduleGenerated };
}

// ─── Playoff bracket gen — mirrors POST /playoffs/generate (matches.ts:701) ──
// 6-team bracket: QF(3v6, 4v5) + SF(1 v TBD, 2 v TBD) + F. Seeds via the REAL
// computeStandings. This is the exact matchup table from the production route.

function generatePlayoffBracket(leagueId: string, seedCount = 6): { success: boolean } {
  const records = computeStandings(leagueId, { phase: 'regular' });
  const seeded = records.slice(0, seedCount);
  const maxWeek = db.select({ max: sql<number>`MAX(week)` })
    .from(schema.matches)
    .where(and(eq(schema.matches.leagueId, leagueId), eq(schema.matches.phase, 'regular')))
    .get()?.max || 0;

  const matchups: { round: string; homeSeed: number; awaySeed: number; week: number }[] = [
    { round: 'qf', homeSeed: 3, awaySeed: 6, week: maxWeek + 1 },
    { round: 'qf', homeSeed: 4, awaySeed: 5, week: maxWeek + 1 },
    { round: 'sf', homeSeed: 1, awaySeed: 0, week: maxWeek + 2 },
    { round: 'sf', homeSeed: 2, awaySeed: 0, week: maxWeek + 2 },
    { round: 'f', homeSeed: 0, awaySeed: 0, week: maxWeek + 3 },
  ];

  let n = 0;
  for (const m of matchups) {
    n++;
    const home = m.homeSeed > 0 ? seeded[m.homeSeed - 1]?.id : null;
    const away = m.awaySeed > 0 ? seeded[m.awaySeed - 1]?.id : null;
    db.insert(schema.matches).values({
      id: `${leagueId}-p${m.round}${n}`,
      leagueId,
      week: m.week,
      homeTeamId: home ?? null,
      awayTeamId: away ?? null,
      phase: 'playoffs',
      playoffRound: m.round,
      homeSeed: m.homeSeed || null,
      awaySeed: m.awaySeed || null,
      status: 'scheduled',
    }).run();
  }
  // Update team ranks from seeding (route lines ~787-793)
  for (let i = 0; i < records.length; i++) {
    db.update(schema.teams).set({ rank: i + 1 }).where(eq(schema.teams.id, records[i]!.id)).run();
  }
  return { success: true };
}

// ─── World builder (predraft league + drafted rosters) ───────────────────────

/** Pick `count` distinct real Pokemon names to seed rosters with. */
function pickPokemon(count: number): { name: string; tier: number }[] {
  const rows = sqlite.prepare(
    `SELECT name, tier FROM pokemon WHERE tier > 0 ORDER BY tier ASC, name ASC LIMIT ?`,
  ).all(count) as { name: string; tier: number }[];
  return rows;
}

function hasReferenceData(): boolean {
  const c = (sqlite.prepare(`SELECT COUNT(*) c FROM pokemon WHERE tier > 0`).get() as { c: number }).c;
  return c >= ROSTER_SIZE;
}

/**
 * Build a fresh league in phase=predraft with TEAM_COUNT teams. Rosters are
 * NOT drafted yet (the draft step does that). Returns nothing — ids are derived.
 */
function buildPredraftLeague(): void {
  const season = db.insert(schema.seasons).values({
    seasonNumber: SEASON_NUMBER,
    pointCap: 110,
    teraCaptainSlots: 2,
    archived: false,
  }).returning().get();

  const order: string[] = [];
  for (let i = 1; i <= TEAM_COUNT; i++) order.push(teamId(i));

  db.insert(schema.leagues).values({
    id: LEAGUE_ID,
    name: 'Lifecycle Test League',
    color: '#7c3aed',
    seasonId: season.id,
    draftOrder: JSON.stringify(order),
    draftDate: '2026-01-01T19:00:00Z',
    playoffTeamCount: 6,
    phase: 'predraft',
    currentWeek: 0,
    totalWeeks: TEAM_COUNT - 1,
    rosterSize: ROSTER_SIZE,
  }).run();

  for (let i = 1; i <= TEAM_COUNT; i++) {
    db.insert(schema.teams).values({
      id: teamId(i),
      leagueId: LEAGUE_ID,
      coachName: `Coach ${i}`,
      teamName: `Team ${i}`,
      teamAbbrev: `T${i}`,
      teamColor: '#444444',
    }).run();
  }
}

/**
 * Simulate the draft: assign each team a full roster from the real Pokemon
 * table and mark draft_state completed. Mirrors what the draft-engine does at
 * the DB level (rosters + costAtDraft snapshot) without the WS pick loop.
 */
function runDraft(): void {
  const pool = pickPokemon(TEAM_COUNT * ROSTER_SIZE);
  let p = 0;
  for (let t = 1; t <= TEAM_COUNT; t++) {
    for (let r = 0; r < ROSTER_SIZE; r++) {
      const mon = pool[p++]!;
      db.insert(schema.rosters).values({
        teamId: teamId(t),
        pokemonName: mon.name,
        tier: mon.tier,
        costAtDraft: mon.tier,
        acquiredVia: 'draft',
      }).run();
    }
  }
  db.insert(schema.draftState).values({
    leagueId: LEAGUE_ID,
    status: 'completed',
    completedAt: new Date().toISOString(),
  }).run();
}

/** Record a result for a single scheduled match via the REAL pipeline. */
function playMatch(
  matchId: string,
  homeScore: number,
  awayScore: number,
): ReturnType<typeof recordMatchResult> {
  const m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
  // Minimal valid pokemonData: distribute kills/deaths so the validator passes
  // (sum of each side's kills == that side's score, == opponent's deaths).
  const home = db.select().from(schema.rosters).where(eq(schema.rosters.teamId, m.homeTeamId)).all();
  const away = db.select().from(schema.rosters).where(eq(schema.rosters.teamId, m.awayTeamId)).all();
  const pokemonData = [
    { teamId: m.homeTeamId, pokemonName: home[0]!.pokemonName, kills: homeScore, deaths: awayScore },
    { teamId: m.awayTeamId, pokemonName: away[0]!.pokemonName, kills: awayScore, deaths: homeScore },
  ];
  return recordMatchResult(matchId, { homeScore, awayScore, pokemonData }, 'lifecycle-test');
}

// ─────────────────────────────────────────────────────────────────────────────

const referencePresent = hasReferenceData();

describe('full season lifecycle (production code paths)', () => {
  if (!referencePresent) {
    test.skip('no Pokemon reference data in dev DB — skipping lifecycle test', () => {});
    return;
  }

  beforeAll(() => {
    // PLAYOFF-TBD-FK fixed: not-yet-determined bracket slots are stored as NULL
    // (FK-safe) rather than a 'TBD' sentinel, so the bracket inserts cleanly
    // under the production FK=ON posture. We no longer disable foreign keys —
    // this test now exercises the SAME constraint environment as live.
    sqlite.exec('BEGIN');
    buildPredraftLeague();
  });

  afterAll(() => {
    // Discard EVERYTHING — the dev DB is untouched.
    sqlite.exec('ROLLBACK');
  });

  let seasonId: number;

  test('predraft → draft: phase advances, draft order intact', () => {
    seasonId = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, LEAGUE_ID)).get()!.seasonId;

    const r = advancePhase(LEAGUE_ID, 'draft');
    expect(r.success).toBe(true);
    const lg = db.select().from(schema.leagues).where(eq(schema.leagues.id, LEAGUE_ID)).get()!;
    expect(lg.phase).toBe('draft');
    expect(JSON.parse(lg.draftOrder!)).toHaveLength(TEAM_COUNT);
  });

  test('draft→regular is BLOCKED until the draft is marked complete (captain gate proxy)', () => {
    // No draft_state row yet → DRAFT_NOT_COMPLETE.
    const blocked = advancePhase(LEAGUE_ID, 'regular');
    expect(blocked.success).toBe(false);
    expect(blocked.code).toBe('DRAFT_NOT_COMPLETE');
    expect(db.select().from(schema.leagues).where(eq(schema.leagues.id, LEAGUE_ID)).get()!.phase)
      .toBe('draft'); // unchanged
  });

  test('draft completes, rosters populated with cost snapshots', () => {
    runDraft();
    const rosterRows = db.select().from(schema.rosters)
      .where(sql`team_id LIKE ${LEAGUE_ID + '%'}`).all();
    expect(rosterRows).toHaveLength(TEAM_COUNT * ROSTER_SIZE);
    // Every roster row carries a positive cost snapshot.
    expect(rosterRows.every(r => r.costAtDraft > 0)).toBe(true);
    expect(db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, LEAGUE_ID)).get()!.status)
      .toBe('completed');
  });

  test('draft → regular: schedule auto-generated (round-robin), week reset to 1', () => {
    const r = advancePhase(LEAGUE_ID, 'regular');
    expect(r.success).toBe(true);
    expect(r.scheduleGenerated).toBe(true);

    const lg = db.select().from(schema.leagues).where(eq(schema.leagues.id, LEAGUE_ID)).get()!;
    expect(lg.phase).toBe('regular');
    expect(lg.currentWeek).toBe(1);

    const reg = db.select().from(schema.matches)
      .where(and(eq(schema.matches.leagueId, LEAGUE_ID), eq(schema.matches.phase, 'regular')))
      .all();
    // 6 teams round-robin = C(6,2) = 15 matches over 5 weeks.
    expect(reg).toHaveLength(15);
    const weeks = new Set(reg.map(m => m.week));
    expect(weeks.size).toBe(TEAM_COUNT - 1);
  });

  test('playoffs BLOCKED while regular-season matches remain unscored', () => {
    const blocked = advancePhase(LEAGUE_ID, 'playoffs');
    expect(blocked.success).toBe(false);
    expect(blocked.code).toBe('REGULAR_INCOMPLETE');
  });

  test('record EVERY regular-season result via recordMatchResult — standings accumulate', () => {
    const reg = db.select().from(schema.matches)
      .where(and(eq(schema.matches.leagueId, LEAGUE_ID), eq(schema.matches.phase, 'regular')))
      .orderBy(schema.matches.week, schema.matches.id)
      .all();

    // Deterministic outcome: home wins every match by a margin keyed off the
    // home team number, so final standings have a strict ordering we can assert.
    for (const m of reg) {
      const homeNum = teamNum(m.homeTeamId);
      const homeScore = Math.min(6, 3 + (homeNum % 4)); // 3..6
      const out = playMatch(m.id, homeScore, Math.max(0, homeScore - 3)); // 0..3
      expect(out.ok).toBe(true);
      expect(out.result!.status).toBe('completed');
    }

    // No match left unscored.
    const remaining = db.select({ c: sql<number>`COUNT(*)` })
      .from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, LEAGUE_ID),
        eq(schema.matches.phase, 'regular'),
        sql`(home_score IS NULL OR away_score IS NULL OR status != 'completed')`,
      )).get()!.c;
    expect(remaining).toBe(0);

    const standings = computeStandings(LEAGUE_ID, { phase: 'regular' });
    expect(standings).toHaveLength(TEAM_COUNT);
    // Every team played 5 games; wins+losses sums to 5 each.
    for (const row of standings) {
      expect(row.wins + row.losses).toBe(TEAM_COUNT - 1);
    }
    // Total wins across the league == total matches (15).
    expect(standings.reduce((s, r) => s + r.wins, 0)).toBe(15);
  });

  // PLAYOFF-TBD-FK (FIXED): not-yet-determined bracket slots are stored as NULL
  // (a valid FK value) rather than the old 'TBD' sentinel, which violated the
  // FK onto teams.id under PRAGMA foreign_keys=ON and crashed every 4/6/8-team
  // bracket in live mode. This test proves a NULL home/away_team_id row inserts
  // cleanly under FK=ON (the production posture).
  test('PLAYOFF-TBD-FK: a bracket slot with NULL teams inserts under FK=ON', () => {
    const { Database } = require('bun:sqlite');
    const probe = new Database(':memory:');
    probe.exec('PRAGMA foreign_keys = ON');
    probe.exec('CREATE TABLE teams(id TEXT PRIMARY KEY)');
    probe.exec('CREATE TABLE matches(id TEXT PRIMARY KEY, home_team_id TEXT REFERENCES teams(id))');
    // NULL satisfies the FK; the old 'TBD' string did not.
    expect(() =>
      probe.prepare('INSERT INTO matches VALUES (?,?)').run('sf1', null),
    ).not.toThrow();
    expect(() =>
      probe.prepare('INSERT INTO matches VALUES (?,?)').run('sf2', 'TBD'),
    ).toThrow(); // the sentinel STILL violates the FK — proving why NULL is required
  });

  test('playoffs phase advance succeeds; bracket generated with seeded matchups', () => {
    const adv = advancePhase(LEAGUE_ID, 'playoffs');
    expect(adv.success).toBe(true);

    // PLAYOFF-TBD-FK fixed: the bracket's not-yet-determined SF/F slots are now
    // NULL (FK-safe) and insert cleanly under the production FK=ON posture.
    generatePlayoffBracket(LEAGUE_ID, 6);
    const po = db.select().from(schema.matches)
      .where(and(eq(schema.matches.leagueId, LEAGUE_ID), eq(schema.matches.phase, 'playoffs')))
      .all();
    expect(po).toHaveLength(5); // 2 QF + 2 SF + 1 F

    // SF/F start with NULL (not-yet-determined) slots that auto-advance fills.
    const sfTbd = po.filter(m => m.playoffRound === 'sf' && m.awayTeamId == null);
    expect(sfTbd).toHaveLength(2);
    const finalsTbd = po.find(m => m.playoffRound === 'f')!;
    expect(finalsTbd.homeTeamId).toBeNull();
    expect(finalsTbd.awayTeamId).toBeNull();

    // Top-2 seeds occupy the SF home slots (byes).
    const seeded = computeStandings(LEAGUE_ID, { phase: 'regular' });
    const sfHomes = po.filter(m => m.playoffRound === 'sf').map(m => m.homeTeamId).sort();
    expect(sfHomes).toEqual([seeded[0]!.id, seeded[1]!.id].sort());
  });

  test('playoffs play out round-by-round — recordMatchResult auto-advances the bracket', () => {
    // QF first: winners must propagate into the SF away (TBD) slots.
    for (const round of ['qf', 'sf', 'f'] as const) {
      const matches = db.select().from(schema.matches)
        .where(and(
          eq(schema.matches.leagueId, LEAGUE_ID),
          eq(schema.matches.phase, 'playoffs'),
          eq(schema.matches.playoffRound, round),
        ))
        .orderBy(schema.matches.id)
        .all();

      for (const m of matches) {
        const fresh = db.select().from(schema.matches).where(eq(schema.matches.id, m.id)).get()!;
        expect(fresh.homeTeamId).not.toBeNull();
        expect(fresh.awayTeamId).not.toBeNull();
        const out = playMatch(fresh.id, 4, 2); // home wins
        expect(out.ok).toBe(true);
      }
    }

    const finals = db.select().from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, LEAGUE_ID),
        eq(schema.matches.phase, 'playoffs'),
        eq(schema.matches.playoffRound, 'f'),
      )).get()!;
    expect(finals.status).toBe('completed');
    expect(finals.homeScore).toBe(4);
    expect(finals.awayScore).toBe(2);
  });

  test('offseason finalize: UI transition stamps champion / runner-up / SF / QF + archive pins', () => {
    // OFFSEASON-FINALIZE: the production /phase route now stamps finish
    // positions AND mints archive pins on the transition into offseason (it
    // previously only ran the generic auto-awards, leaving NULL finish
    // positions when an admin advanced via the UI instead of the CLI). Our
    // advancePhase() mirror does the same; we assert the positions are stamped
    // BY the transition — no separate finalize call.
    const adv = advancePhase(LEAGUE_ID, 'offseason');
    expect(adv.success).toBe(true);
    expect(db.select().from(schema.leagues).where(eq(schema.leagues.id, LEAGUE_ID)).get()!.phase)
      .toBe('offseason');

    // Finish positions stamped purely by the offseason transition.
    const stamped = db.select().from(schema.teams)
      .where(and(eq(schema.teams.leagueId, LEAGUE_ID), sql`finish_position IS NOT NULL`)).all();
    expect(stamped).toHaveLength(TEAM_COUNT);

    const teams = db.select().from(schema.teams)
      .where(eq(schema.teams.leagueId, LEAGUE_ID)).all();
    const labels = teams.map(t => t.finishLabel);
    expect(labels.filter(l => l === 'Champion')).toHaveLength(1);
    expect(labels.filter(l => l === 'Runner-up')).toHaveLength(1);
    expect(labels.filter(l => l === 'Semifinalist')).toHaveLength(2);
    expect(labels.filter(l => l === 'Quarterfinalist')).toHaveLength(2);

    const champ = teams.find(t => t.finishLabel === 'Champion')!;
    const finals = db.select().from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, LEAGUE_ID),
        eq(schema.matches.phase, 'playoffs'),
        eq(schema.matches.playoffRound, 'f'),
      )).get()!;
    // Finals home won 4-2 → champion is the finals home team.
    expect(champ.id).toBe(finals.homeTeamId);
    expect(champ.finishPosition).toBe(1);
  });

  test('archive: marking the season archived flips the read-only flag', () => {
    db.update(schema.seasons).set({ archived: true }).where(eq(schema.seasons.id, seasonId)).run();
    expect(db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).get()!.archived)
      .toBe(true);
  });

  test('archive read-only: write guards reject mutations once archived', () => {
    // Season / league / team / match guards all resolve to this season and block.
    expect(checkSeasonArchived(seasonId)).not.toBeNull();
    expect(checkSeasonArchived(seasonId)!.code).toBe('season_archived');
    expect(checkLeagueArchived(LEAGUE_ID)).not.toBeNull();
    expect(checkTeamArchived(teamId(1))).not.toBeNull();

    const aMatch = db.select().from(schema.matches)
      .where(eq(schema.matches.leagueId, LEAGUE_ID)).limit(1).all()[0]!;
    expect(checkMatchArchived(aMatch.id)).not.toBeNull();
  });

  test('archive read-only: ?force=1 bypasses the guard (admin amend escape hatch)', () => {
    expect(checkSeasonArchived(seasonId, '1')).toBeNull();
    expect(checkLeagueArchived(LEAGUE_ID, true)).toBeNull();
    expect(checkTeamArchived(teamId(1), 'true')).toBeNull();
  });

  test('archive isolation: archiving this season did not touch any other season', () => {
    const others = db.select().from(schema.seasons)
      .where(sql`season_number != ${SEASON_NUMBER}`).all();
    // Whatever the seeded archived-state of other seasons was, our archive write
    // was scoped by id — re-read confirms our season is the only one we touched.
    // (We can't assert seeded values, but we CAN assert our write was id-scoped:
    // exactly one season has our season_number and it is archived.)
    const ours = db.select().from(schema.seasons)
      .where(eq(schema.seasons.seasonNumber, SEASON_NUMBER)).all();
    expect(ours).toHaveLength(1);
    expect(ours[0]!.archived).toBe(true);
    // Sanity: the guard does not block a NON-archived foreign season id.
    const nonArchived = others.find(s => !s.archived);
    if (nonArchived) {
      expect(checkSeasonArchived(nonArchived.id)).toBeNull();
    }
  });
});
