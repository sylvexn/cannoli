/**
 * Playoff draft -> publish -> unpublish flow (routes/admin/playoffs.ts,
 * lib/playoff-publish.ts). A draft lives in playoff_drafts and never touches
 * `matches`, so every reader (public schedule, auto-forfeit, arena) is blind to it.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { and, eq, like } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { adminRoutes } from '../src/routes/admin';
import { standingsRoutes } from '../src/routes/leagues/standings';
import { matchRoutes } from '../src/routes/matches';
import { runAutoForfeit } from '../src/lib/jobs/auto-forfeit';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

const PFX = `pdraft-${Date.now()}`;
const LEAGUE = `${PFX}-lg`;
const SEASON_NUMBER = 9102;
const TEAMS = Array.from({ length: 8 }, (_, i) => `${PFX}-t${i}`);
const ORDER = TEAMS.slice(0, 6);
// Past-dated schedule so we can test the deadline block by flipping weekDates.
const FUTURE = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1), `2099-06-${String(1 + i * 7).padStart(2, '0')}`]));
const PAST = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1), `2020-06-${String(1 + i * 7).padStart(2, '0')}`]));

let app: Elysia;
let staffId: number;
let userId: number;
const coachIds: number[] = [];
let staffCookie: string;
let userCookie: string;

function call(method: string, path: string, body?: unknown, cookie: string | null = staffCookie): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return app.handle(new Request(`http://localhost${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }));
}
const base = `/api/admin/leagues/${LEAGUE}/playoffs`;
const putDraft = (topN = 6, seedOrder: string[] = TEAMS) => call('PUT', `${base}/draft`, { topN, seedOrder });
const bracket = () => db.select().from(schema.matches)
  .where(and(eq(schema.matches.leagueId, LEAGUE), eq(schema.matches.phase, 'playoffs'))).all();
const notifs = () => db.select().from(schema.notifications)
  .where(like(schema.notifications.dedupeKey, `playoffs-published:${LEAGUE}:%`)).all();
const setWeekDates = (d: Record<string, string>) =>
  db.update(schema.leagues).set({ weekDates: JSON.stringify(d) }).where(eq(schema.leagues.id, LEAGUE)).run();

async function reset() {
  const d = db.select().from(schema.playoffDrafts).where(eq(schema.playoffDrafts.leagueId, LEAGUE)).get();
  if (d?.status === 'published') await call('POST', `${base}/unpublish`);
  db.delete(schema.matches).where(and(eq(schema.matches.leagueId, LEAGUE), eq(schema.matches.phase, 'playoffs'))).run();
  db.delete(schema.playoffDrafts).where(eq(schema.playoffDrafts.leagueId, LEAGUE)).run();
  db.delete(schema.notifications).where(like(schema.notifications.dedupeKey, `playoffs-published:${LEAGUE}:%`)).run();
  setWeekDates(FUTURE);
}

beforeAll(() => {
  app = new Elysia()
    .derive(({ request }) => {
      const token = parseSessionToken(request.headers.get('cookie') ?? undefined);
      return { user: token ? validateSession(token) : null, sessionToken: token };
    })
    .use(adminRoutes).use(standingsRoutes).use(matchRoutes);

  const season = db.select().from(schema.seasons).where(eq(schema.seasons.seasonNumber, SEASON_NUMBER)).get()
    ?? db.insert(schema.seasons).values({ seasonNumber: SEASON_NUMBER, archived: false }).returning().get();
  const mk = (name: string, role: string) => db.insert(schema.users).values({
    username: `${PFX}-${name}`, passwordHash: 'x', role, mustChangePassword: false, active: true,
  }).returning().get().id;
  staffId = mk('admin', 'admin');
  userId = mk('user', 'user');
  staffCookie = `session=${createSession(staffId)}`;
  userCookie = `session=${createSession(userId)}`;
  // Teams 0-5 and 7 have coaches; t6 is vacant.
  for (let i = 0; i < 8; i++) coachIds.push(i === 6 ? 0 : mk(`coach${i}`, 'user'));

  db.insert(schema.leagues).values({
    id: LEAGUE, name: 'Draft Test', color: '#123456', seasonId: season.id, phase: 'playoffs',
    currentWeek: 7, totalWeeks: 7, playoffTeamCount: 6, weekDates: JSON.stringify(FUTURE),
  }).run();
  db.insert(schema.teams).values(TEAMS.map((id, i) => ({
    id, leagueId: LEAGUE, userId: i === 6 ? null : coachIds[i], coachName: `C${i}`,
    teamName: `Team ${i}`, teamAbbrev: `T${i}`, teamColor: '#111111',
  }))).run();
  let n = 0;
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    db.insert(schema.matches).values({
      id: `${PFX}-r${n++}`, leagueId: LEAGUE, week: ((i + j) % 7) + 1, homeTeamId: TEAMS[i], awayTeamId: TEAMS[j],
      homeScore: 6, awayScore: j % 5, status: 'completed', phase: 'regular', winnerTeamId: TEAMS[i],
    }).run();
  }
});

afterAll(() => {
  try {
    db.delete(schema.notifications).where(like(schema.notifications.dedupeKey, `playoffs-published:${LEAGUE}:%`)).run();
    for (const m of db.select({ id: schema.matches.id }).from(schema.matches).where(eq(schema.matches.leagueId, LEAGUE)).all()) {
      db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, m.id)).run();
    }
    db.delete(schema.matches).where(eq(schema.matches.leagueId, LEAGUE)).run();
    db.delete(schema.playoffDrafts).where(eq(schema.playoffDrafts.leagueId, LEAGUE)).run();
    db.delete(schema.activityLog).where(eq(schema.activityLog.leagueId, LEAGUE)).run();
    db.delete(schema.teams).where(eq(schema.teams.leagueId, LEAGUE)).run();
    db.delete(schema.leagues).where(eq(schema.leagues.id, LEAGUE)).run();
    for (const uid of [staffId, userId, ...coachIds.filter(Boolean)]) {
      db.delete(schema.notifications).where(eq(schema.notifications.userId, uid)).run();
      db.delete(schema.sessions).where(eq(schema.sessions.userId, uid)).run();
      db.delete(schema.users).where(eq(schema.users.id, uid)).run();
    }
    db.delete(schema.seasons).where(eq(schema.seasons.seasonNumber, SEASON_NUMBER)).run();
  } catch { /* best-effort cleanup */ }
});

