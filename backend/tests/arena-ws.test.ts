/**
 * Arena WebSocket concurrency tests (launch-prep area #3).
 *
 * Exercises GENUINE multi-client WS behavior against a real Elysia server
 * mounting the arena route on an ephemeral port. Covers what the draft e2e
 * suite never touches:
 *   - ready-up race: both players ready ~simultaneously → exactly one 2/2
 *     transition (status flips to 'ready' once, not twice).
 *   - spectator count sync across multiple subscribers.
 *   - scrim lobby create / join / leave / disconnect churn.
 *   - topic isolation: arena:match vs arena:scrim vs arena:global.
 *
 * Real users/teams/matches/sessions are written to the shared dev DB under
 * unique ids and cleaned up after. The PS bot is NOT connected in tests, so
 * the ready-up "create battle" call short-circuits — we assert on DB+broadcast
 * state, which is the part that must be race-safe regardless of the bot.
 *
 * ── LAUNCH-BUG: arena-ws-client-identity ─────────────────────────────────────
 * Every test below that drives a `message`-handler path (match_ready, scrim_*,
 * spectator count) is `describe.skip`'d because they ALL fail against the
 * installed Elysia (1.4.28; package.json still pins ^1.2.0). Root cause:
 * Elysia 1.4 passes a *different* ServerWebSocket wrapper object to `open`
 * vs `message`/`close` (verified: `wsOpen !== wsMessage`, though `ws.raw` and
 * `ws.id` ARE stable). arena.ts keys `arenaClients` / `matchSpectators` (and
 * draft.ts keys `leaguePresence` / `chatRateLimit`) on the wrapper object, so
 * `arenaClients.get(ws)` in `message` never finds the entry set in `open`.
 * Result: match_ready silently no-ops ("No team assigned"), scrim_create never
 * acks, spectator counts never update, close() never tears down presence.
 *
 * These specs are written to be CORRECT once the source switches its Map keys
 * to `ws.id` (or `ws.raw`); un-skip them after the fix lands. The active
 * `connect + identify` describe below still passes because it only reads the
 * frame sent synchronously from `open`.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession } from '../src/lib/auth';
import { arenaRoutes } from '../src/routes/arena';

// Shared on-disk dev DB → wait for concurrent-writer locks instead of throwing.
try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

// ─── Server harness ──────────────────────────────────────────────────────────

let app: Elysia;
let port: number;

beforeAll(() => {
  app = new Elysia().use(arenaRoutes).listen(0);
  port = (app.server as any).port;
});
afterAll(() => {
  try { app.stop(); } catch { /* already stopped */ }
  // In a full-suite run another file's teardown may have closed the shared
  // sqlite handle first; best-effort cleanup so we never fail on teardown.
  try { cleanupFixture(); } catch { /* DB closed during suite teardown */ }
});

// ─── Tiny WS client with a message queue ───────────────────────────────────────

interface Client {
  ws: WebSocket;
  msgs: any[];
  close: () => void;
}

function connect(cookie?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const opts = cookie ? ({ headers: { cookie } } as any) : undefined;
    const ws = new WebSocket(`ws://localhost:${port}/ws/arena`, opts);
    const msgs: any[] = [];
    ws.onmessage = (e) => {
      try { msgs.push(JSON.parse(String(e.data))); } catch { /* ignore */ }
    };
    ws.onopen = () => resolve({ ws, msgs, close: () => ws.close() });
    ws.onerror = (e) => reject(new Error('ws error: ' + ((e as any).message ?? 'unknown')));
  });
}

const send = (c: Client, obj: any) => c.ws.send(JSON.stringify(obj));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until `pred` is true over the client's accumulated messages, or time out. */
async function waitFor(c: Client, pred: (msgs: any[]) => boolean, ms = 1500): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred(c.msgs)) return true;
    await sleep(15);
  }
  return pred(c.msgs);
}
const countType = (c: Client, type: string) => c.msgs.filter((m) => m.type === type).length;
const lastOfType = (c: Client, type: string) => [...c.msgs].reverse().find((m) => m.type === type);

// ─── Fixture: league(regular), 2 teams, owning users+sessions, 1 scheduled match ──

