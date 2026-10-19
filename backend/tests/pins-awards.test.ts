/**
 * Admin-curated awards: suggest (pure read, ties flagged, per-match lists,
 * unresolved instead of crash), bulk save (team holder, drafts, per-row
 * validation, co-winners, several per-match pins per team) and publish gating
 * (drafts hidden from public reads until published).
 *
 * Everything runs inside one BEGIN/ROLLBACK on the shared dev DB.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { pinRoutes } from '../src/routes/pins';
import { pinAwardRoutes } from '../src/routes/pins-awards';
import { archiveDeepRoutes } from '../src/routes/archive';
import { suggestAwards } from '../src/lib/pins/suggest';

const tag = `pa${Date.now() % 100000}`;
const L = `${tag}-lg`;     // league with per-Pokemon stats
const L2 = `${tag}-lg2`;   // league with scores only (S9-style: no match_pokemon)
const T = (n: string) => `${tag}-${n}`;
let STAFF: { id: string; username: string; role: string };
let seasonId: number;
let coachId: number;
const asUser = { current: null as null | { id: string; username: string; role: string } };

const app = new Elysia()
  .derive(() => ({ user: asUser.current, sessionToken: null }))
  .use(pinRoutes).use(pinAwardRoutes).use(archiveDeepRoutes);

async function call(method: string, path: string, body?: unknown) {
  const res = await app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }));
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

function mkMatch(id: string, league: string, week: number, home: string, away: string, hs: number, as: number,
  stats: [string, string, number, number][] = []) {
  db.insert(schema.matches).values({
    id: `${tag}-${id}`, leagueId: league, week, homeTeamId: home, awayTeamId: away,
    homeScore: hs, awayScore: as, status: 'completed', phase: 'regular',
    winnerTeamId: hs > as ? home : away,
  }).run();
  for (const [team, mon, k, d] of stats) {
    db.insert(schema.matchPokemon).values({ matchId: `${tag}-${id}`, teamId: team, pokemonName: mon, kills: k, deaths: d }).run();
  }
}

beforeAll(() => {
  sqlite.exec('BEGIN');
  const staff = db.insert(schema.users).values({
    username: `${tag}-staff`, passwordHash: 'x', role: 'admin', mustChangePassword: false, active: true,
  }).returning().get();
  STAFF = { id: String(staff.id), username: staff.username, role: 'admin' };
  coachId = db.insert(schema.users).values({
    username: `${tag}-coach`, passwordHash: 'x', role: 'user', mustChangePassword: false, active: true,
  }).returning().get().id;
  seasonId = db.insert(schema.seasons).values({
    seasonNumber: 9100 + (Date.now() % 800), pointCap: 110, teraCaptainSlots: 2, archived: false,
  }).returning().get().id;

  for (const id of [L, L2]) {
    db.insert(schema.leagues).values({
      id, name: id, color: '#123456', seasonId, phase: 'offseason', currentWeek: 5,
    }).run();
  }
  // A is coached; B, C, D are unlinked (they must still be able to hold awards).
  for (const [n, lg, uid] of [['A', L, coachId], ['B', L, null], ['C', L, null], ['D', L, null],
    ['X', L2, null], ['Y', L2, null]] as const) {
    db.insert(schema.teams).values({
      id: T(n), leagueId: lg, userId: uid, coachName: n, teamName: `Team ${n}`, teamAbbrev: n,
    }).run();
  }
  const roster = (team: string, mon: string, cost = 5) => db.insert(schema.rosters).values({
    teamId: T(team), pokemonName: mon, tier: cost, costAtDraft: cost,
  }).run();
  roster('A', 'Dragapult'); roster('A', 'Garchomp'); roster('C', 'Gholdengo'); roster('B', 'Pikachu');

  // A and C both end on 6 season KOs with equal deaths -> a Garchomp tie.
  mkMatch('m1', L, 1, T('A'), T('B'), 6, 0, [[T('A'), 'dragapult', 5, 0], [T('A'), 'Garchomp', 1, 0], [T('B'), 'Pikachu', 0, 6]]);
  mkMatch('m2', L, 1, T('C'), T('D'), 6, 2, [[T('C'), 'Gholdengo', 6, 0]]);
  mkMatch('m3', L, 2, T('A'), T('C'), 6, 0, [[T('A'), 'Dragapult', 1, 0], [T('C'), 'Gholdengo', 0, 0]]);
  mkMatch('s1', L2, 1, T('X'), T('Y'), 4, 2);
});

afterAll(() => { try { sqlite.exec('ROLLBACK'); } catch { /* already closed */ } });

