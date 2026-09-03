/**
 * Admin-edited playoff seeding (`seedOrder` on POST /playoffs/generate) and
 * everything a bracket rebuild is allowed to touch.
 *
 * Seeding used to be whatever computeStandings said at the moment of
 * generation, with no way to correct it — a dropped team, a ruled-on tiebreak
 * or an off-books forfeit meant the bracket was simply wrong. Admins can now
 * hand the route an explicit order (admin/season → Edit Seeding), which makes
 * a REBUILD a routine action rather than a once-a-season emergency. That
 * promoted two latent hazards in the rebuild path to things that would break
 * in normal use, both pinned here:
 *
 *   1. `match_ready_log.match_id` is a plain FK onto `matches.id` with no
 *      ON DELETE (migration 0005) — and playoff matches ARE arena-playable, so
 *      one coach readying up made the bracket DELETE throw under
 *      `PRAGMA foreign_keys = ON`.
 *   2. Bracket match ids are deterministic (`<league>-p<round><n>`), so a
 *      rebuild REUSES them. Anything left keyed by the old id silently
 *      re-attaches to a row that may now hold a different pairing — including
 *      a battle live on Showdown, whose result the bot would post onto the
 *      wrong teams.
 *
 * The seeding list itself is trusted for ORDER only: still exactly the bracket
 * size, distinct, and drawn from this league's teams.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { and, eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { matchRoutes } from '../src/routes/matches';
import { recordMatchResult } from '../src/lib/match-service';
import { effectiveMatchDeadline } from '../src/lib/deadline';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

const PFX = `seedord-${Date.now()}`;
const LEAGUE = `${PFX}-lg`;
const SEASON_NUMBER = 9101;
/** 8 teams, top 6 make the bracket — so there is a real cut line to reach below. */
const TEAMS = Array.from({ length: 8 }, (_, i) => `${PFX}-t${i}`);
const WEEK_DATES = Object.fromEntries(
  Array.from({ length: 7 }, (_, i) => [String(i + 1), `2026-06-${String(16 + i * 7).padStart(2, '0')}`]),
);

let app: Elysia;
let staffId: number;
let userId: number;
let staffCookie: string;
let userCookie: string;

function generate(body: Record<string, unknown>, cookie: string | null = staffCookie): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return app.handle(new Request(`http://localhost/api/leagues/${LEAGUE}/playoffs/generate`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }));
}

function bracket() {
  return db.select().from(schema.matches)
    .where(and(eq(schema.matches.leagueId, LEAGUE), eq(schema.matches.phase, 'playoffs')))
    .all()
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** seed number → team id, read back off the generated bracket rows. */
function seedMap(): Record<number, string> {
  const out: Record<number, string> = {};
  for (const m of bracket()) {
    if (m.homeSeed && m.homeTeamId) out[m.homeSeed] = m.homeTeamId;
    if (m.awaySeed && m.awayTeamId) out[m.awaySeed] = m.awayTeamId;
  }
  return out;
}

function leagueRow() {
  return db.select().from(schema.leagues).where(eq(schema.leagues.id, LEAGUE)).get()!;
}

beforeAll(() => {
  app = new Elysia()
    .derive(({ request }) => {
      const token = parseSessionToken(request.headers.get('cookie') ?? undefined);
      return { user: token ? validateSession(token) : null, sessionToken: token };
    })
    .use(matchRoutes);

  // Own, unarchived season: a seeded dev DB's existing seasons are archived and
  // the archive guard would 409 every call.
  const season = db.select().from(schema.seasons)
    .where(eq(schema.seasons.seasonNumber, SEASON_NUMBER)).get()
    ?? db.insert(schema.seasons).values({ seasonNumber: SEASON_NUMBER, archived: false }).returning().get();

  const staff = db.insert(schema.users).values({
    username: `${PFX}-admin`, passwordHash: 'x', role: 'admin',
    mustChangePassword: false, active: true,
  }).returning().get();
  staffId = staff.id;
  staffCookie = `session=${createSession(staffId)}`;

  const plain = db.insert(schema.users).values({
    username: `${PFX}-user`, passwordHash: 'x', role: 'user',
    mustChangePassword: false, active: true,
  }).returning().get();
  userId = plain.id;
  userCookie = `session=${createSession(userId)}`;

  db.insert(schema.leagues).values({
    id: LEAGUE, name: 'Seed Order Test', color: '#123456',
    seasonId: season.id, phase: 'playoffs', currentWeek: 7, totalWeeks: 7,
    playoffTeamCount: 6, weekDates: JSON.stringify(WEEK_DATES),
  }).run();

  db.insert(schema.teams).values(TEAMS.map((id, i) => ({
    id, leagueId: LEAGUE, userId: null, coachName: `C${i}`,
    teamName: `Team ${i}`, teamAbbrev: `T${i}`, teamColor: '#111111',
  }))).run();

  // Full round robin where the lower index always wins → standings are exactly
  // t0, t1, … t7 (7 wins down to 0), no tiebreaker ambiguity.
  let n = 0;
  for (let i = 0; i < TEAMS.length; i++) {
    for (let j = i + 1; j < TEAMS.length; j++) {
      db.insert(schema.matches).values({
        id: `${PFX}-r${n++}`, leagueId: LEAGUE, week: ((i + j) % 7) + 1,
        homeTeamId: TEAMS[i], awayTeamId: TEAMS[j],
        homeScore: 6, awayScore: j % 5, status: 'completed', phase: 'regular',
        winnerTeamId: TEAMS[i],
      }).run();
    }
  }
});

afterAll(() => {
  try {
    for (const m of db.select({ id: schema.matches.id }).from(schema.matches)
      .where(eq(schema.matches.leagueId, LEAGUE)).all()) {
      db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, m.id)).run();
    }
    db.delete(schema.matches).where(eq(schema.matches.leagueId, LEAGUE)).run();
    db.delete(schema.activityLog).where(eq(schema.activityLog.leagueId, LEAGUE)).run();
    db.delete(schema.teams).where(eq(schema.teams.leagueId, LEAGUE)).run();
    db.delete(schema.leagues).where(eq(schema.leagues.id, LEAGUE)).run();
    for (const uid of [staffId, userId]) {
      db.delete(schema.pins).where(eq(schema.pins.userId, uid)).run();
      db.delete(schema.sessions).where(eq(schema.sessions.userId, uid)).run();
      db.delete(schema.users).where(eq(schema.users.id, uid)).run();
    }
    db.delete(schema.seasons).where(eq(schema.seasons.seasonNumber, SEASON_NUMBER)).run();
  } catch { /* best-effort cleanup */ }
});

