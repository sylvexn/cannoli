/**
 * Coverage for the pins/badges award engine fixes (migration 0069 —
 * `pins.source` / `pins.league_id`):
 *
 *   1. A forfeit at full health (equal KO score, real `winner_team_id`)
 *      resolves a winner instead of reading as a tie — both at the pure
 *      helper level (computeStreak, pickChampion) and through the DB-backed
 *      auto-award engine (a 2-2 forfeit deciding the Cannoli record pin).
 *   2. A `source = 'manual'` pin blocks the auto minter from awarding a
 *      competing row for the same (pinDefId, seasonId, leagueId) slot.
 *   3. An admin override (auto pin deleted, replaced by a manual one) is
 *      NOT reverted by a later re-run of the auto job.
 *   4. A team with no linked user produces a structured `unresolved` entry
 *      instead of a silent, traceless drop (the S9 Ruby championship bug).
 *   5. Two leagues in the same season both mint a season pin for the same
 *      user (the league_id column making the identity index league-aware).
 *
 * Writes a small fixture tree to the shared dev DB under tagged ids; cleans
 * up after.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { runAutoAwards } from '../src/lib/pins/auto-award';
import { mintArchivePins } from '../src/lib/pins/archive-mint';
import { computeStreak, type StreakMatch } from '../src/lib/pins/auto-award';
import { pickChampion, type ChampionFinalsRow } from '../src/lib/pins/archive-mint';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

const tag = `pinseng-${Date.now()}`;

// ---- pure-helper regression tests (no DB) ----------------------------

describe('computeStreak — winner flag over score comparison', () => {
  test('a 2-2 forfeit with a winner flag extends the streak, not resets it', () => {
    const matches: StreakMatch[] = [
      { homeTeamId: 'A', awayTeamId: 'B', homeScore: 2, awayScore: 2, winnerTeamId: 'A' },
    ];
    expect(computeStreak(matches, 'A')).toBe(1);
    expect(computeStreak(matches, 'B')).toBe(0);
  });

  test('a genuine tie (no winner flag, equal score) still resets the streak', () => {
    const matches: StreakMatch[] = [
      { homeTeamId: 'A', awayTeamId: 'B', homeScore: 2, awayScore: 2, winnerTeamId: null },
    ];
    expect(computeStreak(matches, 'A')).toBe(0);
  });
});

describe('pickChampion — winner flag over score-sum comparison', () => {
  test('a single final forfeited 2-2 with a winner flag still crowns a champion', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'A', awayTeamId: 'B', homeScore: 2, awayScore: 2, winnerTeamId: 'A' },
    ];
    const winner = pickChampion(rows);
    expect(winner).not.toBeNull();
    expect(winner!.winnerTeamId).toBe('A');
    expect(winner!.loserTeamId).toBe('B');
  });

  test('a genuinely tied series (no winner flag, equal score sum) still returns null', () => {
    const rows: ChampionFinalsRow[] = [
      { homeTeamId: 'A', awayTeamId: 'B', homeScore: 2, awayScore: 2, winnerTeamId: null },
    ];
    expect(pickChampion(rows)).toBeNull();
  });
});

// ---- DB-backed engine tests -------------------------------------------

let seasonId: number;
const userIds: number[] = [];
const leagueIds: string[] = [];

function mkUser(username: string): number {
  const id = db.insert(schema.users).values({
    username, passwordHash: 'x', role: 'user', active: true,
  }).returning().get().id;
  userIds.push(id);
  return id;
}

function mkLeague(id: string): void {
  db.insert(schema.leagues).values({
    id, name: id, color: '#abcdef', seasonId,
    phase: 'offseason', currentWeek: 5, draftOrder: JSON.stringify([]),
  }).run();
  leagueIds.push(id);
}

function mkTeam(id: string, leagueId: string, userId: number | null): void {
  db.insert(schema.teams).values({
    id, leagueId, userId, coachName: id, teamName: id, teamAbbrev: id.slice(0, 3),
  }).run();
}

function cannoliPins(uid: number) {
  return db.select().from(schema.pins).where(and(
    eq(schema.pins.userId, uid), eq(schema.pins.pinDefId, 'cannoli'),
  )).all();
}

function garchompPins(uid: number) {
  return db.select().from(schema.pins).where(and(
    eq(schema.pins.userId, uid), eq(schema.pins.pinDefId, 'garchomp'),
  )).all();
}

beforeAll(() => {
  const season = db.insert(schema.seasons).values({
    seasonNumber: 8600 + (Date.now() % 100), pointCap: 110, teraCaptainSlots: 2, archived: false,
  }).returning().get();
  seasonId = season.id;
});

afterAll(() => {
  try {
    for (const l of leagueIds) {
      db.delete(schema.matches).where(eq(schema.matches.leagueId, l)).run();
      db.delete(schema.teams).where(eq(schema.teams.leagueId, l)).run();
    }
    for (const l of leagueIds) db.delete(schema.leagues).where(eq(schema.leagues.id, l)).run();
    for (const uid of userIds) db.delete(schema.pins).where(eq(schema.pins.userId, uid)).run();
    for (const uid of userIds) db.delete(schema.users).where(eq(schema.users.id, uid)).run();
    db.delete(schema.seasons).where(eq(schema.seasons.id, seasonId)).run();
  } catch { /* DB closed during suite teardown */ }
});

