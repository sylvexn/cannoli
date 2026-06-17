/**
 * Regression tests for the draft-pick idempotency ring buffer.
 *
 * Real-time draft picks travel over a WebSocket. A flaky client that loses its
 * connection mid-pick will re-send the same message once it reconnects. To stop
 * that retry from being treated as a *second* pick, `draft.ts` keeps a per-league
 * ring buffer keyed on the client-supplied `clientRequestId`: the first time a
 * request id is seen the real pick runs and its outcome is recorded; every
 * subsequent send of the same id replays the cached outcome verbatim.
 *
 * This matters for launch readiness because a double-pick during the first live
 * draft is unrecoverable without an admin undo — the buffer is the safety net.
 *
 * ── What is covered ──────────────────────────────────────────────────────────
 *  - Same clientRequestId returns the cached result (no double-pick).
 *  - Per-league isolation: an identical id in two leagues is independent.
 *  - The 64-entry ring buffer evicts in insertion order (oldest first).
 *  - Cached *failures* are replayed as failures, not silently retried.
 *  - Undo clears the cache: pick → undo → re-submit same clientRequestId
 *    does NOT return the stale cached success.
 *
 * ── Testing approach ─────────────────────────────────────────────────────────
 * `recordIdempotent` / `lookupIdempotent` / `evictIdempotentByPokemon` /
 * `IDEMPOTENCY_LIMIT` are exported from `draft.ts` purely for this test.
 * Ring-buffer tests are pure (no DB); the undo section uses real DB fixtures
 * via draft-fixture.ts + executePick/undoLastPick.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import {
  recordIdempotent,
  lookupIdempotent,
  evictIdempotentByPokemon,
  IDEMPOTENCY_LIMIT,
  type IdempotentResult,
} from '../src/routes/draft';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let leagueCounter = 0;
/** A fresh, never-before-used league id so the global buffer starts empty. */
function freshLeague(): string {
  return `test-league-${++leagueCounter}-${Date.now()}`;
}

function okPick(pokemonName: string, pickNumber: number): IdempotentResult {
  return {
    ok: true,
    pick: { teamId: 'team-a', pokemonName, tier: 5, pickNumber },
  };
}