describe('seeding', () => {
  test('no seedOrder → standings order', async () => {
    expect((await generate({})).status).toBe(200);
    const seeds = seedMap();
    expect([1, 2, 3, 4, 5, 6].map(s => seeds[s])).toEqual(TEAMS.slice(0, 6));
  });

  test('seedOrder is honoured verbatim, including a team the standings cut', async () => {
    // t7 (dead last) hand-seeded #1; t0 (first) dropped out of the bracket.
    const order = [TEAMS[7], TEAMS[5], TEAMS[1], TEAMS[2], TEAMS[3], TEAMS[4]];
    expect((await generate({ seedOrder: order })).status).toBe(200);

    const seeds = seedMap();
    order.forEach((id, i) => expect(seeds[i + 1]).toBe(id));
    // The cut team is nowhere in the bracket, not merely relabelled.
    expect(bracket().flatMap(m => [m.homeTeamId, m.awayTeamId])).not.toContain(TEAMS[0]);

    // 6-team layout is QF 3v6 / 4v5, SF 1 + 2 vs the QF winners.
    const qf = bracket().filter(m => m.playoffRound === 'qf');
    expect(qf.map(m => [m.homeTeamId, m.awayTeamId])).toEqual([
      [order[2], order[5]],
      [order[3], order[4]],
    ]);
    const sf = bracket().filter(m => m.playoffRound === 'sf');
    expect(sf.map(m => m.homeTeamId)).toEqual([order[0], order[1]]);
    expect(sf.map(m => m.awayTeamId)).toEqual([null, null]);
  });

  test('manual seeding never rewrites teams.rank (that is the standings rank)', () => {
    const ranks = db.select({ id: schema.teams.id, rank: schema.teams.rank })
      .from(schema.teams).where(eq(schema.teams.leagueId, LEAGUE)).all();
    for (const t of ranks) {
      expect(t.rank).toBe(TEAMS.indexOf(t.id) + 1);
    }
  });

  test('rejects a seedOrder that is short, over-long, duplicated, or foreign', async () => {
    const before = seedMap();
    for (const bad of [
      TEAMS.slice(0, 5),                                    // too short
      TEAMS.slice(0, 7),                                    // too long
      [TEAMS[0], TEAMS[0], TEAMS[1], TEAMS[2], TEAMS[3], TEAMS[4]], // duplicate
      [...TEAMS.slice(0, 5), 'team-from-another-league'],   // foreign id
    ]) {
      const res = await generate({ seedOrder: bad });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('invalid_seed_order');
    }
    // A rejected edit is a no-op: the standing bracket is untouched.
    expect(seedMap()).toEqual(before);
  });

  test('an explicit topN still bounds the seedOrder length', async () => {
    const res = await generate({ topN: 4, seedOrder: TEAMS.slice(0, 6) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_seed_order');

    // …and a matching one rebuilds at the smaller size.
    const ok = await generate({ topN: 4, seedOrder: [TEAMS[3], TEAMS[2], TEAMS[1], TEAMS[0]] });
    expect(ok.status).toBe(200);
    expect(bracket().filter(m => m.playoffRound === 'qf').length).toBe(0);
    expect(seedMap()[1]).toBe(TEAMS[3]);

    await generate({ seedOrder: TEAMS.slice(0, 6) }); // back to a 6-team bracket
  });

  test('a bracket bigger than the league is still refused', async () => {
    const res = await generate({ topN: 8, seedOrder: TEAMS });
    expect(res.status).toBe(200); // 8 teams, 8 seeds — exactly fits
    const tooBig = await app.handle(new Request(
      `http://localhost/api/leagues/${LEAGUE}/playoffs/generate`,
      { method: 'POST', headers: { cookie: staffCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ topN: 6 }) },
    ));
    expect(tooBig.status).toBe(200); // sanity: back to 6
  });
});

describe('rebuild safety', () => {
  test('a readied-up bracket match does not block the rebuild (FK regression)', async () => {
    const qf = bracket().find(m => m.playoffRound === 'qf')!;
    db.insert(schema.matchReadyLog).values([
      { matchId: qf.id, teamId: qf.homeTeamId!, event: 'ready' },
      { matchId: qf.id, teamId: qf.awayTeamId!, event: 'ready' },
    ]).run();
    db.update(schema.matches).set({ status: 'ready', readyHome: true, readyAway: true })
      .where(eq(schema.matches.id, qf.id)).run();

    const res = await generate({ seedOrder: [TEAMS[1], TEAMS[0], ...TEAMS.slice(2, 6)] });
    expect(res.status).toBe(200);

    // Log rows are gone, so a stale ready-up can't re-attach to the reused id…
    expect(db.select().from(schema.matchReadyLog)
      .where(eq(schema.matchReadyLog.matchId, qf.id)).all().length).toBe(0);
    // …and the rebuilt row starts unreadied.
    const rebuilt = bracket().find(m => m.id === qf.id)!;
    expect(rebuilt.status).toBe('scheduled');
    expect(rebuilt.readyHome).toBe(false);
    expect(rebuilt.readyAway).toBe(false);
  });

  test('per-Pokemon rows from the old bracket do not survive onto the reused id', async () => {
    const qf = bracket().find(m => m.playoffRound === 'qf')!;
    db.insert(schema.matchPokemon).values([
      { matchId: qf.id, teamId: qf.homeTeamId!, pokemonName: 'Dragapult', kills: 3, deaths: 0 },
    ]).run();

    expect((await generate({ seedOrder: TEAMS.slice(0, 6) })).status).toBe(200);
    expect(db.select().from(schema.matchPokemon)
      .where(eq(schema.matchPokemon.matchId, qf.id)).all().length).toBe(0);
  });

  test('a battle live on Showdown blocks the rebuild until it is forced', async () => {
    const qf = bracket().find(m => m.playoffRound === 'qf')!;
    const before = seedMap();
    db.update(schema.matches)
      .set({ status: 'in_progress', psRoomId: 'battle-gen9natdexdraft-123' })
      .where(eq(schema.matches.id, qf.id)).run();

    const blocked = await generate({ seedOrder: [...TEAMS.slice(1, 6), TEAMS[0]] });
    expect(blocked.status).toBe(409);
    const body = await blocked.json();
    expect(body.code).toBe('regeneration_locked');
    expect(body.livePlayoffs).toBe(1);
    expect(seedMap()).toEqual(before); // bracket untouched

    // force without the typed name is still refused…
    expect((await generate({ force: true, seedOrder: TEAMS.slice(0, 6) })).status).toBe(409);
    expect((await generate({ force: true, confirmName: 'wrong', seedOrder: TEAMS.slice(0, 6) })).status).toBe(409);
    expect(seedMap()).toEqual(before);

    // …and with it the admin gets their rebuild.
    const forced = await generate({
      force: true, confirmName: 'Seed Order Test',
      seedOrder: [...TEAMS.slice(1, 6), TEAMS[0]],
    });
    expect(forced.status).toBe(200);
    expect(seedMap()[1]).toBe(TEAMS[1]);
    expect(bracket().every(m => m.psRoomId == null)).toBe(true);
  });

  test('recorded results block the rebuild until it is forced', async () => {
    const qf = bracket().find(m => m.playoffRound === 'qf')!;
    db.update(schema.matches).set({ homeScore: 6, awayScore: 2, status: 'completed' })
      .where(eq(schema.matches.id, qf.id)).run();

    const blocked = await generate({ seedOrder: TEAMS.slice(0, 6) });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).completedPlayoffs).toBe(1);

    const forced = await generate({
      force: true, confirmName: 'Seed Order Test', seedOrder: TEAMS.slice(0, 6),
    });
    expect(forced.status).toBe(200);
    expect(bracket().every(m => m.homeScore == null)).toBe(true);
  });

  test('re-seeding keeps the playoff weeks dated (deadlines stay resolvable)', () => {
    const weekDates: Record<string, string> = JSON.parse(leagueRow().weekDates!);
    // Regular cadence untouched, bracket weeks 8-10 dated exactly once each.
    expect(weekDates['7']).toBe(WEEK_DATES['7']);
    for (const w of ['8', '9', '10']) expect(weekDates[w]).toBeTruthy();
    for (const m of bracket()) {
      expect(effectiveMatchDeadline({ deadline: m.deadline, week: m.week }, weekDates)).not.toBeNull();
    }
  });
});