describe('runAutoAwards — forfeit-with-equal-score picks the winner_team_id winner', () => {
  test('Cannoli goes solely to the forfeit winner, not split as a tie', () => {
    const leagueId = `${tag}-forfeit`;
    mkLeague(leagueId);
    const uA = mkUser(`${tag}-fA`);
    const uB = mkUser(`${tag}-fB`);
    mkTeam(`${tag}-fA`, leagueId, uA);
    mkTeam(`${tag}-fB`, leagueId, uB);

    // A wins by forfeit at full health — scored 2-2, but winner_team_id = A.
    // Raw score comparison would call this a tie (0 wins / 0 losses for
    // both), which used to mint Cannoli to BOTH teams as a false tie.
    db.insert(schema.matches).values({
      id: `${tag}-fm1`, leagueId, week: 1, phase: 'regular', status: 'completed',
      homeTeamId: `${tag}-fA`, awayTeamId: `${tag}-fB`, homeScore: 2, awayScore: 2,
      forfeitedBy: 'away', winnerTeamId: `${tag}-fA`,
    }).run();

    const summary = runAutoAwards(leagueId, { trigger: 'season-end' });
    const cannoliAwards = summary.awarded.filter(a => a.pinDefId === 'cannoli');
    expect(cannoliAwards.length).toBe(1);
    expect(cannoliAwards[0].userId).toBe(uA);
    expect(cannoliPins(uA).length).toBe(1);
    expect(cannoliPins(uB).length).toBe(0);
  });
});

