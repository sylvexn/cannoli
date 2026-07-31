/**
 * Trigger-plumbing regression for POST /api/admin/matches/:matchId/force-result.
 *
 * Pre-fix, force-result set status='completed' but never called
 * runAutoAwards or advancePlayoffWinner — the admin's forfeit/dispute tool,
 * exactly the messiest, most Kingslayer-relevant matches, silently never
 * earned pins and never advanced playoff brackets. Two things are proven
 * here against the REAL mounted route (mirrors admin-auth-guard.test.ts's
 * harness):
 *
 *   1. A forced playoff result mints a per-match pin AND fills the next
 *      round's TBD slot.
 *   2. An award-helper throw (a real, unmocked FK-constraint failure — a
 *      team with a userId that doesn't reference a real user) does NOT roll
 *      back the match write. Every runAutoAwards call site now runs
 *      post-commit in a try/catch, so the request still returns success and
 *      the match row still shows the recorded result.
 *
 * Hermetic: each test runs inside BEGIN/ROLLBACK on the shared dev DB. tx()
 * (SAVEPOINT under the hood) nests cleanly inside it — see
 * auto-forfeit-outcomes.test.ts for the same pattern.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { adminRoutes } from '../src/routes/admin';

// Mirror the production root app's auth derivation so handlers see `user`.
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

const app = buildApp();
const tag = `tfr-${Date.now()}`;
const userIds: number[] = [];
let staffSession: string;
let coachUserId: number;

beforeAll(() => {
  const staff = db.insert(schema.users).values({
    username: `${tag}-staff`, passwordHash: 'x', role: 'admin', mustChangePassword: false, active: true,
  }).returning().get();
  userIds.push(staff.id);
  staffSession = createSession(staff.id);

  const coach = db.insert(schema.users).values({
    username: `${tag}-coach`, passwordHash: 'x', role: 'user', mustChangePassword: false, active: true,
  }).returning().get();
  userIds.push(coach.id);
  coachUserId = coach.id;
});

afterAll(() => {
  try {
    for (const id of userIds) {
      db.delete(schema.sessions).where(eq(schema.sessions.userId, id)).run();
      db.delete(schema.users).where(eq(schema.users.id, id)).run();
    }
  } catch { /* DB closed during suite teardown */ }
});