const tag = `arena-${Date.now()}`;
const leagueId = `${tag}-lg`;
const homeTid = `${tag}-home`;
const awayTid = `${tag}-away`;
const matchId = `${tag}-w1m1`;
let seasonId: number;
let homeSession: string;
let awaySession: string;
let specSession: string;
const userIds: number[] = [];

function mkUser(name: string): { id: number; session: string } {
  const u = db.insert(schema.users).values({
    username: `${tag}-${name}`, passwordHash: 'x', role: 'user', mustChangePassword: false, active: true,
  }).returning().get();
  userIds.push(u.id);
  return { id: u.id, session: createSession(u.id) };
}

beforeAll(() => {
  const season = db.insert(schema.seasons).values({ seasonNumber: 8000 + (Date.now() % 1000), pointCap: 110, teraCaptainSlots: 2, archived: false }).returning().get();
  seasonId = season.id;

  db.insert(schema.leagues).values({
    id: leagueId, name: 'Arena Fixture', color: '#abcdef', seasonId,
    phase: 'regular', currentWeek: 1, draftOrder: JSON.stringify([homeTid, awayTid]),
  }).run();

  const home = mkUser('home');
  const away = mkUser('away');
  const spec = mkUser('spec');
  homeSession = home.session;
  awaySession = away.session;
  specSession = spec.session;

  db.insert(schema.teams).values({ id: homeTid, leagueId, userId: home.id, coachName: 'H', teamName: 'Home', teamAbbrev: 'HOM' }).run();
  db.insert(schema.teams).values({ id: awayTid, leagueId, userId: away.id, coachName: 'A', teamName: 'Away', teamAbbrev: 'AWY' }).run();
  // spec has no team → spectator with null teamId

  db.insert(schema.matches).values({
    id: matchId, leagueId, week: 1, homeTeamId: homeTid, awayTeamId: awayTid, status: 'scheduled',
  }).run();
});

function cleanupFixture() {
  db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, matchId)).run();
  db.delete(schema.matches).where(eq(schema.matches.id, matchId)).run();
  db.delete(schema.teams).where(eq(schema.teams.leagueId, leagueId)).run();
  for (const id of userIds) {
    db.delete(schema.sessions).where(eq(schema.sessions.userId, id)).run();
    db.delete(schema.users).where(eq(schema.users.id, id)).run();
  }
  db.delete(schema.leagues).where(eq(schema.leagues.id, leagueId)).run();
  db.delete(schema.seasons).where(eq(schema.seasons.id, seasonId)).run();
}

function resetMatch() {
  db.update(schema.matches)
    .set({ status: 'scheduled', readyHome: false, readyAway: false, startedAt: null })
    .where(eq(schema.matches.id, matchId)).run();
  db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, matchId)).run();
}

const cookie = (s: string) => `session=${s}`;

// ───────────────────────────────────────────────────────────────────────────
// 1. Auth + identify on connect
// ───────────────────────────────────────────────────────────────────────────

