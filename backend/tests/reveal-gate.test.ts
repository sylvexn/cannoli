/**
 * Results-reveal gate on the per-match endpoints.
 *
 * The league-level gate (`leagues.resultsRevealedThrough`) hides unrevealed
 * weeks from the schedule/standings/stats endpoints. Three per-match endpoints
 * bypassed it entirely and served unrevealed results to ANONYMOUS callers:
 *
 *   - /api/matches/:id/replay-summary  → `scoreLine` straight off the match row
 *   - /api/matches/:id/pokemon         → per-mon K/D (winner is trivially derived)
 *   - /api/matches/:id/replay.json     → the entire battle log
 *
 * Contract verified here: a revealed week stays fully readable, an unrevealed
 * week is withheld from anonymous/non-staff viewers using the SAME response
 * shape as "no such match" (so the gate can't be probed), staff bypass the gate
 * (the stream cockpit reviews results before publishing), and a NULL gate means
 * everything is public.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { matchRoutes } from '../src/routes/matches';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

const PFX = `rgate-${Date.now()}`;
const LEAGUE = `${PFX}-lg`;
const REVEALED = `${PFX}-m5`;   // week 5 — inside the gate
const HIDDEN = `${PFX}-m6`;     // week 6 — beyond the gate
const LOG = '|player|p1|Home|\n|player|p2|Away|\n|tier|[Gen 9] NatDex Draft\n|win|Home';

let app: Elysia;
let staffId: number;
let userId: number;
let staffCookie: string;
let userCookie: string;

function hit(path: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return app.handle(new Request(`http://localhost${path}`, { method: 'GET', headers }));
}

/** Raw body text. A handler returning `null` serializes to an EMPTY body, not
 *  the literal "null", so withheld responses must be compared as text. */
async function body(path: string, cookie?: string): Promise<string> {
  return (await hit(path, cookie)).text();
}

/** Set (or clear, with null) the league's reveal high-water mark. */
function setGate(week: number | null) {
  db.update(schema.leagues)
    .set({ resultsRevealedThrough: week })
    .where(eq(schema.leagues.id, LEAGUE))
    .run();
}

beforeAll(() => {
  app = new Elysia()
    .derive(({ request }) => {
      const token = parseSessionToken(request.headers.get('cookie') ?? undefined);
      return { user: token ? validateSession(token) : null, sessionToken: token };
    })
    .use(matchRoutes);

  // Self-seed rather than requiring a seeded dev DB: CI runs against an empty
  // database, where demanding `bun run seed:sim` first fails the whole file.
  // Every other row this suite needs (league, teams, matches) is created below,
  // so a bare season row is the only external dependency.
  const season = db.select().from(schema.seasons).limit(1).all()[0]
    ?? db.insert(schema.seasons).values({ seasonNumber: 9100, archived: false }).returning().get();

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
    id: LEAGUE, name: 'Reveal Gate Test', color: '#123456',
    seasonId: season.id, phase: 'regular', currentWeek: 7,
    resultsRevealedThrough: 5,
  }).run();

  db.insert(schema.teams).values([
    { id: `${PFX}-h`, leagueId: LEAGUE, userId: null, coachName: 'H', teamName: 'Home', teamAbbrev: 'HH', teamColor: '#111111' },
    { id: `${PFX}-a`, leagueId: LEAGUE, userId: null, coachName: 'A', teamName: 'Away', teamAbbrev: 'AA', teamColor: '#222222' },
  ]).run();

  for (const [id, week] of [[REVEALED, 5], [HIDDEN, 6]] as const) {
    db.insert(schema.matches).values({
      id, leagueId: LEAGUE, week,
      homeTeamId: `${PFX}-h`, awayTeamId: `${PFX}-a`,
      homeScore: 6, awayScore: 2,
      status: 'completed', phase: 'regular', replayLog: LOG,
    }).run();
    db.insert(schema.matchPokemon).values([
      { matchId: id, teamId: `${PFX}-h`, pokemonName: 'Dragapult', kills: 6, deaths: 0 },
      { matchId: id, teamId: `${PFX}-a`, pokemonName: 'Pikachu', kills: 2, deaths: 6 },
    ]).run();
  }
});

