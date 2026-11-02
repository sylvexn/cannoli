/**
 * The sim control API must work on a season created later by an admin
 * (leagues in predraft, ruleset instance + teams, no draft order / schedule),
 * and degrade cleanly for unknown leagues. Runs in BEGIN..ROLLBACK on the
 * shared DB (same trick as season-lifecycle.test.ts).
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createInstance } from '../src/lib/ruleset-instances';
import { simRoutes } from '../src/routes/admin/sim';

const LID = 'simnewseason-league';
const prevMode = process.env.CANNOLI_MODE;
const app = new Elysia()
  .derive({ as: 'global' }, () => ({ user: { id: '1', username: 'tester', role: 'admin' } }))
  .use(simRoutes as any);

const post = async (path: string, body: unknown) => {
  const res = await app.handle(new Request(`http://localhost${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: res.status, json: (await res.json()) as any };
};

beforeAll(() => {
  process.env.CANNOLI_MODE = 'mock';
  sqlite.exec('BEGIN');
  const inst = createInstance('S9912 Sim', { legacy: { costFormat: 'natdexplus', pointCap: 110, rosterSize: 10, teraCaptainSlots: 2 } });
  const season = db.insert(schema.seasons).values({ seasonNumber: 9912, pointCap: 110, teraCaptainSlots: 2 }).returning().get();
  db.insert(schema.leagues).values({
    id: LID, name: 'Test', color: '#fff', seasonId: season.id, phase: 'predraft',
    currentWeek: 0, totalWeeks: 3, rosterSize: 10, rulesetId: inst.id,
    costFormat: inst.costFormat, playoffTeamCount: 4,
  }).run();
  for (let i = 1; i <= 4; i++) {
    db.insert(schema.teams).values({
      id: `${LID}-t${i}`, leagueId: LID, coachName: `c${i}`, teamName: `Team ${i}`, teamAbbrev: `T${i}`, teamColor: '#abc',
    }).run();
  }
});
afterAll(() => {
  sqlite.exec('ROLLBACK');
  if (prevMode === undefined) delete process.env.CANNOLI_MODE; else process.env.CANNOLI_MODE = prevMode;
});

describe('sim API on an admin-created season', () => {
  test('state lists the new predraft league', async () => {
    const res = await app.handle(new Request('http://localhost/api/admin/sim/state'));
    const j = (await res.json()) as any;
    expect(j.leagues.find((l: any) => l.id === LID).phase).toBe('predraft');
  });

  test('unknown league is a clean 404', async () => {
    expect((await post('/api/admin/sim/advance-week', { leagueId: 'nope' })).status).toBe(404);
    expect((await post('/api/admin/sim/draft/auto-complete', { leagueId: 'nope' })).status).toBe(404);
  });

  test('draft auto-complete then advance-week', async () => {
    const d = await post('/api/admin/sim/draft/auto-complete', { leagueId: LID });
    expect(d.json.ok).toBe(true);
    expect(d.json.picks).toBe(40);
    const a = await post('/api/admin/sim/advance-week', { leagueId: LID });
    expect(a.json.ok).toBe(true);
    expect(a.json.matchesPlayed).toBeGreaterThan(0);
    expect(a.json.weekBefore).toBe(1);
    expect(a.json.weekAfter).toBe(2);
    expect(db.select().from(schema.leagues).where(eq(schema.leagues.id, LID)).get()!.phase).toBe('regular');
  }, 60_000);
});