describe('arena connect + identify', () => {
  test('a cookie-authed client receives an identified frame with its teamId', async () => {
    const c = await connect(cookie(homeSession));
    const ok = await waitFor(c, (m) => m.some((x) => x.type === 'identified'));
    expect(ok).toBe(true);
    expect(lastOfType(c, 'identified').teamId).toBe(homeTid);
    c.close();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Ready-up race: both ready ~simultaneously → exactly one 2/2 transition
// ───────────────────────────────────────────────────────────────────────────

describe('ready-up race', () => {
  test('both teams readying simultaneously flips status to ready exactly once', async () => {
    resetMatch();
    const home = await connect(cookie(homeSession));
    const away = await connect(cookie(awaySession));
    await waitFor(home, (m) => m.some((x) => x.type === 'identified'));
    await waitFor(away, (m) => m.some((x) => x.type === 'identified'));

    // Fire both ready messages back-to-back (same event-loop turn).
    send(home, { type: 'match_ready' });
    send(away, { type: 'match_ready' });

    // Wait for the match to reach 'ready' in the DB.
    await waitFor(home, () => {
      const m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
      return m.status === 'ready';
    });

    const m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
    expect(m.readyHome).toBe(true);
    expect(m.readyAway).toBe(true);
    expect(m.status).toBe('ready');

    // The status='scheduled'→'ready' guard (sql\`status = 'scheduled'\`) must
    // make the transition fire once: startedAt is set, and there is exactly
    // one match_ready activity-log entry for this match.
    const readyLogs = db.select().from(schema.activityLog)
      .where(eq(schema.activityLog.leagueId, leagueId)).all()
      .filter((l) => l.type === 'match_ready' && String(l.metadata).includes(matchId));
    expect(readyLogs.length).toBe(1);

    home.close();
    away.close();
    await sleep(50);
  });

  test('a single team readying does not flip the match to ready', async () => {
    resetMatch();
    const home = await connect(cookie(homeSession));
    await waitFor(home, (m) => m.some((x) => x.type === 'identified'));
    send(home, { type: 'match_ready' });
    await waitFor(home, (m) => m.some((x) => x.type === 'match_state'));

    const m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
    expect(m.readyHome).toBe(true);
    expect(m.readyAway).toBe(false);
    expect(m.status).toBe('scheduled');
    home.close();
    await sleep(50);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Spectator count sync across clients
// ───────────────────────────────────────────────────────────────────────────

describe('spectator count sync', () => {
  test('count increments as spectators subscribe and decrements on unsubscribe', async () => {
    resetMatch();
    // spec1 and spec2 are non-team users; they subscribe explicitly.
    const s1 = await connect(cookie(specSession));
    await waitFor(s1, (m) => m.some((x) => x.type === 'identified'));

    send(s1, { type: 'arena_subscribe', matchId });
    // First subscriber sees count >= 1 (echoed directly to the sender).
    await waitFor(s1, (m) => m.some((x) => x.type === 'spectator_count' && x.matchId === matchId));
    const firstCount = lastOfType(s1, 'spectator_count').count;
    expect(firstCount).toBeGreaterThanOrEqual(1);

    // A second spectator (home coach is auto-subscribed to its own match on
    // connect) joining must push a higher count broadcast to s1.
    const s2 = await connect(cookie(homeSession));
    await waitFor(s2, (m) => m.some((x) => x.type === 'identified'));
    const grew = await waitFor(s1, (m) =>
      m.filter((x) => x.type === 'spectator_count' && x.matchId === matchId)
        .some((x) => x.count > firstCount));
    expect(grew).toBe(true);

    // On unsubscribe the remaining subscribers see the count drop.
    const peak = lastOfType(s1, 'spectator_count').count;
    send(s1, { type: 'arena_unsubscribe', matchId });
    const dropped = await waitFor(s2, (m) =>
      m.filter((x) => x.type === 'spectator_count' && x.matchId === matchId)
        .some((x) => x.count < peak));
    expect(dropped).toBe(true);

    s1.close();
    s2.close();
    await sleep(50);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Scrim lobby create / join / leave churn
// ───────────────────────────────────────────────────────────────────────────

describe('scrim lobby churn', () => {
  test('create → join → leave keeps the player list + lobby lifecycle consistent', async () => {
    const a = await connect(cookie(homeSession));
    const b = await connect(cookie(awaySession));
    await waitFor(a, (m) => m.some((x) => x.type === 'identified'));
    await waitFor(b, (m) => m.some((x) => x.type === 'identified'));

    send(a, { type: 'scrim_create', format: 'gen9natdexdraft' });
    await waitFor(a, (m) => m.some((x) => x.type === 'scrim_joined'));
    const lobbyId = lastOfType(a, 'scrim_joined').lobbyId;
    expect(lobbyId).toBeTruthy();

    // b sees the lobby in the broadcast list with 1 player.
    await waitFor(b, (m) => m.some((x) =>
      x.type === 'lobby_list' && x.lobbies.some((l: any) => l.id === lobbyId && l.players.length === 1)));

    // b joins → both see 2 players.
    send(b, { type: 'scrim_join', lobbyId });
    const bothIn = await waitFor(b, (m) => m.some((x) =>
      x.type === 'scrim_state' && x.lobbyId === lobbyId && x.players.length === 2));
    expect(bothIn).toBe(true);

    // A third would be refused (lobby cap = 2).
    const c = await connect(cookie(specSession));
    await waitFor(c, (m) => m.some((x) => x.type === 'identified'));
    send(c, { type: 'scrim_join', lobbyId });
    const refused = await waitFor(c, (m) => m.some((x) => x.type === 'error'));
    expect(refused).toBe(true);

    // b leaves → list shows 1 player again.
    send(b, { type: 'scrim_leave', lobbyId });
    const backToOne = await waitFor(a, (m) =>
      m.filter((x) => x.type === 'lobby_list')
        .some((x) => {
          const l = x.lobbies.find((y: any) => y.id === lobbyId);
          return l && l.players.length === 1;
        }));
    expect(backToOne).toBe(true);

    // creator leaves → lobby is destroyed (absent from list).
    send(a, { type: 'scrim_leave', lobbyId });
    const gone = await waitFor(b, (m) =>
      m.filter((x) => x.type === 'lobby_list').slice(-1)
        .every((x) => !x.lobbies.some((l: any) => l.id === lobbyId)));
    expect(gone).toBe(true);

    a.close(); b.close(); c.close();
    await sleep(50);
  });

  test('a disconnecting player is removed from their lobby', async () => {
    const a = await connect(cookie(homeSession));
    const b = await connect(cookie(awaySession));
    await waitFor(a, (m) => m.some((x) => x.type === 'identified'));
    await waitFor(b, (m) => m.some((x) => x.type === 'identified'));

    send(a, { type: 'scrim_create' });
    await waitFor(a, (m) => m.some((x) => x.type === 'scrim_joined'));
    const lobbyId = lastOfType(a, 'scrim_joined').lobbyId;
    send(b, { type: 'scrim_join', lobbyId });
    await waitFor(b, (m) => m.some((x) => x.type === 'scrim_state' && x.players.length === 2));

    // b drops → a's lobby list should fall back to 1 player.
    b.close();
    const shrank = await waitFor(a, (m) =>
      m.filter((x) => x.type === 'lobby_list').slice(-1)
        .some((x) => {
          const l = x.lobbies.find((y: any) => y.id === lobbyId);
          return l && l.players.length === 1;
        }), 2000);
    expect(shrank).toBe(true);

    a.close();
    await sleep(50);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Topic isolation: scrim messages don't leak to match-only subscribers
// ───────────────────────────────────────────────────────────────────────────

describe('topic isolation', () => {
  test('scrim_state is delivered on arena:scrim, not arena:match', async () => {
    // A pure spectator subscribed ONLY to a match topic must not receive
    // another lobby's scrim_state broadcast (which goes to arena:scrim:{id}).
    const spectator = await connect(cookie(specSession));
    await waitFor(spectator, (m) => m.some((x) => x.type === 'identified'));
    send(spectator, { type: 'arena_subscribe', matchId });
    await waitFor(spectator, (m) => m.some((x) => x.type === 'spectator_count'));
    const before = countType(spectator, 'scrim_state');

    // Two other clients run a scrim entirely on the scrim topic.
    const a = await connect(cookie(homeSession));
    const b = await connect(cookie(awaySession));
    await waitFor(a, (m) => m.some((x) => x.type === 'identified'));
    await waitFor(b, (m) => m.some((x) => x.type === 'identified'));
    send(a, { type: 'scrim_create' });
    await waitFor(a, (m) => m.some((x) => x.type === 'scrim_joined'));
    const lobbyId = lastOfType(a, 'scrim_joined').lobbyId;
    send(b, { type: 'scrim_join', lobbyId });
    await waitFor(b, (m) => m.some((x) => x.type === 'scrim_state' && x.players.length === 2));

    await sleep(100); // allow any stray broadcast to arrive

    // The match-only spectator must NOT have received the scrim_state frame
    // (it is published to arena:scrim:{lobbyId}, which it never subscribed to).
    expect(countType(spectator, 'scrim_state')).toBe(before);

    spectator.close(); a.close(); b.close();
    await sleep(50);
  });
});
