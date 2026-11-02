/**
 * Draft rule gaps not covered by draft-engine / draft-timer / draft-idempotency /
 * draft-reconnect-pick tests: budget reserve, mega cap, duplicate dex, undo restoring
 * clock + paused flag, and the post-draft captain gate (phase advances to regular
 * only once every team locks captains).
 *
 * Already covered elsewhere (not repeated here): snake order mapping (draft-engine),
 * clientRequestId idempotency (draft-idempotency, draft-reconnect-pick), timer expiry ->
 * pause -> queue-aware auto-pick (draft-timer), undo of index/rosters/completed draft
 * (draft-timer), force-pick turn bypass (draft-timer).
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { teamRoutes } from '../src/routes/leagues/teams';
import { executePick, executeAutoPick, handleTimerExpiry, undoLastPick, validatePick } from '../src/lib/draft-engine';
import { getLeagueCostMap, invalidateCostCache } from '../src/lib/league-costs';
import { buildDraftFixture, pickByTier, secondsAgo, type DraftFixture } from './draft-fixture';

const fixtures: DraftFixture[] = [];
const extra: (() => void)[] = [];
function fx(opts?: Parameters<typeof buildDraftFixture>[0]): DraftFixture {
  const f = buildDraftFixture(opts);
  fixtures.push(f);
  return f;
}
afterEach(() => {
  while (extra.length) extra.pop()!();
  while (fixtures.length) {
    const f = fixtures.pop()!;
    db.delete(schema.matches).where(eq(schema.matches.leagueId, f.leagueId)).run();
    db.delete(schema.transactions).where(eq(schema.transactions.leagueId, f.leagueId)).run();
    db.delete(schema.activityLog).where(eq(schema.activityLog.leagueId, f.leagueId)).run();
    f.cleanup();
  }
});

const state = (id: string) => db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, id)).get()!;

/** Unbanned mons in the league's cost format, from the seeded reference table. */
function usable(leagueId: string) {
  const costs = getLeagueCostMap(leagueId);
  return db.select().from(schema.pokemon).all().filter(p => !(costs.get(p.name)?.banned ?? p.banned));
}

describe('budget reserve', () => {
  test('cannot spend points needed for the remaining slots (roster_reserve)', () => {
    // 2 teams x 4 rounds -> team0 picks at 0,3,4,7: after pick 0 it still owes 3 picks (>= 3pt).
    const f = fx({ teams: 2, rosterSize: 4, timerStartedAt: new Date() });
    db.update(schema.seasons).set({ pointCap: 10 }).where(eq(schema.seasons.id, f.seasonId)).run();
    const pool = usable(f.leagueId);
    const costs = getLeagueCostMap(f.leagueId);
    const tier = (n: string) => costs.get(n)?.tier ?? 0;
    const eight = pool.find(p => p.formCategory === 'base' && tier(p.name) === 8);
    const seven = pool.find(p => p.formCategory === 'base' && tier(p.name) === 7);
    if (!eight || !seven) return; // reference data lacks those tiers
    const bad = validatePick(eight.name, f.teamIds[0], f.leagueId);
    expect(bad.valid).toBe(false);
    expect(bad.code).toBe('roster_reserve');
    expect(validatePick(seven.name, f.teamIds[0], f.leagueId).valid).toBe(true);
  });
});

describe('roster legality', () => {
  test('second Mega on a team is rejected (mega_cap)', () => {
    const f = fx({ teams: 2, rosterSize: 10, timerStartedAt: new Date() });
    const megas = usable(f.leagueId).filter(p => p.formCategory === 'mega');
    const [a, b] = megas;
    expect(executePick(f.leagueId, a.name, f.teamIds[0], 't', { skipTurnCheck: true }).success).toBe(true);
    const r = executePick(f.leagueId, b.name, f.teamIds[0], 't', { skipTurnCheck: true });
    expect(r.success).toBe(false);
    expect((r as any).code).toBe('mega_cap');
    // another team may still take a Mega
    expect(validatePick(b.name, f.teamIds[1], f.leagueId).valid).toBe(true);
  });

  test('same National Dex number twice on one team is rejected (dup_natdex)', () => {
    // The reference data has no unbanned dex collisions, so insert two synthetic forms of one dex number.
    const f = fx({ teams: 2, rosterSize: 10, timerStartedAt: new Date() });
    const tag = `Dupdex${Date.now()}`;
    const row = (n: string) => ({
      name: n, type1: 'Normal', hp: 50, atk: 50, def: 50, spa: 50, spd: 50, spe: 50,
      tier: 1, nationalDexNumber: 99000 + (Date.now() % 900), formCategory: 'base' as const,
    });
    const a = row(`${tag}A`);
    const b = { ...row(`${tag}B`), nationalDexNumber: a.nationalDexNumber };
    db.insert(schema.pokemon).values([a, b] as any).run();
    extra.push(() => db.delete(schema.pokemon).where(inArray(schema.pokemon.name, [a.name, b.name])).run());
    invalidateCostCache();
    extra.push(() => invalidateCostCache());

    expect(executePick(f.leagueId, a.name, f.teamIds[0], 't', { skipTurnCheck: true }).success).toBe(true);
    const v = validatePick(b.name, f.teamIds[0], f.leagueId);
    expect(v.valid).toBe(false);
    expect(v.code).toBe('dup_natdex');
    expect(validatePick(b.name, f.teamIds[1], f.leagueId).valid).toBe(true);
  });
});

