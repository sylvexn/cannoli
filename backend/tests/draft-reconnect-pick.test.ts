/**
 * Reconnect double-pick prevention (launch-prep area #3).
 *
 * draft-idempotency.test.ts already proves the ring buffer's record/lookup/evict
 * semantics in isolation. This test proves the END-TO-END contract that matters
 * for a live draft: when a flaky client re-sends the SAME clientRequestId after a
 * reconnect, the SECOND send must NOT run a second executePick — it replays the
 * cached outcome, so the team's roster gains exactly one mon and the draft index
 * advances exactly once.
 *
 * We drive the engine + the exported recordIdempotent/lookupIdempotent the same
 * way routes/draft.ts's pick handler does (see lines 199-254 / 450-497), since
 * the WS handler itself is not directly invocable in a unit test.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { executePick } from '../src/lib/draft-engine';
import {
  recordIdempotent,
  lookupIdempotent,
  IDEMPOTENCY_LIMIT,
  type IdempotentResult,
} from '../src/routes/draft';
import { buildDraftFixture, pickByTier, type DraftFixture } from './draft-fixture';

const fixtures: DraftFixture[] = [];
function fx(opts?: Parameters<typeof buildDraftFixture>[0]): DraftFixture {
  const f = buildDraftFixture(opts);
  fixtures.push(f);
  return f;
}
afterEach(() => {
  while (fixtures.length) fixtures.pop()!.cleanup();
});

/**
 * Mirror of routes/draft.ts pick handling: replay cache first, else execute +
 * record. Returns the (possibly cached) result and whether it was a replay.
 */
function pickWithIdempotency(
  leagueId: string, pokemonName: string, teamId: string, clientRequestId: string,
): { result: IdempotentResult; replayed: boolean } {
  const cached = lookupIdempotent(leagueId, clientRequestId);
  if (cached) return { result: cached, replayed: true };

  const r = executePick(leagueId, pokemonName, teamId, teamId);
  const stored: IdempotentResult = r.success
    ? { ok: true, pick: r.pick }
    : { ok: false, error: r.error, code: r.code };
  recordIdempotent(leagueId, clientRequestId, stored);
  return { result: stored, replayed: false };
}

describe('reconnect double-pick prevention', () => {
  test('re-sending the same clientRequestId does not draft a second mon', () => {
    const f = fx({ teams: 4 });
    const mon = pickByTier(5);

    const first = pickWithIdempotency(f.leagueId, mon, f.teamIds[0], 'req-A');
    expect(first.replayed).toBe(false);
    expect(first.result.ok).toBe(true);

    // Client lost the ack and reconnects, re-sending the identical pick.
    const second = pickWithIdempotency(f.leagueId, mon, f.teamIds[0], 'req-A');
    expect(second.replayed).toBe(true);
    expect(second.result).toEqual(first.result);

    // Critically: exactly ONE pick + ONE roster row, index advanced once.
    expect(db.select().from(schema.draftPicks).where(eq(schema.draftPicks.leagueId, f.leagueId)).all()).toHaveLength(1);
    expect(db.select().from(schema.rosters).where(eq(schema.rosters.teamId, f.teamIds[0])).all()).toHaveLength(1);
    const state = db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, f.leagueId)).get()!;
    expect(state.currentPickIndex).toBe(1);
  });

  test('without a clientRequestId, a duplicate send IS a real second pick (engine guards via already_drafted / turn)', () => {
    const f = fx({ teams: 4 });
    const mon = pickByTier(5);

    const r1 = executePick(f.leagueId, mon, f.teamIds[0], f.teamIds[0]);
    expect(r1.success).toBe(true);

    // Same mon again — now it's team[1]'s turn AND the mon is taken. Either guard
    // rejects it; the point is the engine, not the cache, is the only safety net.
    const r2 = executePick(f.leagueId, mon, f.teamIds[0], f.teamIds[0]);
    expect(r2.success).toBe(false);
  });

  test('a wrapped-out clientRequestId loses its replay protection (ring buffer overflow)', () => {
    const f = fx({ teams: 30, rosterSize: 10 });
    const mon = pickByTier(5);

    // First pick recorded under req-OLD.
    const first = pickWithIdempotency(f.leagueId, mon, f.teamIds[0], 'req-OLD');
    expect(first.result.ok).toBe(true);

    // Flood the SAME league's buffer with > IDEMPOTENCY_LIMIT other ids,
    // evicting req-OLD (simulates a very long draft with many picks).
    for (let i = 0; i < IDEMPOTENCY_LIMIT; i++) {
      recordIdempotent(f.leagueId, `flood-${i}`, { ok: true, pick: { teamId: 't', pokemonName: 'x', tier: 1, pickNumber: i } });
    }
    expect(lookupIdempotent(f.leagueId, 'req-OLD')).toBeUndefined();

    // A reconnect re-send of req-OLD now MISSES the cache and falls through to a
    // real executePick. Documents the buffer's bound: protection is only the
    // most-recent 64 ids per league. The mon is already drafted, so the engine
    // (not the cache) catches the double — confirming the engine backstop holds.
    const replay = pickWithIdempotency(f.leagueId, mon, f.teamIds[0], 'req-OLD');
    expect(replay.replayed).toBe(false);
    expect(replay.result.ok).toBe(false); // engine rejected: already_drafted
    if (!replay.result.ok) {
      expect(['already_drafted', 'not_your_turn']).toContain(replay.result.code);
    }
    // Still exactly one real pick on the board.
    expect(db.select().from(schema.draftPicks).where(eq(schema.draftPicks.leagueId, f.leagueId)).all()).toHaveLength(1);
  });
});
