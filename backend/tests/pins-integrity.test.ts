/**
 * Coverage for GET /api/users/:username/pins (routes/pins.ts). Original scope:
 *
 *   1. PATCH /api/admin/pins/:id now stamps source='manual' + awardedBy on
 *      any successful edit, so the override is durable against a minter
 *      re-run. Verified against the schema's documented contract (migration
 *      0069 / schema.ts:719: minters may only delete `source='auto'` rows) —
 *      not against the live lib/pins/** implementation, which is out of this
 *      file's ownership and covered by its own suite
 *      (auto-award-cleanup.test.ts).
 *   2. POST /api/admin/pins/award rejects hand-awarding an is_auto=1
 *      definition (the UI only hides the button client-side).
 *   3. POST /api/admin/pins/run-auto now honors the archived-season guard
 *      (previously the only pin mutation in the file without one).
 *   4. GET /api/users/:username/pins redacts match-revealing metadata
 *      (matchId/winnerRank/loserRank/scoreLine/kills/deaths) for non-staff
 *      viewers when the referenced match is beyond the league's
 *      resultsRevealedThrough gate — reusing lib/queries.ts's
 *      isMatchRevealed, the same helper routes/matches.ts uses (commit
 *      48d5124). Staff always see the full metadata.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq, and, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { pinRoutes } from '../src/routes/pins';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

const PFX = `pinint-${Date.now()}`;

function appAs(user: { id: string; username: string; role: string } | null) {
  return new Elysia()
    .derive(() => ({ user, sessionToken: user ? 'test-session' : null }))
    .use(pinRoutes);
}

function hit(
  user: { id: string; username: string; role: string } | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return appAs(user).handle(new Request(`http://localhost${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }));
}

let staffId: number;
let plainId: number;
let STAFF: { id: string; username: string; role: string };

beforeAll(() => {
  const staff = db.insert(schema.users).values({
    username: `${PFX}-admin`, passwordHash: 'x', role: 'admin',
    mustChangePassword: false, active: true,
  }).returning().get();
  staffId = staff.id;
  STAFF = { id: String(staffId), username: staff.username, role: 'admin' };

  const plain = db.insert(schema.users).values({
    username: `${PFX}-user`, passwordHash: 'x', role: 'user',
    mustChangePassword: false, active: true,
  }).returning().get();
  plainId = plain.id;
});

afterAll(() => {
  try {
    db.delete(schema.pins).where(sql`user_id IN (SELECT id FROM users WHERE username LIKE ${PFX + '%'})`).run();
    db.delete(schema.matchPokemon).where(sql`match_id LIKE ${PFX + '%'}`).run();
    db.delete(schema.matches).where(sql`id LIKE ${PFX + '%'}`).run();
    db.delete(schema.teams).where(sql`league_id LIKE ${PFX + '%'}`).run();
    db.delete(schema.leagues).where(sql`id LIKE ${PFX + '%'}`).run();
    db.delete(schema.seasons).where(sql`season_number >= 93000 AND season_number < 94000`).run();
    db.delete(schema.pinDefinitions).where(sql`id LIKE ${PFX + '%'}`).run();
    db.delete(schema.users).where(sql`username LIKE ${PFX + '%'}`).run();
  } catch { /* best-effort cleanup */ }
});

// Spoiler leak on the public pins listing