describe('manual pins block the auto minter', () => {
  test('a pre-existing source=manual pin blocks auto mint for the same slot', () => {
    const leagueId = `${tag}-manual`;
    mkLeague(leagueId);
    const uC = mkUser(`${tag}-mC`); // would win Cannoli via auto computation
    const uD = mkUser(`${tag}-mD`);
    const uManual = mkUser(`${tag}-mManual`); // curated winner of record
    mkTeam(`${tag}-mC`, leagueId, uC);
    mkTeam(`${tag}-mD`, leagueId, uD);

    db.insert(schema.matches).values({
      id: `${tag}-mm1`, leagueId, week: 1, phase: 'regular', status: 'completed',
      homeTeamId: `${tag}-mC`, awayTeamId: `${tag}-mD`, homeScore: 5, awayScore: 1,
    }).run();

    // Admin-curated pin, filed before the auto job ever runs.
    db.insert(schema.pins).values({
      userId: uManual, pinDefId: 'cannoli', seasonId, leagueId, source: 'manual',
    }).run();

    const summary = runAutoAwards(leagueId, { trigger: 'season-end' });
    const cannoliAwards = summary.awarded.filter(a => a.pinDefId === 'cannoli');
    expect(cannoliAwards.length).toBe(0);
    expect(cannoliPins(uC).length).toBe(0); // auto winner never minted
    expect(cannoliPins(uManual).length).toBe(1); // manual pin untouched
    expect(summary.unresolved.some(
      u => u.pinDefId === 'cannoli' && u.reason === 'manual-pin-present' && u.leagueId === leagueId,
    )).toBe(true);
  });

  test('re-running after an admin override does not revert it', () => {
    const leagueId = `${tag}-override`;
    mkLeague(leagueId);
    const uF = mkUser(`${tag}-oF`); // original auto winner
    const uG = mkUser(`${tag}-oG`); // admin's corrected winner
    mkTeam(`${tag}-oF`, leagueId, uF);
    mkTeam(`${tag}-oG`, leagueId, uG);

    db.insert(schema.matches).values({
      id: `${tag}-om1`, leagueId, week: 1, phase: 'regular', status: 'completed',
      homeTeamId: `${tag}-oF`, awayTeamId: `${tag}-oG`, homeScore: 4, awayScore: 0,
    }).run();

    // First run: auto job picks F.
    const first = runAutoAwards(leagueId, { trigger: 'season-end' });
    expect(first.awarded.some(a => a.pinDefId === 'cannoli' && a.userId === uF)).toBe(true);
    expect(cannoliPins(uF).length).toBe(1);

    // Admin override: remove the auto pin, hand-award a manual one to G.
    db.delete(schema.pins).where(and(
      eq(schema.pins.userId, uF), eq(schema.pins.pinDefId, 'cannoli'), eq(schema.pins.leagueId, leagueId),
    )).run();
    db.insert(schema.pins).values({
      userId: uG, pinDefId: 'cannoli', seasonId, leagueId, source: 'manual', awardedBy: uF,
    }).run();

    // Re-run: must NOT resurrect F's auto pick, must NOT touch G's override.
    const second = runAutoAwards(leagueId, { trigger: 'season-end' });
    expect(second.awarded.some(a => a.pinDefId === 'cannoli')).toBe(false);
    expect(cannoliPins(uF).length).toBe(0);
    expect(cannoliPins(uG).length).toBe(1);
    expect(second.unresolved.some(u => u.pinDefId === 'cannoli' && u.reason === 'manual-pin-present')).toBe(true);
  });
});

describe('mintArchivePins — unresolved instead of silent drop', () => {
  test('a champion team with no linked user records an unresolved entry, not silence', () => {
    const leagueId = `${tag}-orphan`;
    mkLeague(leagueId);
    mkTeam(`${tag}-orphanWinner`, leagueId, null); // orphan — no userId, like s9-ruby-fam
    const uLoser = mkUser(`${tag}-orphanLoser`);
    mkTeam(`${tag}-orphanLoser`, leagueId, uLoser);

    db.insert(schema.matches).values({
      id: `${tag}-cf1`, leagueId, week: 11, phase: 'playoffs', playoffRound: 'f', status: 'completed',
      homeTeamId: `${tag}-orphanWinner`, awayTeamId: `${tag}-orphanLoser`, homeScore: 3, awayScore: 1,
      winnerTeamId: `${tag}-orphanWinner`,
    }).run();

    const summary = mintArchivePins(leagueId);
    expect(summary.awarded.some(a => a.pinDefId === 'champion')).toBe(false);
    expect(summary.unresolved.some(
      u => u.pinDefId === 'champion' && u.reason === 'team-has-no-user'
        && u.teamId === `${tag}-orphanWinner` && u.leagueId === leagueId,
    )).toBe(true);
  });
});