function forceResult(matchId: string, body: unknown): Promise<Response> {
  return app.handle(new Request(`http://localhost/api/admin/matches/${matchId}/force-result`, {
    method: 'POST',
    headers: { cookie: `session=${staffSession}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('force-result — awards pins and advances the playoff bracket', () => {
  test('a forced QF result mints Flawless and fills the SF slot', async () => {
    sqlite.exec('BEGIN');
    try {
      const PFX = `${tag}-a-`;
      const season = db.insert(schema.seasons).values({
        seasonNumber: 9901, pointCap: 110, teraCaptainSlots: 2, archived: false,
      }).returning().get();
      const leagueId = `${PFX}lg`;
      const teamA = `${PFX}A`; // owned — QF winner, gets Flawless
      const teamB = `${PFX}B`; // unowned — QF loser
      const teamC = `${PFX}C`; // unowned — already sits in the SF home slot

      db.insert(schema.leagues).values({
        id: leagueId, name: 'Force Result Test', color: '#123456',
        seasonId: season.id, phase: 'playoffs', currentWeek: 10,
        draftOrder: JSON.stringify([teamA, teamB, teamC]),
      }).run();

      for (const [id, name, userId] of [
        [teamA, 'Alpha', coachUserId], [teamB, 'Bravo', null], [teamC, 'Charlie', null],
      ] as const) {
        db.insert(schema.teams).values({
          id, leagueId, userId,
          coachName: name, teamName: name, teamAbbrev: name.slice(0, 3),
          teamColor: '#cccccc',
        }).run();
      }

      const qfMatchId = `${PFX}pqf1`;
      db.insert(schema.matches).values({
        id: qfMatchId, leagueId, week: 10,
        homeTeamId: teamA, awayTeamId: teamB,
        status: 'scheduled', phase: 'playoffs', playoffRound: 'qf',
        homeSeed: 3, awaySeed: 6,
      }).run();

      const sfMatchId = `${PFX}psf1`;
      db.insert(schema.matches).values({
        id: sfMatchId, leagueId, week: 11,
        homeTeamId: teamC, awayTeamId: null,
        status: 'scheduled', phase: 'playoffs', playoffRound: 'sf',
        homeSeed: 1, awaySeed: null,
      }).run();

      const res = await forceResult(qfMatchId, {
        homeScore: 6, awayScore: 0,
        pokemonData: [
          { teamId: teamA, pokemonName: 'Dragapult', kills: 6, deaths: 0 },
          { teamId: teamB, pokemonName: 'Pikachu', kills: 0, deaths: 6 },
        ],
      });
      expect(res.status).toBe(200);
      const resBody = await res.json() as { success: boolean };
      expect(resBody.success).toBe(true);

      // Match recorded.
      const qfAfter = db.select().from(schema.matches).where(eq(schema.matches.id, qfMatchId)).get()!;
      expect(qfAfter.status).toBe('completed');
      expect(qfAfter.winnerTeamId).toBe(teamA);

      // Bracket advanced — SF's away slot now holds the QF winner.
      const sfAfter = db.select().from(schema.matches).where(eq(schema.matches.id, sfMatchId)).get()!;
      expect(sfAfter.awayTeamId).toBe(teamA);

      // Flawless minted for team A's owner (0 deaths on a win).
      const pin = db.select().from(schema.pins)
        .where(eq(schema.pins.userId, coachUserId))
        .all()
        .find(p => p.pinDefId === 'flawless' && p.seasonId === season.id);
      expect(pin).toBeDefined();
      expect(pin!.awardedBy).toBeNull();
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });
});

describe('force-result — an award-helper throw does not roll back the match write', () => {
  test('a real FK-constraint failure inside runAutoAwards is swallowed; the match still commits', async () => {
    sqlite.exec('BEGIN');
    try {
      const PFX = `${tag}-b-`;
      const season = db.insert(schema.seasons).values({
        seasonNumber: 9902, pointCap: 110, teraCaptainSlots: 2, archived: false,
      }).returning().get();
      const leagueId = `${PFX}lg`;
      // teamA's userId points at no real user row. teams.userId carries no FK
      // constraint (comment in schema.ts: "null until auth system is built"),
      // but pins.userId DOES reference users.id — so awardFlawless's INSERT
      // OR IGNORE genuinely throws SQLITE_CONSTRAINT_FOREIGNKEY (verified:
      // OR IGNORE suppresses UNIQUE/CHECK conflicts, never FK violations).
      const teamA = `${PFX}A`;
      const teamB = `${PFX}B`;
      const GHOST_USER_ID = -1;

      db.insert(schema.leagues).values({
        id: leagueId, name: 'Force Result Throw Test', color: '#654321',
        seasonId: season.id, phase: 'regular', currentWeek: 5,
        draftOrder: JSON.stringify([teamA, teamB]),
      }).run();

      db.insert(schema.teams).values([
        { id: teamA, leagueId, userId: GHOST_USER_ID, coachName: 'Ghost', teamName: 'Ghost', teamAbbrev: 'GHO', teamColor: '#111111' },
        { id: teamB, leagueId, userId: null, coachName: 'Bravo', teamName: 'Bravo', teamAbbrev: 'BRV', teamColor: '#222222' },
      ]).run();

      const matchId = `${PFX}m1`;
      db.insert(schema.matches).values({
        id: matchId, leagueId, week: 5,
        homeTeamId: teamA, awayTeamId: teamB,
        status: 'scheduled', phase: 'regular',
      }).run();

      const res = await forceResult(matchId, {
        homeScore: 6, awayScore: 0,
        pokemonData: [
          { teamId: teamA, pokemonName: 'Dragapult', kills: 6, deaths: 0 },
          { teamId: teamB, pokemonName: 'Pikachu', kills: 0, deaths: 6 },
        ],
      });

      // The request must NOT 500 — the throw inside runAutoAwards is caught
      // and logged, not propagated.
      expect(res.status).toBe(200);
      const resBody = await res.json() as { success: boolean };
      expect(resBody.success).toBe(true);

      // And the match write itself must have landed despite the awards
      // helper blowing up afterward — this is the no-rollback proof.
      const after = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
      expect(after.status).toBe('completed');
      expect(after.homeScore).toBe(6);
      expect(after.awayScore).toBe(0);
      expect(after.winnerTeamId).toBe(teamA);

      // No pin exists for the ghost user (the insert that would have created
      // it is exactly what threw).
      const ghostPins = db.select().from(schema.pins).where(eq(schema.pins.userId, GHOST_USER_ID)).all();
      expect(ghostPins).toHaveLength(0);
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });
});