afterAll(() => {
  try {
    for (const id of [REVEALED, HIDDEN]) {
      db.delete(schema.matchPokemon).where(eq(schema.matchPokemon.matchId, id)).run();
      db.delete(schema.matches).where(eq(schema.matches.id, id)).run();
    }
    db.delete(schema.teams).where(eq(schema.teams.leagueId, LEAGUE)).run();
    db.delete(schema.leagues).where(eq(schema.leagues.id, LEAGUE)).run();
    for (const uid of [staffId, userId]) {
      db.delete(schema.sessions).where(eq(schema.sessions.userId, uid)).run();
      db.delete(schema.users).where(eq(schema.users.id, uid)).run();
    }
  } catch { /* best-effort cleanup */ }
});

describe('results-reveal gate — per-match endpoints', () => {
  test('revealed week stays fully readable anonymously', async () => {
    const summary = await (await hit(`/api/matches/${REVEALED}/replay-summary`)).json();
    expect(summary).not.toBeNull();
    expect(summary.scoreLine).toBe('6-2');

    const mons = await (await hit(`/api/matches/${REVEALED}/pokemon`)).json();
    expect(mons.home.length).toBe(1);
    expect(mons.away.length).toBe(1);

    const replay = await hit(`/api/matches/${REVEALED}/replay.json`);
    expect(replay.status).toBe(200);
    expect((await replay.json()).log).toContain('|win|Home');
  });

  test('unrevealed week is withheld from anonymous callers', async () => {
    // This is the regression: all three of these leaked pre-fix.
    expect(await body(`/api/matches/${HIDDEN}/replay-summary`)).toBe('');

    const mons = await (await hit(`/api/matches/${HIDDEN}/pokemon`)).json();
    expect(mons).toEqual({ home: [], away: [] });

    expect((await hit(`/api/matches/${HIDDEN}/replay.json`)).status).toBe(404);
  });

  test('unrevealed week is withheld from a signed-in non-staff user too', async () => {
    expect(await body(`/api/matches/${HIDDEN}/replay-summary`, userCookie)).toBe('');
    expect(await (await hit(`/api/matches/${HIDDEN}/pokemon`, userCookie)).json())
      .toEqual({ home: [], away: [] });
    expect((await hit(`/api/matches/${HIDDEN}/replay.json`, userCookie)).status).toBe(404);
  });

  test('withheld response is shaped exactly like a nonexistent match (not probeable)', async () => {
    const missing = `${PFX}-nope`;
    expect(await body(`/api/matches/${HIDDEN}/replay-summary`))
      .toBe(await body(`/api/matches/${missing}/replay-summary`));
    expect(await body(`/api/matches/${HIDDEN}/pokemon`))
      .toBe(await body(`/api/matches/${missing}/pokemon`));
    expect((await hit(`/api/matches/${HIDDEN}/replay.json`)).status)
      .toBe((await hit(`/api/matches/${missing}/replay.json`)).status);
  });

  test('staff bypass the gate — the stream cockpit needs pre-publish results', async () => {
    const summary = await (await hit(`/api/matches/${HIDDEN}/replay-summary`, staffCookie)).json();
    expect(summary?.scoreLine).toBe('6-2');

    const mons = await (await hit(`/api/matches/${HIDDEN}/pokemon`, staffCookie)).json();
    expect(mons.home.length).toBe(1);

    expect((await hit(`/api/matches/${HIDDEN}/replay.json`, staffCookie)).status).toBe(200);
  });

  test('a staff-visible unrevealed replay is never publicly cacheable', async () => {
    // Response varies by viewer, so a shared cache must not replay a staff log
    // to anonymous callers.
    const hidden = await hit(`/api/matches/${HIDDEN}/replay.json`, staffCookie);
    expect(hidden.headers.get('cache-control')).toBe('private, no-store');

    const shown = await hit(`/api/matches/${REVEALED}/replay.json`);
    expect(shown.headers.get('cache-control')).toBe('public, max-age=300');
  });

  test('NULL gate (off) publishes every week anonymously', async () => {
    setGate(null);
    try {
      const summary = await (await hit(`/api/matches/${HIDDEN}/replay-summary`)).json();
      expect(summary?.scoreLine).toBe('6-2');
      expect((await hit(`/api/matches/${HIDDEN}/replay.json`)).status).toBe(200);
    } finally {
      setGate(5);
    }
  });

  test('advancing the gate to 6 publishes the previously hidden week', async () => {
    setGate(6);
    try {
      const summary = await (await hit(`/api/matches/${HIDDEN}/replay-summary`)).json();
      expect(summary?.scoreLine).toBe('6-2');
      const mons = await (await hit(`/api/matches/${HIDDEN}/pokemon`)).json();
      expect(mons.home.length).toBe(1);
    } finally {
      setGate(5);
    }
  });
});