describe('staff gating', () => {
  test('anonymous 401, plain user 403, on every endpoint', async () => {
    const calls: [string, string][] = [
      ['GET', `${base}/draft`], ['PUT', `${base}/draft`], ['DELETE', `${base}/draft`],
      ['POST', `${base}/publish`], ['POST', `${base}/unpublish`],
      ['GET', '/api/admin/playoffs/drafts/pending'], ['GET', '/api/admin/playoffs/overview'],
    ];
    for (const [m, p] of calls) {
      expect((await call(m, p, undefined, null)).status).toBe(401);
      expect((await call(m, p, undefined, userCookie)).status).toBe(403);
    }
  });
});

describe('draft is invisible', () => {
  test('saving a draft creates no matches; schedule + auto-forfeit never see it', async () => {
    await reset();
    setWeekDates(PAST); // would be overdue immediately if a match existed
    const res = await putDraft();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('draft');
    expect(bracket().length).toBe(0);

    runAutoForfeit();
    expect(bracket().length).toBe(0);
    const sched = await (await call('GET', `/api/leagues/${LEAGUE}/schedule`, undefined, null)).json();
    expect(sched.matches.filter((m: any) => m.phase === 'playoffs').length).toBe(0);

    const pending = await (await call('GET', '/api/admin/playoffs/drafts/pending')).json();
    expect(pending.drafts.find((d: any) => d.leagueId === LEAGUE)).toMatchObject({ leagueName: 'Draft Test', topN: 6 });
  });

  test('PUT validates size and seed order', async () => {
    for (const [n, o] of [[5, TEAMS], [6, TEAMS.slice(0, 5)], [6, [TEAMS[0], ...TEAMS.slice(0, 5)]], [6, [...TEAMS.slice(0, 5), 'nope']]] as [number, string[]][]) {
      expect((await putDraft(n, o)).status).toBe(400);
    }
  });
});

