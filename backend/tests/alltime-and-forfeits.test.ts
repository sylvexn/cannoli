/**
 * - /api/archive/all-time must not aggregate live (unarchived) season results for guests.
 * - Manual result entry can record a forfeit (forfeited_by + survivor as winner).
 * - Force-result forfeit of an already-played match drops its K/D rows (audited in the log).
 * Hermetic via BEGIN/ROLLBACK on the shared dev DB (same pattern as force-result-awards).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { adminRoutes } from '../src/routes/admin';
import { archiveDeepRoutes } from '../src/routes/archive';
import { recordMatchResult } from '../src/lib/match-service';

const app = new Elysia()
  .derive(({ request }) => {
    const token = parseSessionToken(request.headers.get('cookie') ?? undefined);
    return { user: token ? validateSession(token) : null, sessionToken: token };
  })
  .use(adminRoutes)
  .use(archiveDeepRoutes);

const tag = `adf-${Date.now()}`;
let staffId: number;
let staffSession: string;

beforeAll(() => {
  const staff = db.insert(schema.users).values({
    username: `${tag}-staff`, passwordHash: 'x', role: 'admin', mustChangePassword: false, active: true,
  }).returning().get();
  staffId = staff.id;
  staffSession = createSession(staff.id);
});
afterAll(() => {
  try {
    db.delete(schema.sessions).where(eq(schema.sessions.userId, staffId)).run();
    db.delete(schema.users).where(eq(schema.users.id, staffId)).run();
  } catch { /* DB closed */ }
});

function world(PFX: string, archived: boolean, seasonNumber: number) {
  const season = db.insert(schema.seasons).values({
    seasonNumber, pointCap: 110, teraCaptainSlots: 2, archived,
  }).returning().get();
  const leagueId = `${PFX}lg`;
  db.insert(schema.leagues).values({
    id: leagueId, name: 'T', color: '#123456', seasonId: season.id, phase: 'regular', currentWeek: 1,
    draftOrder: '[]',
  }).run();
  const [A, B] = [`${PFX}A`, `${PFX}B`];
  for (const id of [A, B]) {
    db.insert(schema.teams).values({
      id, leagueId, userId: null, coachName: id, teamName: id, teamAbbrev: 'TTT', teamColor: '#cccccc',
    }).run();
  }
  const matchId = `${PFX}m1`;
  db.insert(schema.matches).values({
    id: matchId, leagueId, week: 1, homeTeamId: A, awayTeamId: B, status: 'scheduled', phase: 'regular',
  }).run();
  return { leagueId, A, B, matchId };
}

const inTx = async (fn: () => Promise<void> | void) => {
  sqlite.exec('BEGIN');
  try { await fn(); } finally { sqlite.exec('ROLLBACK'); }
};

describe('all-time archive leak', () => {
  test('guest totals exclude live-season match_pokemon', () => inTx(async () => {
    const live = world(`${tag}-l-`, false, 9911);
    const old = world(`${tag}-o-`, true, 9910);
    const liveMon = `Live${tag}`, oldMon = `Old${tag}`;
    db.insert(schema.matchPokemon).values({ matchId: live.matchId, teamId: live.A, pokemonName: liveMon, kills: 999999, deaths: 0 }).run();
    db.insert(schema.matchPokemon).values({ matchId: old.matchId, teamId: old.A, pokemonName: oldMon, kills: 999998, deaths: 0 }).run();

    const guest = await (await app.handle(new Request('http://localhost/api/archive/all-time'))).json() as any;
    const names = guest.perPokemon.map((p: any) => p.pokemonName);
    expect(names).toContain(oldMon);
    expect(names).not.toContain(liveMon);

    const staff = await (await app.handle(new Request('http://localhost/api/archive/all-time', {
      headers: { cookie: `session=${staffSession}` },
    }))).json() as any;
    expect(staff.perPokemon.map((p: any) => p.pokemonName)).toContain(liveMon);
  }));
});

describe('manual result forfeits', () => {
  test('forfeitedBy sets the flag and the survivor wins regardless of score', () => inTx(() => {
    const w = world(`${tag}-f-`, false, 9912);
    const out = recordMatchResult(w.matchId, { homeScore: 0, awayScore: 3, forfeitedBy: 'away' }, 'test');
    expect(out.ok).toBe(true);
    const m = db.select().from(schema.matches).where(eq(schema.matches.id, w.matchId)).get()!;
    expect(m.forfeitedBy).toBe('away');
    expect(m.winnerTeamId).toBe(w.A);
  }));

  test('omitted forfeitedBy = played game (unchanged behaviour)', () => inTx(() => {
    const w = world(`${tag}-p-`, false, 9913);
    recordMatchResult(w.matchId, { homeScore: 0, awayScore: 3 }, 'test');
    const m = db.select().from(schema.matches).where(eq(schema.matches.id, w.matchId)).get()!;
    expect(m.forfeitedBy).toBeNull();
    expect(m.winnerTeamId).toBe(w.B);
  }));
});

describe('penalty forfeit of a played match', () => {
  test('force-result forfeit drops K/D rows; played overwrite keeps them', () => inTx(async () => {
    const w = world(`${tag}-k-`, false, 9914);
    db.update(schema.matches).set({ status: 'completed', homeScore: 6, awayScore: 2, winnerTeamId: w.A })
      .where(eq(schema.matches.id, w.matchId)).run();
    db.insert(schema.matchPokemon).values({ matchId: w.matchId, teamId: w.A, pokemonName: 'Zzmon', kills: 2, deaths: 0 }).run();
    const rows = () => db.select().from(schema.matchPokemon).where(eq(schema.matchPokemon.matchId, w.matchId)).all();
    expect(rows()).toHaveLength(1);

    const post = (body: unknown) => app.handle(new Request(`http://localhost/api/admin/matches/${w.matchId}/force-result`, {
      method: 'POST', headers: { cookie: `session=${staffSession}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    expect((await post({ homeScore: 6, awayScore: 2 })).status).toBe(200);
    expect(rows()).toHaveLength(1);

    expect((await post({ homeScore: 6, awayScore: 2, forfeitedBy: 'home' })).status).toBe(200);
    expect(rows()).toHaveLength(0);
    const log = db.select().from(schema.activityLog).where(eq(schema.activityLog.type, 'match_result_overwritten')).all()
      .filter(l => l.metadata?.includes(w.matchId));
    expect(log.some(l => l.metadata!.includes('Zzmon') && l.metadata!.includes('"kdDroppedByForfeit":true'))).toBe(true);
  }));
});
