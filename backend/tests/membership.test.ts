/**
 * League-membership control API (add / move / remove coaches before draft).
 *
 * Mounts the real `adminRoutes` behind the same session-derive the production
 * root app uses, then exercises the membership handlers end-to-end against the
 * DB. Covers the data-integrity contract that makes "move a coach" safe:
 *   - the predraft / draft-not-started GATE (locked once draft starts / regular)
 *   - one-team-per-user-per-league invariant
 *   - MOVE relocates the team row in place AND reconciles draftOrder on BOTH
 *     leagues + clears the team's draftQueue
 *   - REMOVE cascades (draftQueue gone, dropped from draftOrder)
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { adminRoutes } from '../src/routes/admin';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

function buildApp() {
  return new Elysia()
    .derive(({ request }) => {
      const cookieHeader = request.headers.get('cookie') ?? undefined;
      const token = parseSessionToken(cookieHeader);
      const user = token ? validateSession(token) : null;
      return { user, sessionToken: token };
    })
    .use(adminRoutes);
}

const tag = `membership-${Date.now()}`;
const leagueA = `${tag}-a`;
const leagueB = `${tag}-b`;
const teamA = `${tag}-a-t1`;
let seasonId: number;
let staffSession: string;
let coach1: number;
let coach2: number;
const userIds: number[] = [];
let app: Elysia;

function mkUser(name: string, role: 'admin' | 'user'): number {
  const u = db.insert(schema.users).values({
    username: `${tag}-${name}`, passwordHash: 'x', role, mustChangePassword: false, active: true,
  }).returning().get();
  userIds.push(u.id);
  return u.id;
}

function hit(method: string, path: string, cookie?: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.handle(new Request(`http://localhost${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }));
}

const staffCookie = () => `session=${staffSession}`;

function getLeagueOrder(id: string): string[] {
  const row = db.select({ o: schema.leagues.draftOrder }).from(schema.leagues).where(eq(schema.leagues.id, id)).get();
  return row?.o ? JSON.parse(row.o) : [];
}

beforeAll(() => {
  app = buildApp();
  const staffId = mkUser('staff', 'admin');
  staffSession = createSession(staffId);
  coach1 = mkUser('coach1', 'user');
  coach2 = mkUser('coach2', 'user');

  seasonId = db.insert(schema.seasons).values({ seasonNumber: 990, archived: false }).returning().get().id;
  db.insert(schema.leagues).values([
    { id: leagueA, name: `${tag} A`, color: '#111', seasonId, phase: 'predraft', draftOrder: JSON.stringify([teamA]) },
    { id: leagueB, name: `${tag} B`, color: '#222', seasonId, phase: 'predraft', draftOrder: JSON.stringify([]) },
  ]).run();
  db.insert(schema.teams).values({
    id: teamA, leagueId: leagueA, userId: coach1,
    coachName: 'Coach One', teamName: 'Alpha', teamAbbrev: 'ALP', teamColor: '#111',
  }).run();
  // A queued auto-pick row that a MOVE must clear (destination pool differs).
  db.insert(schema.draftQueue).values({ leagueId: leagueA, teamId: teamA, position: 0, pokemonName: 'Pikachu' }).run();
});

afterAll(() => {
  try {
    db.delete(schema.draftQueue).where(eq(schema.draftQueue.leagueId, leagueA)).run();
    db.delete(schema.draftQueue).where(eq(schema.draftQueue.leagueId, leagueB)).run();
    db.delete(schema.draftState).where(eq(schema.draftState.leagueId, leagueA)).run();
    db.delete(schema.draftState).where(eq(schema.draftState.leagueId, leagueB)).run();
    db.delete(schema.teams).where(eq(schema.teams.leagueId, leagueA)).run();
    db.delete(schema.teams).where(eq(schema.teams.leagueId, leagueB)).run();
    db.delete(schema.leagues).where(eq(schema.leagues.id, leagueA)).run();
    db.delete(schema.leagues).where(eq(schema.leagues.id, leagueB)).run();
    db.delete(schema.seasons).where(eq(schema.seasons.id, seasonId)).run();
    for (const id of userIds) {
      db.delete(schema.sessions).where(eq(schema.sessions.userId, id)).run();
      db.delete(schema.users).where(eq(schema.users.id, id)).run();
    }
  } catch { /* DB may be closed during teardown */ }
});