describe('suggest', () => {
  test('flags a Garchomp tie, keeps canonical casing, lists every flawless match', () => {
    const out = suggestAwards(seasonId, L);
    const gar = out.suggestions.filter(s => s.pinDefId === 'garchomp');
    expect(gar.map(g => g.teamId).sort()).toEqual([T('A'), T('C')]);
    expect(gar.every(g => g.tie)).toBe(true);
    expect(gar.find(g => g.teamId === T('A'))!.pokemon).toBe('Dragapult');

    const flawless = out.suggestions.filter(s => s.pinDefId === 'flawless' && s.teamId === T('A'));
    expect(flawless.map(f => f.matchId).sort()).toEqual([`${tag}-m1`, `${tag}-m3`]);
    expect(out.unresolved.some(u => u.pinDefId === 'champion')).toBe(true);
  });

  test('a league with no per-Pokemon stats reports unresolved, never crashes', () => {
    const out = suggestAwards(seasonId, L2);
    const reasons = out.unresolved.filter(u => u.reason === 'no-stat-data').map(u => u.pinDefId);
    expect(reasons).toContain('garchomp');
    expect(reasons).toContain('flawless');
    expect(out.suggestions.some(s => s.pinDefId === 'cannoli')).toBe(true);
  });

  test('suggesting writes nothing', () => {
    suggestAwards(seasonId);
    expect(db.select().from(schema.pins).where(eq(schema.pins.seasonId, seasonId)).all()).toHaveLength(0);
  });
});

describe('bulk save + publish', () => {
  const save = (pinDefId: string, changes: unknown[]) =>
    call('POST', '/api/admin/pins/bulk', { seasonId, pinDefId, changes });

  test('non-staff is forbidden', async () => {
    asUser.current = { id: String(coachId), username: 'c', role: 'user' };
    expect((await save('garchomp', [])).status).toBe(403);
  });

  test('co-winners on an unlinked team are saved as unpublished drafts', async () => {
    asUser.current = STAFF;
    const r = await save('garchomp', [
      { op: 'award', teamId: T('A'), pokemon: 'dragapult', stats: { kills: 6 } },
      { op: 'award', teamId: T('C'), pokemon: 'gholdengo' },
    ]);
    expect(r.json).toMatchObject({ success: true, created: 2 });
    const rows = db.select().from(schema.pins).where(eq(schema.pins.pinDefId, 'garchomp')).all()
      .filter(p => p.seasonId === seasonId);
    expect(rows).toHaveLength(2);
    expect(rows.every(p => p.published === false && p.userId == null)).toBe(true);
    expect(JSON.parse(rows.find(p => p.teamId === T('A'))!.metadata!).pokemon).toBe('Dragapult');
  });

  test('row errors reject the whole batch and write nothing', async () => {
    const before = db.select().from(schema.pins).all().length;
    const r = await save('dragapult', [
      { op: 'award', teamId: T('A'), pokemon: 'Dragapult' },
      { op: 'award', teamId: T('B'), pokemon: 'Charizard' },
    ]);
    expect(r.status).toBe(422);
    expect(r.json.errors).toEqual([expect.objectContaining({ index: 1 })]);
    expect(db.select().from(schema.pins).all().length).toBe(before);
  });

  test('one team can hold several per-match pins; re-saving updates instead of duplicating', async () => {
    const changes = [
      { op: 'award', teamId: T('A'), matchId: `${tag}-m1`, stats: { scoreLine: '6-0' } },
      { op: 'award', teamId: T('A'), matchId: `${tag}-m3`, stats: { scoreLine: '6-0' } },
    ];
    expect((await save('flawless', changes)).json).toMatchObject({ created: 2 });
    expect((await save('flawless', changes)).json).toMatchObject({ created: 0, updated: 2 });
    const bad = await save('flawless', [{ op: 'award', teamId: T('A'), matchId: `${tag}-m2` }]);
    expect(bad.status).toBe(422);
  });

  test('drafts are hidden from public reads, visible to staff, public after publish', async () => {
    const userPins = () => call('GET', `/api/users/${tag}-coach/pins`);
    const archive = () => call('GET', `/api/archive/seasons/${seasonId}/awards`);

    const teamPins = () => call('GET', `/api/teams/${T('C')}/pins`);
    asUser.current = null;
    expect((await userPins()).json).toHaveLength(0);
    expect((await teamPins()).json).toHaveLength(0);
    expect((await archive()).json.pins).toHaveLength(0);

    asUser.current = STAFF;
    expect((await userPins()).json.length).toBe(3); // dragapult garchomp + 2 flawless, via team A
    expect((await archive()).json.pins.length).toBe(4); // + unlinked team C's

    expect((await call('POST', '/api/admin/pins/publish', { seasonId })).json).toMatchObject({ count: 4 });

    asUser.current = null;
    expect((await teamPins()).json).toHaveLength(1); // unlinked team, no coach profile needed
    const pub = await userPins();
    expect(pub.json).toHaveLength(3);
    expect(pub.json[0].seasonNumber).toBeGreaterThan(0);
    const arch = (await archive()).json.pins;
    expect(arch).toHaveLength(4);
    expect(arch.find((p: any) => p.teamId === T('C')).username).toBeNull();
  });

  test('revoke removes a pin', async () => {
    asUser.current = STAFF;
    const pin = db.select().from(schema.pins).where(eq(schema.pins.teamId, T('C'))).get()!;
    expect((await save('garchomp', [{ op: 'revoke', pinId: pin.id }])).json).toMatchObject({ revoked: 1 });
    expect(db.select().from(schema.pins).where(eq(schema.pins.id, pin.id)).get()).toBeUndefined();
  });
});