describe('ties collapse to exactly one deterministic winner', () => {
  test('a 3-way Garchomp tie mints exactly one pin, and re-running keeps the same winner', () => {
    const leagueId = `${tag}-tie3`;
    mkLeague(leagueId);
    const uA = mkUser(`${tag}-t3ua`);
    const uB = mkUser(`${tag}-t3ub`);
    const uC = mkUser(`${tag}-t3uc`);
    const uD = mkUser(`${tag}-t3ud`);
    // Team ids share a prefix so the last-resort tiebreak (lowest team id,
    // since none of these have a teams.rank stamped) is predictable: a < b < c.
    const teamA = `${tag}-t3-a`, teamB = `${tag}-t3-b`, teamC = `${tag}-t3-c`, teamD = `${tag}-t3-d`;
    mkTeam(teamA, leagueId, uA);
    mkTeam(teamB, leagueId, uB);
    mkTeam(teamC, leagueId, uC);
    mkTeam(teamD, leagueId, uD);

    // A, B, C each get exactly 5 kills on a distinct Pokemon (same deaths,
    // no standings rank) — a genuine 3-way tie with nothing to naturally
    // break it except the last-resort team-id fallback.
    for (const [week, teamId, mon] of [[1, teamA, 'mon-a'], [2, teamB, 'mon-b'], [3, teamC, 'mon-c']] as const) {
      const matchId = `${tag}-t3m${week}`;
      db.insert(schema.matches).values({
        id: matchId, leagueId, week, phase: 'regular', status: 'completed',
        homeTeamId: teamId, awayTeamId: teamD, homeScore: 5, awayScore: 0,
      }).run();
      db.insert(schema.matchPokemon).values({
        matchId, teamId, pokemonName: mon, kills: 5, deaths: 0,
      }).run();
    }

    const first = runAutoAwards(leagueId, { trigger: 'season-end' });
    const garchompAwards = first.awarded.filter(a => a.pinDefId === 'garchomp');
    expect(garchompAwards.length).toBe(1);
    expect(garchompAwards[0].userId).toBe(uA);
    expect(garchompPins(uA).length).toBe(1);
    expect(garchompPins(uB).length).toBe(0);
    expect(garchompPins(uC).length).toBe(0);

    // Re-run: same tied inputs must resolve to the SAME winner, not flip
    // arbitrarily on row order.
    const second = runAutoAwards(leagueId, { trigger: 'season-end' });
    const secondGarchomp = second.awarded.filter(a => a.pinDefId === 'garchomp');
    expect(secondGarchomp.length).toBe(1);
    expect(secondGarchomp[0].userId).toBe(uA);
    expect(garchompPins(uA).length).toBe(1);
    expect(garchompPins(uB).length).toBe(0);
    expect(garchompPins(uC).length).toBe(0);
  });
});

describe('two leagues in one season both mint for the same user', () => {
  test('the league_id column lets a coach in two leagues hold both season pins', () => {
    const leagueA = `${tag}-multiA`;
    const leagueB = `${tag}-multiB`;
    mkLeague(leagueA);
    mkLeague(leagueB);
    const uShared = mkUser(`${tag}-shared`);
    const uLoserA = mkUser(`${tag}-loserA`);
    const uLoserB = mkUser(`${tag}-loserB`);
    mkTeam(`${tag}-sharedA`, leagueA, uShared);
    mkTeam(`${tag}-loserA`, leagueA, uLoserA);
    mkTeam(`${tag}-sharedB`, leagueB, uShared);
    mkTeam(`${tag}-loserB`, leagueB, uLoserB);

    db.insert(schema.matches).values({
      id: `${tag}-maA`, leagueId: leagueA, week: 1, phase: 'regular', status: 'completed',
      homeTeamId: `${tag}-sharedA`, awayTeamId: `${tag}-loserA`, homeScore: 6, awayScore: 0,
    }).run();
    db.insert(schema.matches).values({
      id: `${tag}-maB`, leagueId: leagueB, week: 1, phase: 'regular', status: 'completed',
      homeTeamId: `${tag}-sharedB`, awayTeamId: `${tag}-loserB`, homeScore: 6, awayScore: 0,
    }).run();

    runAutoAwards(leagueA, { trigger: 'season-end' });
    runAutoAwards(leagueB, { trigger: 'season-end' });

    const pins = cannoliPins(uShared);
    expect(pins.length).toBe(2);
    expect(new Set(pins.map(p => p.leagueId))).toEqual(new Set([leagueA, leagueB]));
    for (const p of pins) expect(p.source).toBe('auto');
  });
});
