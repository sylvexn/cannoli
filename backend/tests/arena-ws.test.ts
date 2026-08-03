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
 * ── arena-ws-client-identity (FIXED) ─────────────────────────────────────────
 * Elysia 1.4 passes a *different* ServerWebSocket wrapper object to `open`
 * vs `message`/`close` (`wsOpen !== wsMessage`, though `ws.raw` and `ws.id`
 * ARE stable across all callbacks). arena.ts and draft.ts now key all
 * per-connection Maps on `wsKey(ws)` = `ws.raw` (see arena.ts:35-37), which is
 * stable for the connection lifetime. All describes below are active (no
 * `describe.skip`) and all 13 tests pass.
 */
import { describe, expect, test, beforeAll, afterAll, spyOn } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession } from '../src/lib/auth';
import { arenaRoutes, handleScrimBattleFailed } from '../src/routes/arena';
import * as psBot from '../src/lib/ps-bot';
import { toUserid } from '../src/lib/ps-login';

// The Arena now gates the "both ready → status='ready' + create battle"
// transition on bot connectivity (offline ⇒ match stays 'scheduled', flags
// kept, no timeout). The PS bot can't actually connect in tests, so force it
// "connected" — these specs assert the ready-up DB/broadcast transition, which
// only runs on the bot-online path. createBattle() then no-ops (no live socket).
beforeAll(() => {
  spyOn(psBot, 'isBotConnected').mockReturnValue(true);
});

// Shared on-disk dev DB → wait for concurrent-writer locks instead of throwing.
try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

// Server harness

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

// Tiny WS client with a message queue

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

// Fixture: league(regular), 2 teams, owning users+sessions, 1 scheduled match

const tag = `arena-${Date.now()}`;
const leagueId = `${tag}-lg`;
const homeTid = `${tag}-home`;
const awayTid = `${tag}-away`;
const matchId = `${tag}-w1m1`;
const matchId2 = `${tag}-w3m1`; // same two teams, a later week (within the 2-week lookahead)
const matchId3 = `${tag}-w5m1`; // beyond the lookahead window — must be hidden / unreadyable
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
  db.insert(schema.matches).values({
    id: matchId2, leagueId, week: 3, homeTeamId: homeTid, awayTeamId: awayTid, status: 'scheduled',
  }).run();
  db.insert(schema.matches).values({
    id: matchId3, leagueId, week: 5, homeTeamId: homeTid, awayTeamId: awayTid, status: 'scheduled',
  }).run();
});

function cleanupFixture() {
  db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, matchId)).run();
  db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, matchId2)).run();
  db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, matchId3)).run();
  db.delete(schema.matches).where(eq(schema.matches.leagueId, leagueId)).run();
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

/** Reset both the current-week and later-week fixtures to a clean scheduled state. */
function resetBoth() {
  db.update(schema.matches)
    .set({ status: 'scheduled', readyHome: false, readyAway: false, startedAt: null })
    .where(eq(schema.matches.leagueId, leagueId)).run();
  db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, matchId)).run();
  db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, matchId2)).run();
  db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, matchId3)).run();
}

const cookie = (s: string) => `session=${s}`;

// 1. Auth + identify on connect

describe('arena connect + identify', () => {
  test('a cookie-authed client receives an identified frame with its teamId', async () => {
    const c = await connect(cookie(homeSession));
    const ok = await waitFor(c, (m) => m.some((x) => x.type === 'identified'));
    expect(ok).toBe(true);
    expect(lastOfType(c, 'identified').teamId).toBe(homeTid);
    c.close();
  });
});