describe('membership: add', () => {
  let addedTeamId: string;

  test('adds an existing coach to a league + appends to draftOrder', async () => {
    const res = await hit('POST', '/api/admin/membership/add', staffCookie(), {
      leagueId: leagueB, userId: coach2, teamName: 'Beta', teamAbbrev: 'BET', teamColor: '#222',
    });
    expect(res.status).toBe(200);
    addedTeamId = (await res.json()).id;
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, addedTeamId)).get();
    expect(team?.leagueId).toBe(leagueB);
    expect(team?.userId).toBe(coach2);
    expect(getLeagueOrder(leagueB)).toContain(addedTeamId);
  });

  test('rejects adding a coach who already has a team in that league', async () => {
    const res = await hit('POST', '/api/admin/membership/add', staffCookie(), {
      leagueId: leagueA, userId: coach1, teamName: 'Dup', teamAbbrev: 'DUP',
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('already_in_league');
  });

  test('rejects an unknown user (never auto-creates)', async () => {
    const res = await hit('POST', '/api/admin/membership/add', staffCookie(), {
      leagueId: leagueB, userId: 999999, teamName: 'Ghost', teamAbbrev: 'GHO',
    });
    expect(res.status).toBe(404);
  });
});

describe('membership: move', () => {
  test('relocates the team, reconciles both leagues, clears draftQueue', async () => {
    const res = await hit('POST', '/api/admin/membership/move', staffCookie(), {
      teamId: teamA, toLeagueId: leagueB,
    });
    expect(res.status).toBe(200);

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamA)).get();
    expect(team?.leagueId).toBe(leagueB);

    // draftOrder: dropped from A, appended to B
    expect(getLeagueOrder(leagueA)).not.toContain(teamA);
    expect(getLeagueOrder(leagueB)).toContain(teamA);

    // draftQueue for the moved team is cleared (destination pool may differ)
    const q = db.select().from(schema.draftQueue).where(eq(schema.draftQueue.teamId, teamA)).all();
    expect(q.length).toBe(0);
  });

  test('rejects moving into a league where the coach already has a team', async () => {
    // coach1's team is now in B; try moving it B→B is a no-op 400; instead
    // verify the same-league guard.
    const res = await hit('POST', '/api/admin/membership/move', staffCookie(), {
      teamId: teamA, toLeagueId: leagueB,
    });
    expect(res.status).toBe(400); // already in that league
  });
});

describe('membership: gate', () => {
  test('locks once the destination league leaves predraft/draft', async () => {
    db.update(schema.leagues).set({ phase: 'regular' }).where(eq(schema.leagues.id, leagueA)).run();
    const res = await hit('POST', '/api/admin/membership/move', staffCookie(), {
      teamId: teamA, toLeagueId: leagueA, // dest now 'regular'
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('membership_locked_phase');
    db.update(schema.leagues).set({ phase: 'predraft' }).where(eq(schema.leagues.id, leagueA)).run();
  });

  test('locks once the draft is in progress', async () => {
    db.insert(schema.draftState).values({ leagueId: leagueA, status: 'in_progress', currentPickIndex: 1 }).run();
    const res = await hit('POST', '/api/admin/membership/add', staffCookie(), {
      leagueId: leagueA, userId: coach2, teamName: 'Late', teamAbbrev: 'LAT',
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('membership_locked_draft');
    db.delete(schema.draftState).where(eq(schema.draftState.leagueId, leagueA)).run();
  });
});

describe('membership: remove', () => {
  test('deletes the team + clears draftQueue + drops from draftOrder', async () => {
    // teamA is in B now; seed a queue row to prove the cascade clears it.
    db.insert(schema.draftQueue).values({ leagueId: leagueB, teamId: teamA, position: 0, pokemonName: 'Snorlax' }).run();
    const res = await hit('DELETE', `/api/admin/membership/team/${teamA}`, staffCookie());
    expect(res.status).toBe(200);

    expect(db.select().from(schema.teams).where(eq(schema.teams.id, teamA)).get()).toBeUndefined();
    expect(db.select().from(schema.draftQueue).where(eq(schema.draftQueue.teamId, teamA)).all().length).toBe(0);
    expect(getLeagueOrder(leagueB)).not.toContain(teamA);
  });
});