describe('GET /api/users/:username/pins — results-reveal redaction', () => {
  const leagueId = `${PFX}-lg-reveal`;
  const HIDDEN_MATCH = `${PFX}-m-hidden`;
  const REVEALED_MATCH = `${PFX}-m-revealed`;
  // Two distinct defs (not two rows of the same def) — the identity index is
  // (user, def, season, league), and this user earns each per-match pin once
  // per match in real usage, so two matches need two defs here.
  const defHidden = `${PFX}-def-kingslayer`;
  const defRevealed = `${PFX}-def-flawless`;
  let recipient: { id: number; username: string };

  beforeAll(() => {
    const season = db.insert(schema.seasons).values({ seasonNumber: 93003, archived: false }).returning().get();
    db.insert(schema.leagues).values({
      id: leagueId, name: 'Reveal Redaction League', color: '#0f0f0f',
      seasonId: season.id, phase: 'regular', currentWeek: 7, resultsRevealedThrough: 5,
    }).run();

    const home = `${PFX}-t-home`, away = `${PFX}-t-away`;
    db.insert(schema.teams).values([
      { id: home, leagueId, userId: null, coachName: 'Home', teamName: 'Home', teamAbbrev: 'HM', teamColor: '#111111' },
      { id: away, leagueId, userId: null, coachName: 'Away', teamName: 'Away', teamAbbrev: 'AW', teamColor: '#222222' },
    ]).run();

    db.insert(schema.matches).values([
      { id: HIDDEN_MATCH, leagueId, week: 6, homeTeamId: home, awayTeamId: away, homeScore: 6, awayScore: 0, status: 'completed', phase: 'regular' },
      { id: REVEALED_MATCH, leagueId, week: 5, homeTeamId: home, awayTeamId: away, homeScore: 6, awayScore: 1, status: 'completed', phase: 'regular' },
    ]).run();

    recipient = db.insert(schema.users).values({
      username: `${PFX}-spoiler-target`, passwordHash: 'x', role: 'user', mustChangePassword: false, active: true,
    }).returning().get();

    db.insert(schema.pinDefinitions).values([
      { id: defHidden, name: 'Test Kingslayer', description: '', iconName: 'Swords', color: '#fbbf24', category: 'week', isAuto: true },
      { id: defRevealed, name: 'Test Flawless', description: '', iconName: 'Shield', color: '#fbbf24', category: 'week', isAuto: true },
    ]).run();

    db.insert(schema.pins).values([
      {
        userId: recipient.id, pinDefId: defHidden, seasonId: season.id, leagueId, source: 'auto', awardedBy: null,
        metadata: JSON.stringify({
          matchId: HIDDEN_MATCH, winnerTeamId: home, loserTeamId: away, winnerRank: 4, loserRank: 1,
        }),
      },
      {
        userId: recipient.id, pinDefId: defRevealed, seasonId: season.id, leagueId, source: 'auto', awardedBy: null,
        metadata: JSON.stringify({
          matchId: REVEALED_MATCH, winnerTeamId: home, loserTeamId: away, winnerRank: 3, loserRank: 2,
        }),
      },
    ]).run();
  });

  test('anonymous caller: unrevealed-match pin is omitted entirely, revealed-match pin is untouched', async () => {
    const res = await hit(null, 'GET', `/api/users/${recipient.username}/pins`);
    expect(res.status).toBe(200);
    const rows = await res.json() as { pinDefId: string; metadata: Record<string, unknown> | null }[];

    // Stripping spoiler fields is not enough: the pin's own existence leaks the
    // result ("won Flawless in week 6" names the winner even with no scoreline),
    // so an unrevealed pin must not appear in the payload at all.
    expect(rows.find(r => r.pinDefId === defHidden)).toBeUndefined();

    const revealed = rows.find(r => r.pinDefId === defRevealed);
    expect(revealed).toBeTruthy();
    expect((revealed!.metadata as any).matchId).toBe(REVEALED_MATCH);
    expect((revealed!.metadata as any).winnerRank).toBe(3);
    expect((revealed!.metadata as any).loserRank).toBe(2);
  });

  test('the pin owner sees their own unrevealed pin — they played the match', async () => {
    const res = await hit(
      { id: String(recipient.id), username: recipient.username, role: 'user' },
      'GET', `/api/users/${recipient.username}/pins`,
    );
    expect(res.status).toBe(200);
    const rows = await res.json() as { pinDefId: string; metadata: Record<string, unknown> | null }[];
    const hidden = rows.find(r => r.pinDefId === defHidden);
    expect(hidden).toBeTruthy();
    expect((hidden!.metadata as any).matchId).toBe(HIDDEN_MATCH);
  });

  test('a different non-staff user does NOT see the unrevealed pin', async () => {
    const res = await hit(
      { id: '999998', username: `${PFX}-nosy`, role: 'user' },
      'GET', `/api/users/${recipient.username}/pins`,
    );
    expect(res.status).toBe(200);
    const rows = await res.json() as { pinDefId: string }[];
    expect(rows.find(r => r.pinDefId === defHidden)).toBeUndefined();
    expect(rows.find(r => r.pinDefId === defRevealed)).toBeTruthy();
  });

  test('staff caller sees full metadata for both matches', async () => {
    const res = await hit(STAFF, 'GET', `/api/users/${recipient.username}/pins`);
    expect(res.status).toBe(200);
    const rows = await res.json() as { pinDefId: string; metadata: Record<string, unknown> | null }[];

    const hidden = rows.find(r => r.pinDefId === defHidden);
    expect(hidden).toBeTruthy();
    expect((hidden!.metadata as any).matchId).toBe(HIDDEN_MATCH);
    expect((hidden!.metadata as any).winnerRank).toBe(4);
    expect((hidden!.metadata as any).loserRank).toBe(1);
  });
});