// 2. Ready-up race: both ready ~simultaneously → exactly one 2/2 transition

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

  // New robustness contract: when the bot is offline, both-ready must NOT flip
  // the match to 'ready' (which would strand it with no battle behind it).
  // Keep the ready flags so the bot-reconnect auto-resume can pick it up, and
  // surface a clear match_error to the readying client.
  test('bot offline → both ready keeps status scheduled, flags retained, match_error sent', async () => {
    const offline = spyOn(psBot, 'isBotConnected').mockReturnValue(false);
    try {
      resetMatch();
      const home = await connect(cookie(homeSession));
      const away = await connect(cookie(awaySession));
      await waitFor(home, (m) => m.some((x) => x.type === 'identified'));
      await waitFor(away, (m) => m.some((x) => x.type === 'identified'));

      send(home, { type: 'match_ready' });
      send(away, { type: 'match_ready' });

      // Whichever client lands in the both-ready branch (the second to ready)
      // receives the offline match_error. Order isn't deterministic, so accept
      // it on either socket.
      const hasError = (c: typeof home) =>
        c.msgs.some((x) => x.type === 'match_error' && x.matchId === matchId);
      await waitFor(away, () => hasError(home) || hasError(away));
      expect(hasError(home) || hasError(away)).toBe(true);

      const m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
      expect(m.readyHome).toBe(true);
      expect(m.readyAway).toBe(true);
      // Critical: NOT 'ready' — we never strand the match without a battle.
      expect(m.status).toBe('scheduled');
      expect(m.startedAt).toBeNull();

      home.close();
      away.close();
      await sleep(50);
    } finally {
      // Restore the suite-wide "connected" default for the remaining specs.
      offline.mockReturnValue(true);
    }
  });
});

// 2b. Invite-flow cleanup: unready cancels the pending PS invite room

describe('invite-flow unready cancels orphaned PS room', () => {
  // With the invite flow, a both-ready match has an invite room created
  // (psRoomId set) before either player picks a team. If a player unreadies
  // mid team-selection, the Arena must tear down that orphaned room via the
  // bot's cancelBattle and clear psRoomId so a later re-ready mints a fresh one.
  test('match_unready on a match with a psRoomId calls cancelBattle and clears psRoomId', async () => {
    resetMatch();
    // Simulate the post-ready state: an invite room exists but the battle has
    // not started (status still 'ready', psRoomId stamped by the bot PM).
    db.update(schema.matches)
      .set({ status: 'ready', readyHome: true, readyAway: true, psRoomId: 'battle-gen9natdexdraft-invite-1' })
      .where(eq(schema.matches.id, matchId)).run();

    const cancel = spyOn(psBot, 'cancelBattle').mockImplementation(() => {});
    try {
      const home = await connect(cookie(homeSession));
      await waitFor(home, (m) => m.some((x) => x.type === 'identified'));

      send(home, { type: 'match_unready' });
      await waitFor(home, (m) => m.some((x) => x.type === 'match_state' && x.matchId === matchId));

      expect(cancel).toHaveBeenCalledWith('battle-gen9natdexdraft-invite-1');

      const m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
      expect(m.psRoomId).toBeNull();
      expect(m.status).toBe('scheduled');
      expect(m.readyHome).toBe(false);

      home.close();
      await sleep(50);
    } finally {
      cancel.mockRestore();
    }
  });
});

// 3. Spectator count sync across clients

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

// 4. Scrim lobby create / join / leave churn

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

// 5. Topic isolation: scrim messages don't leak to match-only subscribers

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

// 6. Pick which week to battle (issue #15: early / make-up battles)

