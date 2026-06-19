/**
 * PS Monitor Bot resilience tests (Showdown area #1/#2).
 *
 * These exercise the bot's *exported* surface and the protocol-parsing
 * contract it depends on, using a REAL battle log captured from the Cannoli
 * PS server fork (`test/fixtures/replays/live-ps-server-natdexdraft-forfeit.log`,
 * a genuine `[Gen 9] NatDex Draft` forfeit). The DB-writing handlers
 * (`handleMatchEnd`, `checkForOfficialMatch`, `replayFromDisk`) are module-
 * private, so the end-to-end DB write is covered by the live bring-up
 * documented in the findings; here we lock the parts that are unit-testable
 * without booting the in-process bot socket.
 *
 * Covered:
 *   - disk-replay fallback file resolution across date dirs, newest-first
 *   - disk-replay JSON whose `log` is missing / malformed → null (no throw)
 *   - the bot's room-prefix stripping + |win| detection against a REAL log
 *   - homeSide orientation math (the documented "half of matches swapped" bug)
 *     reproduced as a pure function, both p1-home and p2-home
 *   - unmatched-battle detection: a battle between userids not in the team map
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { formatFromRoomId, readReplayLogFromDisk, sweepIdleBattles, getMonitoredBattlesForTest, sendToPs, getSendQueueForTest } from '../src/lib/ps-bot';
import { ReplayParser } from '../src/lib/replay-parser';
import { toUserid } from '../src/lib/ps-login';

const REAL_LOG = readFileSync(
  resolve(import.meta.dir, '../test/fixtures/replays/live-ps-server-natdexdraft-forfeit.log'),
  'utf-8',
).split('\n');

// ─── Disk-replay fallback: cases not in disk-replay-fallback.test.ts ─────────

describe('readReplayLogFromDisk — additional edge cases', () => {
  let root: string;
  const ROOM = 'battle-gen9natdexdraft-555';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cannoli-bot-resilience-'));
    // Two date dirs, both containing the SAME room id with different contents.
    // The scanner sorts dates reverse (newest first) and must pick the newest.
    const older = join(root, 'gen9natdexdraft', '2026-01-01');
    const newer = join(root, 'gen9natdexdraft', '2026-12-31');
    mkdirSync(older, { recursive: true });
    mkdirSync(newer, { recursive: true });
    writeFileSync(join(older, `${ROOM}.log.json`), JSON.stringify({ log: ['|win|olderversion'] }));
    writeFileSync(join(newer, `${ROOM}.log.json`), JSON.stringify({ log: ['|win|newerversion'] }));
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('picks the newest date dir when the room exists in several', () => {
    const lines = readReplayLogFromDisk(ROOM, root);
    expect(lines).toEqual(['|win|newerversion']);
  });

  test('returns null (no throw) when JSON has no `log` array', () => {
    const bad = mkdtempSync(join(tmpdir(), 'cannoli-bad-json-'));
    const dir = join(bad, 'gen9natdexdraft', '2026-05-01');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'battle-gen9natdexdraft-1.log.json'), JSON.stringify({ players: ['a', 'b'] }));
    expect(readReplayLogFromDisk('battle-gen9natdexdraft-1', bad)).toBeNull();
    rmSync(bad, { recursive: true, force: true });
  });

  test('returns null (no throw) on unparseable JSON', () => {
    const bad = mkdtempSync(join(tmpdir(), 'cannoli-broken-json-'));
    const dir = join(bad, 'gen9natdexdraft', '2026-05-01');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'battle-gen9natdexdraft-2.log.json'), '{not valid json');
    expect(readReplayLogFromDisk('battle-gen9natdexdraft-2', bad)).toBeNull();
    rmSync(bad, { recursive: true, force: true });
  });
});

describe('formatFromRoomId — drives the disk-replay format-dir lookup', () => {
  test('real captured room id resolves to gen9natdexdraft', () => {
    // The fixture battle ran in battle-gen9natdexdraft-1.
    expect(formatFromRoomId('battle-gen9natdexdraft-1')).toBe('gen9natdexdraft');
  });
});

// ─── Real-log: the bot's handleMessage room-prefix + |win| contract ──────────

describe('bot message framing against a REAL PS server log', () => {
  // Mirror handleMessage: a chunk begins with ">battle-..." then the room's
  // lines follow until the next ">" prefix. The bot strips the prefix and
  // routes the remainder to handleBattleLine. We assert the parser — fed the
  // same lines the bot feeds — recovers the result from genuine protocol.
  test('parser recovers winner/format/score from the captured forfeit', () => {
    const parser = new ReplayParser();
    let sawWin = false;
    for (const raw of REAL_LOG) {
      // handleMessage strips a leading ">room" line entirely; feedLine also
      // ignores lines starting with ">". Either way the parser never sees it.
      parser.feedLine(raw);
      if (raw.startsWith('|win|')) sawWin = true;
    }
    expect(sawWin).toBe(true);
    const r = parser.getResult();
    expect(r.format).toBe('[Gen 9] NatDex Draft');
    expect(r.players.p1).toBe('TestAlice');
    expect(r.players.p2).toBe('TestBob');
    expect(r.winner).toBe('TestAlice');
  });

  test('forfeit with full teams yields a non-sweep score (LAUNCH NOTE)', () => {
    // Both players had 2 mons alive at forfeit, so the score is 2-2. This is
    // the parser's "brought - deaths" model; a forfeit/disconnect does NOT
    // count as a 6-0. The bot writes this verbatim. Flagged as a launch
    // semantics concern (see findings: forfeit scoring).
    const r = ReplayParser.parse(REAL_LOG.join('\n'));
    expect(r.winnerScore).toBe(2);
    expect(r.loserScore).toBe(2);
  });

  test('|win| arrives AFTER a |-message| forfeit line (ordering the bot must tolerate)', () => {
    const msgIdx = REAL_LOG.findIndex(l => l.startsWith('|-message|') && l.includes('forfeited'));
    const winIdx = REAL_LOG.findIndex(l => l.startsWith('|win|'));
    expect(msgIdx).toBeGreaterThan(-1);
    expect(winIdx).toBeGreaterThan(msgIdx);
  });
});

// ─── homeSide orientation math (the "half of matches swapped" bug) ───────────

describe('home/away orientation resolution (pure model of the bot path)', () => {
  // Mirrors checkForOfficialMatch / handleMatchEnd orientation logic:
  //   battle.homeSide = team(p1)==home ? 'p1' : team(p2)==home ? 'p2' : null
  // and the score swap that follows. Pure here so it is testable without the
  // private handlers.
  function resolveHomeSide(
    p1Userid: string, p2Userid: string,
    map: Map<string, string>, homeTeamId: string,
  ): 'p1' | 'p2' | null {
    if (map.get(p1Userid) === homeTeamId) return 'p1';
    if (map.get(p2Userid) === homeTeamId) return 'p2';
    return null;
  }

  function homeWon(homeSide: 'p1' | 'p2', winnerUserid: string, p1: string, p2: string): boolean {
    return homeSide === 'p1' ? winnerUserid === p1 : winnerUserid === p2;
  }

  const map = new Map<string, string>([
    [toUserid('Alice'), 'team-home'],
    [toUserid('Bob'), 'team-away'],
  ]);

  test('home challenged → home is p1', () => {
    const side = resolveHomeSide(toUserid('Alice'), toUserid('Bob'), map, 'team-home');
    expect(side).toBe('p1');
    expect(homeWon(side!, toUserid('Alice'), toUserid('Alice'), toUserid('Bob'))).toBe(true);
  });

  test('away challenged → home lands on p2 (the swap case)', () => {
    // PS put Alice (home) on p2 because Bob challenged. Without orientation
    // resolution the bot would treat p1=home and invert the score.
    const side = resolveHomeSide(toUserid('Bob'), toUserid('Alice'), map, 'team-home');
    expect(side).toBe('p2');
    // Alice (home) won as p2 → homeWon must be true.
    expect(homeWon(side!, toUserid('Alice'), toUserid('Bob'), toUserid('Alice'))).toBe(true);
    // And if Bob (away, p1) won, homeWon is false.
    expect(homeWon(side!, toUserid('Bob'), toUserid('Bob'), toUserid('Alice'))).toBe(false);
  });

  test('neither player maps to home team → null (bot defers / logs unmatched)', () => {
    const side = resolveHomeSide(toUserid('Stranger1'), toUserid('Stranger2'), map, 'team-home');
    expect(side).toBeNull();
  });
});

// ─── Idle-battle eviction ────────────────────────────────────────────────────

describe('sweepIdleBattles — evicts stale entries, retains fresh ones', () => {
  const map = getMonitoredBattlesForTest();

  // Helper: insert a synthetic MonitoredBattle at a given age.
  function addFakeEntry(roomId: string, matchId: string | null, ageMs: number) {
    map.set(roomId, {
      roomId,
      matchId,
      p1: 'alice',
      p2: 'bob',
      format: 'gen9natdexdraft',
      parser: new ReplayParser(),
      lines: [],
      isOfficial: matchId !== null,
      homeSide: null,
      lastLineAt: Date.now() - ageMs,
      joinedSides: new Set(),
    } as Parameters<typeof map.set>[1]);
  }

  test('evicts an entry idle for longer than maxIdleMs', () => {
    const room = 'battle-gen9natdexdraft-sweep-old';
    addFakeEntry(room, null, 35 * 60 * 1000); // 35 min old
    const evicted = sweepIdleBattles(Date.now(), 30 * 60 * 1000);
    expect(evicted).toBeGreaterThanOrEqual(1);
    expect(map.has(room)).toBe(false);
  });

  test('retains an entry that is still fresh', () => {
    const room = 'battle-gen9natdexdraft-sweep-fresh';
    addFakeEntry(room, null, 5 * 60 * 1000); // 5 min old
    sweepIdleBattles(Date.now(), 30 * 60 * 1000);
    expect(map.has(room)).toBe(true);
    map.delete(room); // cleanup
  });

  test('evicts idle scrim (matchId:null) but not a fresh official (matchId set)', () => {
    const stale = 'battle-gen9natdexdraft-stale-scrim';
    const fresh = 'battle-gen9natdexdraft-fresh-official';
    addFakeEntry(stale, null, 60 * 60 * 1000); // 1hr old scrim
    addFakeEntry(fresh, 'match-abc', 1 * 60 * 1000); // 1min old official
    sweepIdleBattles(Date.now(), 30 * 60 * 1000);
    expect(map.has(stale)).toBe(false);
    expect(map.has(fresh)).toBe(true);
    map.delete(fresh); // cleanup
  });

  test('synthetic now: evicts entry idle relative to provided now value', () => {
    const room = 'battle-gen9natdexdraft-synthetic-now';
    const anchorMs = 1_000_000_000; // arbitrary epoch
    map.set(room, {
      roomId: room,
      matchId: null,
      p1: 'x',
      p2: 'y',
      format: '',
      parser: new ReplayParser(),
      lines: [],
      isOfficial: false,
      homeSide: null,
      // lastLineAt is 45 min before our synthetic now
      lastLineAt: anchorMs - 45 * 60 * 1000,
      joinedSides: new Set(),
    } as Parameters<typeof map.set>[1]);
    const evicted = sweepIdleBattles(anchorMs, 30 * 60 * 1000);
    expect(evicted).toBeGreaterThanOrEqual(1);
    expect(map.has(room)).toBe(false);
  });
});

// ─── Unmatched-battle detection ──────────────────────────────────────────────

describe('unmatched-battle classification (checkForOfficialMatch gate)', () => {
  // The bot logs an activity_log `bot_unmatched_battle` only when BOTH players
  // are unknown AND the format looks like a Cannoli draft format (contains
  // 'draft') OR is empty. Pure replication of that gate to pin the contract.
  function shouldLogUnmatched(format: string, p1Known: boolean, p2Known: boolean): boolean {
    if (p1Known && p2Known) return false; // matched — not unmatched
    const fmt = (format || '').toLowerCase();
    const looksLikeCannoli = fmt.includes('draft') || fmt === '';
    return looksLikeCannoli;
  }

  test('draft-format battle between unknown users IS logged', () => {
    expect(shouldLogUnmatched('gen9natdexdraft', false, false)).toBe(true);
  });

  test('random OU scrim between unknown users is NOT logged (noise filter)', () => {
    expect(shouldLogUnmatched('gen9ou', false, false)).toBe(false);
  });

  test('empty/unknown format between unknown users IS logged', () => {
    expect(shouldLogUnmatched('', false, false)).toBe(true);
  });
});

// ─── Send-queue ───────────────────────────────────────────────────────────────

describe('sendToPs send-queue — buffers when socket not OPEN', () => {
  // The bot's module-level `ws` is null in test context (no real WS), so
  // sendToPs always takes the buffer path. We exercise the queue directly.

  test('message is buffered when socket is not open (ws null)', () => {
    const queue = getSendQueueForTest();
    const before = queue.length;
    sendToPs('|/join test-room-queue-1');
    expect(queue.length).toBe(before + 1);
    expect(queue[queue.length - 1]).toBe('|/join test-room-queue-1');
    // Drain so later tests start clean.
    queue.splice(0);
  });

  test('FIFO eviction: oldest message dropped when cap exceeded', () => {
    const queue = getSendQueueForTest();
    queue.splice(0); // start clean

    // Fill to cap (100) with sentinel prefix messages.
    for (let i = 0; i < 100; i++) {
      queue.push(`|/msg sentinel-${i}`);
    }
    expect(queue.length).toBe(100);

    // One more send should drop the oldest (sentinel-0) and push the new one.
    sendToPs('|/msg overflow');
    expect(queue.length).toBe(100); // still capped at 100
    expect(queue[0]).toBe('|/msg sentinel-1'); // sentinel-0 was evicted
    expect(queue[queue.length - 1]).toBe('|/msg overflow');

    // Drain.
    queue.splice(0);
  });
});

// ─── 6-field vs 5-field PM contract ─────────────────────────────────────────

describe('cannoli-battle-created PM field contract', () => {
  // Replicate the parse logic from handleBotPm to pin the contract without
  // needing to boot the bot socket (which requires a live DB and WS).
  function parseBotPm(message: string) {
    const parts = message.split('|');
    const [, roomId, p1, p2, format, pmMatchId] = parts;
    return { roomId, p1, p2, format, pmMatchId };
  }

  test('5-field PM (old form) has no pmMatchId — falls back to inference', () => {
    const msg = 'cannoli-battle-created|battle-gen9natdexdraft-123|alice|bob|gen9natdexdraft';
    const { roomId, p1, p2, format, pmMatchId } = parseBotPm(msg);
    expect(roomId).toBe('battle-gen9natdexdraft-123');
    expect(p1).toBe('alice');
    expect(p2).toBe('bob');
    expect(format).toBe('gen9natdexdraft');
    // 5-field: no 6th field → pmMatchId is undefined → falls through to inference.
    expect(pmMatchId).toBeUndefined();
    // Inference guard: no pmMatchId means deterministic path is skipped.
    const usesDeterministicPath = !!(pmMatchId && pmMatchId.trim());
    expect(usesDeterministicPath).toBe(false);
  });

  test('6-field PM (new form) has pmMatchId — deterministic link fires (records psRoomId, defers in_progress)', () => {
    // INVITE FLOW: a 6-field PM links the room → match deterministically and
    // records psRoomId, but the match stays pre-start ('ready') until both
    // players accept the invite. The full deferred-in_progress + battle-start
    // lifecycle is covered against the DB in ps-bot-invite-flow.test.ts; here we
    // only pin the PM field contract that drives the deterministic-link branch.
    const matchId = 'match-s11-week3-001';
    const msg = `cannoli-battle-created|battle-gen9natdexdraft-456|alice|bob|gen9natdexdraft|${matchId}`;
    const { roomId, p1, p2, format, pmMatchId } = parseBotPm(msg);
    expect(roomId).toBe('battle-gen9natdexdraft-456');
    expect(p1).toBe('alice');
    expect(p2).toBe('bob');
    expect(format).toBe('gen9natdexdraft');
    expect(pmMatchId).toBe(matchId);
    // Deterministic path guard fires.
    const usesDeterministicPath = !!(pmMatchId && pmMatchId.trim());
    expect(usesDeterministicPath).toBe(true);
  });
});