function failPick(error: string): IdempotentResult {
  return { ok: false, error, code: 'not_your_turn' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cache hit — same clientRequestId
// ─────────────────────────────────────────────────────────────────────────────

describe('lookupIdempotent — cache hit', () => {
  test('an unrecorded request id misses', () => {
    const league = freshLeague();
    expect(lookupIdempotent(league, 'never-seen')).toBeUndefined();
  });

  test('a recorded request id returns the exact cached result', () => {
    const league = freshLeague();
    const result = okPick('dragapult', 7);
    recordIdempotent(league, 'req-1', result);

    const hit = lookupIdempotent(league, 'req-1');
    expect(hit).toBeDefined();
    expect(hit).toEqual(result);
  });

  test('re-recording the same id overwrites without growing the buffer', () => {
    const league = freshLeague();
    recordIdempotent(league, 'req-1', okPick('garchomp', 1));
    recordIdempotent(league, 'req-1', okPick('garchomp', 1));

    const hit = lookupIdempotent(league, 'req-1');
    expect(hit).toEqual(okPick('garchomp', 1));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Per-league isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('idempotency — per-league isolation', () => {
  test('the same request id in two leagues is independent', () => {
    const leagueA = freshLeague();
    const leagueB = freshLeague();

    recordIdempotent(leagueA, 'shared-id', okPick('koraidon', 1));
    recordIdempotent(leagueB, 'shared-id', okPick('miraidon', 2));

    expect(lookupIdempotent(leagueA, 'shared-id')).toEqual(okPick('koraidon', 1));
    expect(lookupIdempotent(leagueB, 'shared-id')).toEqual(okPick('miraidon', 2));
  });

  test('recording in one league does not create entries in another', () => {
    const leagueA = freshLeague();
    const leagueB = freshLeague();

    recordIdempotent(leagueA, 'only-in-a', okPick('gholdengo', 1));

    expect(lookupIdempotent(leagueB, 'only-in-a')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Ring-buffer eviction (IDEMPOTENCY_LIMIT = 64, insertion-order trim)
// ─────────────────────────────────────────────────────────────────────────────

describe('idempotency — ring-buffer eviction', () => {
  test('IDEMPOTENCY_LIMIT is 64', () => {
    expect(IDEMPOTENCY_LIMIT).toBe(64);
  });

  test('exactly IDEMPOTENCY_LIMIT entries are all retained', () => {
    const league = freshLeague();
    for (let i = 0; i < IDEMPOTENCY_LIMIT; i++) {
      recordIdempotent(league, `req-${i}`, okPick(`mon-${i}`, i));
    }
    // None evicted yet — the buffer is exactly full.
    expect(lookupIdempotent(league, 'req-0')).toEqual(okPick('mon-0', 0));
    expect(lookupIdempotent(league, `req-${IDEMPOTENCY_LIMIT - 1}`))
      .toEqual(okPick(`mon-${IDEMPOTENCY_LIMIT - 1}`, IDEMPOTENCY_LIMIT - 1));
  });

  test('the oldest entry is evicted once the 65th is added', () => {
    const league = freshLeague();
    for (let i = 0; i <= IDEMPOTENCY_LIMIT; i++) {
      recordIdempotent(league, `req-${i}`, okPick(`mon-${i}`, i));
    }
    // req-0 was the oldest insertion → evicted.
    expect(lookupIdempotent(league, 'req-0')).toBeUndefined();
    // req-1 is now the oldest survivor; the newest is still present.
    expect(lookupIdempotent(league, 'req-1')).toEqual(okPick('mon-1', 1));
    expect(lookupIdempotent(league, `req-${IDEMPOTENCY_LIMIT}`))
      .toEqual(okPick(`mon-${IDEMPOTENCY_LIMIT}`, IDEMPOTENCY_LIMIT));
  });

  test('inserting far past the limit keeps only the most-recent 64', () => {
    const league = freshLeague();
    const total = IDEMPOTENCY_LIMIT * 3;
    for (let i = 0; i < total; i++) {
      recordIdempotent(league, `req-${i}`, okPick(`mon-${i}`, i));
    }
    // Everything older than the last 64 is gone.
    for (let i = 0; i < total - IDEMPOTENCY_LIMIT; i++) {
      expect(lookupIdempotent(league, `req-${i}`)).toBeUndefined();
    }
    // The most-recent 64 all survive.
    for (let i = total - IDEMPOTENCY_LIMIT; i < total; i++) {
      expect(lookupIdempotent(league, `req-${i}`)).toEqual(okPick(`mon-${i}`, i));
    }
  });

  test('eviction is scoped per league — a full league does not evict another', () => {
    const leagueA = freshLeague();
    const leagueB = freshLeague();

    // Fill league A well past its limit.
    for (let i = 0; i < IDEMPOTENCY_LIMIT * 2; i++) {
      recordIdempotent(leagueA, `req-${i}`, okPick(`mon-${i}`, i));
    }
    // A single entry in league B must be untouched.
    recordIdempotent(leagueB, 'lonely', okPick('annihilape', 1));
    expect(lookupIdempotent(leagueB, 'lonely')).toEqual(okPick('annihilape', 1));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Cached failures replay as failures
// ─────────────────────────────────────────────────────────────────────────────

describe('idempotency — failure replay', () => {
  test('a recorded failure is replayed verbatim, not retried', () => {
    const league = freshLeague();
    const failure = failPick('Not your turn to pick');
    recordIdempotent(league, 'bad-req', failure);

    const hit = lookupIdempotent(league, 'bad-req');
    expect(hit).toBeDefined();
    expect(hit!.ok).toBe(false);
    expect(hit).toEqual(failure);
  });

  test('a failure preserves its error code', () => {
    const league = freshLeague();
    recordIdempotent(league, 'bad-req', failPick('Pokemon already drafted'));

    const hit = lookupIdempotent(league, 'bad-req');
    expect(hit!.ok).toBe(false);
    if (hit && !hit.ok) {
      expect(hit.error).toBe('Pokemon already drafted');
      expect(hit.code).toBe('not_your_turn');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. evictIdempotentByPokemon — undo clears the cache
// ─────────────────────────────────────────────────────────────────────────────

describe('evictIdempotentByPokemon', () => {
  test('removes only the entry whose pokemon name matches', () => {
    const league = freshLeague();
    recordIdempotent(league, 'req-a', okPick('dragapult', 1));
    recordIdempotent(league, 'req-b', okPick('garchomp', 2));

    const evicted = evictIdempotentByPokemon(league, 'dragapult');
    expect(evicted).toBe(1);
    expect(lookupIdempotent(league, 'req-a')).toBeUndefined();
    // The other entry is untouched.
    expect(lookupIdempotent(league, 'req-b')).toEqual(okPick('garchomp', 2));
  });

  test('returns 0 when no matching entry exists', () => {
    const league = freshLeague();
    recordIdempotent(league, 'req-a', okPick('dragapult', 1));
    const evicted = evictIdempotentByPokemon(league, 'garchomp');
    expect(evicted).toBe(0);
    expect(lookupIdempotent(league, 'req-a')).toBeDefined();
  });

  test('does not evict failure entries for the same pokemon name', () => {
    const league = freshLeague();
    recordIdempotent(league, 'req-fail', { ok: false, error: 'banned', code: 'banned' });
    const evicted = evictIdempotentByPokemon(league, 'dragapult');
    expect(evicted).toBe(0);
    // Failure entry (no pick.pokemonName) is not touched.
    expect(lookupIdempotent(league, 'req-fail')).toBeDefined();
  });

  test('is scoped per league — does not evict another league', () => {
    const leagueA = freshLeague();
    const leagueB = freshLeague();
    recordIdempotent(leagueA, 'req', okPick('dragapult', 1));
    recordIdempotent(leagueB, 'req', okPick('dragapult', 1));

    evictIdempotentByPokemon(leagueA, 'dragapult');
    expect(lookupIdempotent(leagueA, 'req')).toBeUndefined();
    expect(lookupIdempotent(leagueB, 'req')).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Undo-then-retry end-to-end (DB + engine)
// ─────────────────────────────────────────────────────────────────────────────
// These tests use real DB fixtures. They prove that after an admin undo, a
// client re-submitting the original clientRequestId does NOT receive the
// stale cached success — instead the pick is re-executed (or rejected).
//
// We simulate the route handler's behaviour directly (no HTTP/WS):
//   1. Look up cache  → miss → executePick → recordIdempotent
//   2. Admin calls undoLastPick → evictIdempotentByPokemon
//   3. Client retries same clientRequestId → cache miss → real pick logic runs

import { executePick, undoLastPick } from '../src/lib/draft-engine';
import { buildDraftFixture, pickByTier, type DraftFixture } from './draft-fixture';

const dbFixtures: DraftFixture[] = [];
afterEach(() => { while (dbFixtures.length) dbFixtures.pop()!.cleanup(); });

function fixtureWith(opts?: Parameters<typeof buildDraftFixture>[0]): DraftFixture {
  const f = buildDraftFixture(opts);
  dbFixtures.push(f);
  return f;
}

/** Mirrors the route handler: lookup → execute → record. */
function pickWithIdempotency(
  leagueId: string, pokemonName: string, teamId: string, clientRequestId: string,
): { result: IdempotentResult; replayed: boolean } {
  const cached = lookupIdempotent(leagueId, clientRequestId);
  if (cached) return { result: cached, replayed: true };
  const r = executePick(leagueId, pokemonName, teamId, teamId);
  const stored: IdempotentResult = r.success
    ? { ok: true, pick: r.pick }
    : { ok: false, error: r.error!, code: r.code };
  recordIdempotent(leagueId, clientRequestId, stored);
  return { result: stored, replayed: false };
}

describe('idempotency — undo clears cache (end-to-end)', () => {
  test('after undo, the same clientRequestId is a cache miss and re-executes', () => {
    const { leagueId, teamIds } = fixtureWith({ teams: 2, rosterSize: 2 });
    const teamId = teamIds[0];
    const mon = pickByTier(5);
    const reqId = 'undo-test-req-1';

    // First pick — cache miss, executes and records.
    const first = pickWithIdempotency(leagueId, mon, teamId, reqId);
    expect(first.replayed).toBe(false);
    expect(first.result.ok).toBe(true);

    // Replaying the same id before undo → cache hit.
    const replay = pickWithIdempotency(leagueId, mon, teamId, reqId);
    expect(replay.replayed).toBe(true);
    expect(replay.result.ok).toBe(true);

    // Admin undoes the pick and evicts the cache entry.
    const undoResult = undoLastPick(leagueId, 'admin');
    expect(undoResult.success).toBe(true);
    if (undoResult.success) {
      evictIdempotentByPokemon(leagueId, undoResult.undonePick.pokemonName);
    }

    // The same clientRequestId is now a cache miss.
    const afterUndo = lookupIdempotent(leagueId, reqId);
    expect(afterUndo).toBeUndefined();

    // A retry re-executes the pick (the mon is available again after undo).
    const retry = pickWithIdempotency(leagueId, mon, teamId, reqId);
    expect(retry.replayed).toBe(false);
    expect(retry.result.ok).toBe(true);
  });

  test('undo does not evict cache entries for other pokemon in the same league', () => {
    const { leagueId, teamIds } = fixtureWith({ teams: 2, rosterSize: 4 });
    const teamA = teamIds[0];
    const teamB = teamIds[1];
    const monA = pickByTier(5);
    const monB = pickByTier(4, [monA]);

    // Pick monA for teamA (pick index 0), then monB for teamB (pick index 1).
    pickWithIdempotency(leagueId, monA, teamA, 'req-a');
    pickWithIdempotency(leagueId, monB, teamB, 'req-b');

    // Undo reverts monB (the last pick).
    const undoResult = undoLastPick(leagueId, 'admin');
    expect(undoResult.success).toBe(true);
    if (undoResult.success) {
      evictIdempotentByPokemon(leagueId, undoResult.undonePick.pokemonName);
    }

    // req-b (monB) is evicted.
    expect(lookupIdempotent(leagueId, 'req-b')).toBeUndefined();
    // req-a (monA, a different pokemon) is untouched.
    expect(lookupIdempotent(leagueId, 'req-a')).toBeDefined();
    expect(lookupIdempotent(leagueId, 'req-a')!.ok).toBe(true);
  });
});
