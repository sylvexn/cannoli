/**
 * Manual playoff seeding (`seedOrder` on POST /playoffs/generate).
 *
 * Seeding used to be whatever computeStandings said at the moment of
 * generation, with no way to correct it — a dropped team, a ruled-on
 * tiebreak or an off-books forfeit meant the bracket was simply wrong.
 * Admins can now hand the route an explicit order (admin/season → Edit
 * Seeding). The list is trusted for ORDER only: it still has to be exactly
 * the bracket size, distinct, and drawn from this league's teams, or the
 * bracket layout silently loses a slot.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { matchRoutes } from '../src/routes/matches';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

const PFX = `seedord-${Date.now()}`;
const LEAGUE = `${PFX}-lg`;
const TEAMS = ['a', 'b', 'c', 'd'].map(k => `${PFX}-${k}`);

let app: Elysia;
let staffId: number;
let staffCookie: string;

function generate(body: Record<string, unknown>): Promise<Response> {
  return app.handle(new Request(`http://localhost/api/leagues/${LEAGUE}/playoffs/generate`, {
    method: 'POST',
    headers: { cookie: staffCookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

/** seed number → team id, off the generated bracket rows. */
function seedMap(): Record<number, string> {
  const out: Record<number, string> = {};
  for (const m of db.select().from(schema.matches).where(eq(schema.matches.leagueId, LEAGUE)).all()) {
    if (m.phase !== 'playoffs') continue;
    if (m.homeSeed && m.homeTeamId) out[m.homeSeed] = m.homeTeamId;
    if (m.awaySeed && m.awayTeamId) out[m.awaySeed] = m.awayTeamId;
  }
  return out;
}

beforeAll(() => {
  app = new Elysia()
    .derive(({ request }) => {
      const token = parseSessionToken(request.headers.get('cookie') ?? undefined);
      return { user: token ? validateSession(token) : null, sessionToken: token };
    })
    .use(matchRoutes);

  // Fresh, unarchived season — a seeded dev DB's existing seasons are archived,
  // and archive guards would 409 every generate call.
  const season = db.select().from(schema.seasons).where(eq(schema.seasons.seasonNumber, 9101)).get()
    ?? db.insert(schema.seasons).values({ seasonNumber: 9101, archived: false }).returning().get();

  const staff = db.insert(schema.users).values({
    username: `${PFX}-admin`, passwordHash: 'x', role: 'admin',
    mustChangePassword: false, active: true,
  }).returning().get();
  staffId = staff.id;
  staffCookie = `session=${createSession(staffId)}`;

  db.insert(schema.leagues).values({
    id: LEAGUE, name: 'Seed Order Test', color: '#123456',
    seasonId: season.id, phase: 'playoffs', currentWeek: 3,
    playoffTeamCount: 4,
  }).run();

  db.insert(schema.teams).values(TEAMS.map((id, i) => ({
    id, leagueId: LEAGUE, userId: null, coachName: `C${i}`,
    teamName: `Team ${i}`, teamAbbrev: `T${i}`, teamColor: '#111111',
  }))).run();

  // Two regular weeks so standings order is a → b → c → d (a wins both, etc).
  const played: [string, string, number, number, number][] = [
    [TEAMS[0], TEAMS[3], 6, 0, 1],
    [TEAMS[1], TEAMS[2], 6, 3, 1],
    [TEAMS[0], TEAMS[2], 6, 1, 2],
    [TEAMS[1], TEAMS[3], 6, 4, 2],
  ];
  played.forEach(([home, away, hs, as_, week], i) => {
    db.insert(schema.matches).values({
      id: `${PFX}-r${i}`, leagueId: LEAGUE, week,
      homeTeamId: home, awayTeamId: away,
      homeScore: hs, awayScore: as_, status: 'completed', phase: 'regular',
    }).run();
  });
});

afterAll(() => {
  try {
    db.delete(schema.matches).where(eq(schema.matches.leagueId, LEAGUE)).run();
    db.delete(schema.teams).where(eq(schema.teams.leagueId, LEAGUE)).run();
    db.delete(schema.leagues).where(eq(schema.leagues.id, LEAGUE)).run();
    db.delete(schema.sessions).where(eq(schema.sessions.userId, staffId)).run();
    db.delete(schema.users).where(eq(schema.users.id, staffId)).run();
    db.delete(schema.seasons).where(eq(schema.seasons.seasonNumber, 9101)).run();
  } catch { /* best-effort cleanup */ }
});

describe('playoff seedOrder override', () => {
  test('no seedOrder → standings order (a, b are the top seeds)', async () => {
    const res = await generate({});
    expect(res.status).toBe(200);
    const seeds = seedMap();
    expect(seeds[1]).toBe(TEAMS[0]);
    expect(seeds[2]).toBe(TEAMS[1]);
  });

  test('seedOrder is honoured verbatim, including a team standings left out', async () => {
    // d (last in standings) hand-seeded #1, a dropped to #4.
    const order = [TEAMS[3], TEAMS[2], TEAMS[1], TEAMS[0]];
    const res = await generate({ seedOrder: order });
    expect(res.status).toBe(200);

    const seeds = seedMap();
    order.forEach((id, i) => expect(seeds[i + 1]).toBe(id));

    // 4-team layout is SF 1v4 / 2v3 — the reorder must move real teams, not
    // just the seed labels.
    const sf = db.select().from(schema.matches).where(eq(schema.matches.leagueId, LEAGUE)).all()
      .filter(m => m.playoffRound === 'sf')
      .sort((x, y) => x.id.localeCompare(y.id));
    expect(sf.map(m => [m.homeTeamId, m.awayTeamId])).toEqual([
      [TEAMS[3], TEAMS[0]],
      [TEAMS[2], TEAMS[1]],
    ]);
  });

  test('rejects a seedOrder that is short, duplicated, or foreign to the league', async () => {
    for (const bad of [
      [TEAMS[0], TEAMS[1], TEAMS[2]],                       // too short
      [TEAMS[0], TEAMS[0], TEAMS[1], TEAMS[2]],             // duplicate
      [TEAMS[0], TEAMS[1], TEAMS[2], 'some-other-league'],  // not in this league
    ]) {
      const res = await generate({ seedOrder: bad });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('invalid_seed_order');
    }
    // The rejected calls left the good bracket from the previous test alone.
    expect(seedMap()[1]).toBe(TEAMS[3]);
  });
});