describe('publish', () => {
  test('creates matches and notifies qualified coaches only, once', async () => {
    await reset();
    // t7 hand-seeded #1; t0 cut.
    const order = [TEAMS[7], TEAMS[5], TEAMS[1], TEAMS[2], TEAMS[3], TEAMS[6], TEAMS[4], TEAMS[0]];
    await putDraft(6, order);
    const res = await call('POST', `${base}/publish`);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.matchCount).toBe(5);
    // t6 (seed 6) has no coach -> 5 notified
    expect(out.notified).toBe(5);
    expect(bracket().length).toBe(5);

    const rows = notifs();
    const byUser = new Map(rows.map(n => [n.userId, n]));
    expect(byUser.has(coachIds[7]!)).toBe(true);   // seed 1
    expect(byUser.has(coachIds[0]!)).toBe(false);  // cut
    expect(byUser.has(coachIds[3]!)).toBe(true);
    expect(byUser.has(coachIds[4]!)).toBe(false);  // seed 7
    expect(byUser.get(coachIds[7]!)!.title).toContain('#1 seed');
    expect(byUser.get(coachIds[7]!)!.body).toContain('bye');
    expect(byUser.get(coachIds[1]!)!.body).toContain('vs Team 6'); // seed 3 vs seed 6
    expect(byUser.get(coachIds[7]!)!.category).toBe('matches');

    // Re-publish is refused; no double notifications.
    expect((await call('POST', `${base}/publish`)).status).toBe(409);
    expect(notifs().length).toBe(5);
    // Draft edits refused while published
    expect((await putDraft(6, order)).status).toBe(409);
  });

  test('blocked after the first playoff week deadline', async () => {
    await reset();
    await putDraft();
    setWeekDates(PAST);
    const res = await call('POST', `${base}/publish`);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('deadline_passed');
    expect(bracket().length).toBe(0);
  });

  test('requires playoffs phase', async () => {
    await reset();
    await putDraft();
    db.update(schema.leagues).set({ phase: 'regular' }).where(eq(schema.leagues.id, LEAGUE)).run();
    expect((await call('POST', `${base}/publish`)).status).toBe(409);
    db.update(schema.leagues).set({ phase: 'playoffs' }).where(eq(schema.leagues.id, LEAGUE)).run();
  });
});

describe('unpublish', () => {
  test('before any result: removes matches, restores weekDates, deletes unread notifications only', async () => {
    await reset();
    await putDraft();
    await call('POST', `${base}/publish`);
    const published = db.select().from(schema.leagues).where(eq(schema.leagues.id, LEAGUE)).get()!.weekDates;
    expect(published).not.toBe(JSON.stringify(FUTURE)); // extended over playoff weeks
    // Coach 0 read theirs.
    db.update(schema.notifications).set({ readAt: new Date().toISOString() })
      .where(and(eq(schema.notifications.userId, coachIds[0]!), like(schema.notifications.dedupeKey, 'playoffs-published:%'))).run();

    const res = await call('POST', `${base}/unpublish`);
    expect(res.status).toBe(200);
    expect(bracket().length).toBe(0);
    expect(db.select().from(schema.leagues).where(eq(schema.leagues.id, LEAGUE)).get()!.weekDates).toBe(JSON.stringify(FUTURE));
    const left = notifs();
    expect(left.length).toBe(1);
    expect(left[0]!.userId).toBe(coachIds[0]!);
    const d = await (await call('GET', `${base}/draft`)).json();
    expect(d.status).toBe('draft');

    // Republish notifies again with a fresh key
    const again = await (await call('POST', `${base}/publish`)).json();
    expect(again.notified).toBe(6);
  });

  test('blocked once a playoff game has a result', async () => {
    await reset();
    await putDraft();
    await call('POST', `${base}/publish`);
    const qf = bracket().find(m => m.playoffRound === 'qf')!;
    db.update(schema.matches).set({ homeScore: 6, awayScore: 2, status: 'completed' }).where(eq(schema.matches.id, qf.id)).run();
    const res = await call('POST', `${base}/unpublish`);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('locked');
    expect(bracket().length).toBe(5);
    const d = await (await call('GET', `${base}/draft`)).json();
    expect(d.locked).toBe(true);
  });
});