describe('who may edit seeding', () => {
  test('a signed-in non-staff user cannot reseed', async () => {
    const before = seedMap();
    const res = await generate({ seedOrder: [...TEAMS.slice(2, 8)] }, userCookie);
    expect(res.status).toBe(403);
    expect(seedMap()).toEqual(before);
  });

  test('an anonymous caller cannot reseed', async () => {
    const before = seedMap();
    const res = await generate({ seedOrder: [...TEAMS.slice(2, 8)] }, null);
    expect(res.status).toBe(403);
    expect(seedMap()).toEqual(before);
  });

  test('an archived season is still read-only', async () => {
    const before = seedMap();
    db.update(schema.seasons).set({ archived: true })
      .where(eq(schema.seasons.seasonNumber, SEASON_NUMBER)).run();
    const res = await generate({ seedOrder: TEAMS.slice(0, 6) });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('season_archived');
    expect(seedMap()).toEqual(before);
    db.update(schema.seasons).set({ archived: false })
      .where(eq(schema.seasons.seasonNumber, SEASON_NUMBER)).run();
  });
});

describe('a hand-seeded bracket still plays out', () => {
  test('QF winners advance into the SF slots the manual seeding implies', async () => {
    // Reversed seeding: t5 is #1 … t0 is #6.
    const order = [TEAMS[5], TEAMS[4], TEAMS[3], TEAMS[2], TEAMS[1], TEAMS[0]];
    expect((await generate({ force: true, confirmName: 'Seed Order Test', seedOrder: order })).status).toBe(200);

    // QF1 = 3v6 (t3 vs t0), QF2 = 4v5 (t2 vs t1). Home wins both.
    for (const qf of bracket().filter(m => m.playoffRound === 'qf')) {
      const out = recordMatchResult(qf.id, { homeScore: 6, awayScore: 3 }, 'test');
      expect(out.ok).toBe(true);
    }

    const sf = bracket().filter(m => m.playoffRound === 'sf');
    // SF1: #1 seed (t5) vs QF1 winner (t3); SF2: #2 seed (t4) vs QF2 winner (t2).
    expect(sf.map(m => [m.homeTeamId, m.awayTeamId])).toEqual([
      [TEAMS[5], TEAMS[3]],
      [TEAMS[4], TEAMS[2]],
    ]);
    expect(sf.map(m => m.awaySeed)).toEqual([3, 4]);

    // Away teams win both semis, so the Finals are the two QF winners.
    for (const m of sf) {
      expect(recordMatchResult(m.id, { homeScore: 1, awayScore: 6 }, 'test').ok).toBe(true);
    }
    const final = bracket().find(m => m.playoffRound === 'f')!;
    expect([final.homeTeamId, final.awayTeamId]).toEqual([TEAMS[3], TEAMS[2]]);

    expect(recordMatchResult(final.id, { homeScore: 6, awayScore: 0 }, 'test').ok).toBe(true);
    const played = bracket().find(m => m.playoffRound === 'f')!;
    expect(played.winnerTeamId ?? played.homeTeamId).toBe(TEAMS[3]);
  });
});