describe('pick battle week', () => {
  test('GET /api/arena/state lists weeks within the lookahead, current week flagged', async () => {
    resetBoth();
    const res = await fetch(`http://localhost:${port}/api/arena/state`, { headers: { cookie: cookie(homeSession) } });
    const data = await res.json();

    // currentWeek=1, lookahead=2 → weeks 1 and 3 are offered; week 5 is capped out.
    const weeks = data.myMatches.map((m: any) => m.week).sort((a: number, b: number) => a - b);
    expect(weeks).toEqual([1, 3]);
    expect(data.myMatches.some((m: any) => m.week === 5)).toBe(false);

    expect(data.myMatches.find((m: any) => m.week === 1).isCurrentWeek).toBe(true);
    expect(data.myMatches.find((m: any) => m.week === 3).isCurrentWeek).toBe(false);

    // myMatch (the sticky banner's single match) stays the current-week fixture.
    expect(data.myMatch.matchId).toBe(matchId);
  });

  test('match_ready with an explicit matchId readies THAT week, not the current one', async () => {
    resetBoth();
    const home = await connect(cookie(homeSession));
    await waitFor(home, (m) => m.some((x) => x.type === 'identified'));

    // Coach picks the week-3 fixture to play early.
    send(home, { type: 'match_ready', matchId: matchId2 });
    await waitFor(home, (m) => m.some((x) => x.type === 'match_state' && x.matchId === matchId2));

    const w3 = db.select().from(schema.matches).where(eq(schema.matches.id, matchId2)).get()!;
    const w1 = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
    expect(w3.readyHome).toBe(true);
    expect(w1.readyHome).toBe(false); // current-week match untouched

    home.close();
    await sleep(50);
  });

  test('both teams readying the same future-week match flips it to ready', async () => {
    resetBoth();
    const home = await connect(cookie(homeSession));
    const away = await connect(cookie(awaySession));
    await waitFor(home, (m) => m.some((x) => x.type === 'identified'));
    await waitFor(away, (m) => m.some((x) => x.type === 'identified'));

    send(home, { type: 'match_ready', matchId: matchId2 });
    send(away, { type: 'match_ready', matchId: matchId2 });

    await waitFor(home, () => {
      const m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId2)).get()!;
      return m.status === 'ready';
    });

    const w3 = db.select().from(schema.matches).where(eq(schema.matches.id, matchId2)).get()!;
    expect(w3.readyHome).toBe(true);
    expect(w3.readyAway).toBe(true);
    expect(w3.status).toBe('ready');
    // The current-week fixture must not have been dragged along.
    const w1 = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
    expect(w1.status).toBe('scheduled');

    home.close();
    away.close();
    await sleep(50);
  });

  test('match_ready for a match beyond the lookahead window is rejected', async () => {
    resetBoth();
    const home = await connect(cookie(homeSession));
    await waitFor(home, (m) => m.some((x) => x.type === 'identified'));

    // Week 5 is > currentWeek(1) + lookahead(2): the server must refuse it even
    // if a stale/crafted client names the matchId directly.
    send(home, { type: 'match_ready', matchId: matchId3 });
    const errored = await waitFor(home, (m) => m.some((x) => x.type === 'error' && /no match/i.test(x.message)));
    expect(errored).toBe(true);

    const w5 = db.select().from(schema.matches).where(eq(schema.matches.id, matchId3)).get()!;
    expect(w5.readyHome).toBe(false);

    home.close();
    await sleep(50);
  });

  test('match_ready with a matchId the team does not own is rejected', async () => {
    resetBoth();
    const home = await connect(cookie(homeSession));
    await waitFor(home, (m) => m.some((x) => x.type === 'identified'));

    send(home, { type: 'match_ready', matchId: 'no-such-match' });
    const errored = await waitFor(home, (m) => m.some((x) => x.type === 'error' && /no match/i.test(x.message)));
    expect(errored).toBe(true);

    const w1 = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
    const w3 = db.select().from(schema.matches).where(eq(schema.matches.id, matchId2)).get()!;
    expect(w1.readyHome).toBe(false);
    expect(w3.readyHome).toBe(false);

    home.close();
    await sleep(50);
  });
});

// 2b. Battle-create failure must NOT unready the coaches
//
// The PS plugin answers /cannoli-battle with `cannoli-battle-failed` when it
// can't find a player online. That used to revert the match AND clear both
// ready flags, so whoever readied second appeared to unready the pair — the
// live "only one person could ready up" report. The flags must survive so the
// match lands in the both-ready/'scheduled' state the Arena renders with a
// Retry start button.

describe('battle-create failure', () => {
  test('keeps both ready flags, reverts status and psRoomId', () => {
    resetMatch();
    db.update(schema.matches)
      .set({ status: 'ready', readyHome: true, readyAway: true, psRoomId: null, startedAt: new Date().toISOString() })
      .where(eq(schema.matches.id, matchId)).run();

    const homeUid = toUserid(`${tag}-home`);
    const awayUid = toUserid(`${tag}-away`);
    handleScrimBattleFailed(homeUid, awayUid, `Player not found or offline: ${awayUid}`);

    const m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
    expect(m.status).toBe('scheduled');
    expect(m.startedAt).toBeNull();
    expect(m.psRoomId).toBeNull();
    // The whole point: neither coach gets unreadied by the other's failure.
    expect(m.readyHome).toBe(true);
    expect(m.readyAway).toBe(true);
  });
});