describe('undo restores clock and clears the pause flag', () => {
  test('timer expiry -> auto-pick -> undo leaves an in_progress draft with a fresh clock', () => {
    const f = fx({ teams: 4, timerDuration: 30, timerStartedAt: secondsAgo(120) });
    const expired = handleTimerExpiry(f.leagueId);
    expect(expired?.paused).toBe(true);
    expect(state(f.leagueId).status).toBe('paused');
    expect(executeAutoPick(f.leagueId, 'admin').success).toBe(true);

    const undo = undoLastPick(f.leagueId, 'admin');
    expect(undo.success).toBe(true);
    const s = state(f.leagueId);
    expect(s.status).toBe('in_progress');
    expect(s.currentPickIndex).toBe(0);
    expect(s.timerExpiredForTeam).toBeNull();
    expect(Date.now() - new Date(s.timerStartedAt!).getTime()).toBeLessThan(5000);
  });
});

describe('captain gate', () => {
  const app = new Elysia()
    .derive(({ request }) => {
      const token = parseSessionToken(request.headers.get('cookie') ?? undefined);
      return { user: token ? validateSession(token) : null, sessionToken: token };
    })
    .use(teamRoutes);

  test('phase advances to regular only when every team has locked captains', async () => {
    const f = fx({ teams: 2, rosterSize: 2, teraCaptainSlots: 1, timerStartedAt: new Date() });
    const staff = db.insert(schema.users).values({
      username: `gate-${Date.now()}`, passwordHash: 'x', role: 'admin', mustChangePassword: false, active: true,
    }).returning().get();
    const session = createSession(staff.id);
    extra.push(() => {
      db.delete(schema.sessions).where(eq(schema.sessions.userId, staff.id)).run();
      db.delete(schema.users).where(inArray(schema.users.id, [staff.id])).run();
    });

    // Complete the draft: 2 teams x 2 rounds, cheap distinct mons.
    const picks = [1, 1, 1, 1].reduce<string[]>((acc, t) => [...acc, pickByTier(t, acc)], []);
    const order = [f.teamIds[0], f.teamIds[1], f.teamIds[1], f.teamIds[0]];
    order.forEach((tid, i) => expect(executePick(f.leagueId, picks[i], tid, 't').success).toBe(true));
    expect(state(f.leagueId).status).toBe('completed');
    expect(db.select().from(schema.leagues).where(eq(schema.leagues.id, f.leagueId)).get()!.phase).toBe('draft');

    const lock = (teamId: string, mon: string) => app.handle(new Request(`http://localhost/api/teams/${teamId}/tera-captains`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: `session=${session}` },
      body: JSON.stringify({ captains: [{ pokemonName: mon, teraTypes: ['Fire'] }] }),
    }));
    const phase = () => db.select().from(schema.leagues).where(eq(schema.leagues.id, f.leagueId)).get()!.phase;

    const r0 = await (await lock(f.teamIds[0], picks[0])).json() as any;
    expect(r0).toMatchObject({ success: true, captainsLocked: true, phaseAdvanced: false });
    expect(phase()).toBe('draft');

    const r1 = await (await lock(f.teamIds[1], picks[1])).json() as any;
    expect(r1).toMatchObject({ success: true, captainsLocked: true, phaseAdvanced: true });
    expect(phase()).toBe('regular');
  });
});

describe('auto-pick vs captain reserve', () => {
  // Regression: getAutoPick sized its budget from the CURRENT roster's captain markup, but
  // validatePick checks the roster INCLUDING the incoming mon. A tier-9 candidate (+3 markup)
  // looked affordable, then was refused, leaving the paused draft stuck.
  test('auto-pick never selects a mon the validator would refuse for captain headroom', () => {
    const f = fx({ teams: 2, rosterSize: 3, teraCaptainSlots: 1, timerStartedAt: new Date() });
    db.update(schema.seasons).set({ pointCap: 16 }).where(eq(schema.seasons.id, f.seasonId)).run();
    const [t0, t1] = f.teamIds;
    expect(executePick(f.leagueId, pickByTier(5), t0, 't').success).toBe(true);
    expect(executePick(f.leagueId, pickByTier(1), t1, 't').success).toBe(true);
    expect(executePick(f.leagueId, pickByTier(2), t1, 't').success).toBe(true);

    db.update(schema.draftState).set({ timerStartedAt: secondsAgo(500).toISOString() }).where(eq(schema.draftState.leagueId, f.leagueId)).run();
    expect(handleTimerExpiry(f.leagueId)?.paused).toBe(true);
    expect(executeAutoPick(f.leagueId, 'admin')?.success).toBe(true);
  });
});
