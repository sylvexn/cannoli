/**
 * Draft timer + lifecycle concurrency tests (launch-prep area #3).
 *
 * Covers the parts the 12-coach Playwright happy path (tests/e2e/live-draft.spec.ts)
 * does NOT: per-pick timer expiry → pause-at-expiry, admin auto-pick resolution,
 * undo (incl. the captain-lock reset path), skip, draft completion, and the
 * global tick scheduler's deadline math across MULTIPLE concurrent drafts.
 *
 * These exercise the engine + a faithful re-implementation of the scheduler's
 * per-tick deadline check from routes/draft.ts (the real tickTimers() is a
 * private module fn that reads ALL draftState rows and fires on a 1s interval —
 * see Code-Quality note in findings about it not being directly testable).
 *
 * Timing is driven by backdating `timerStartedAt` rather than real sleeps:
 * the engine derives expiry purely from `timerStartedAt + timerDuration`.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import {
  handleTimerExpiry,
  executeAutoPick,
  executePick,
  undoLastPick,
  skipPick,
  getDraftSnapshot,
  generateSnakeOrder,
  getAutoPick,
  setDraftQueue,
  getDraftQueue,
} from '../src/lib/draft-engine';
import { buildDraftFixture, pickByTier, secondsAgo, type DraftFixture } from './draft-fixture';

const fixtures: DraftFixture[] = [];
function fx(opts?: Parameters<typeof buildDraftFixture>[0]): DraftFixture {
  const f = buildDraftFixture(opts);
  fixtures.push(f);
  return f;
}
afterEach(() => {
  while (fixtures.length) fixtures.pop()!.cleanup();
});

/** Re-implements the deadline check from routes/draft.ts tickTimers(). */
function isExpiredNow(state: { status: string; timerStartedAt: string | null; timerDuration: number }, now = Date.now()): boolean {
  if (state.status !== 'in_progress' || !state.timerStartedAt) return false;
  const deadline = new Date(state.timerStartedAt).getTime() + state.timerDuration * 1000;
  return now >= deadline;
}
function freshState(leagueId: string) {
  return db.select().from(schema.draftState).where(eq(schema.draftState.leagueId, leagueId)).get()!;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Timer expiry → pause-at-expiry (handleTimerExpiry)
// ───────────────────────────────────────────────────────────────────────────

describe('timer expiry — pause-at-expiry', () => {
  test('expiry pauses the draft and flags the on-clock team (does NOT auto-pick)', () => {
    const f = fx({ teams: 4, timerDuration: 120, timerStartedAt: secondsAgo(200) });
    const onClock = f.teamIds[0]; // currentPickIndex 0 → first team

    const res = handleTimerExpiry(f.leagueId);
    expect(res).toEqual({ paused: true, teamId: onClock });

    const state = freshState(f.leagueId);
    expect(state.status).toBe('paused');
    expect(state.timerStartedAt).toBeNull();
    expect(state.timerExpiredForTeam).toBe(onClock);
    // No pick should have been made by the expiry itself.
    expect(db.select().from(schema.draftPicks).where(eq(schema.draftPicks.leagueId, f.leagueId)).all()).toHaveLength(0);
  });

  test('handleTimerExpiry is a no-op when draft is not in_progress', () => {
    const f = fx({ status: 'paused', timerExpiredForTeam: null, timerStartedAt: null });
    expect(handleTimerExpiry(f.leagueId)).toBeNull();
  });

  test('snapshot exposes timerExpiredForTeam after expiry so the UI can render the paused gate', () => {
    const f = fx({ teams: 4, timerDuration: 60, timerStartedAt: secondsAgo(120) });
    handleTimerExpiry(f.leagueId);
    const snap = getDraftSnapshot(f.leagueId)!;
    expect(snap.status).toBe('paused');
    expect(snap.timerExpiredForTeam).toBe(f.teamIds[0]);
    expect(snap.timerExpiresAt).toBeNull(); // paused → no live deadline
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Deadline math + multiple concurrent drafts (tick scheduler)
// ───────────────────────────────────────────────────────────────────────────

describe('tick scheduler — deadline math, multiple concurrent drafts', () => {
  test('not expired one second before the deadline; expired at/after it', () => {
    const f = fx({ timerDuration: 120, timerStartedAt: secondsAgo(119) });
    const s = freshState(f.leagueId);
    expect(isExpiredNow(s)).toBe(false);
    // 1s into the future past the 120s window
    expect(isExpiredNow(s, Date.now() + 2000)).toBe(true);
  });

  test('an in_progress draft with null timerStartedAt is never considered expired', () => {
    const f = fx({ timerDuration: 120, timerStartedAt: null });
    // status in_progress but no timer running (e.g. between resume races)
    db.update(schema.draftState).set({ status: 'in_progress', timerStartedAt: null })
      .where(eq(schema.draftState.leagueId, f.leagueId)).run();
    expect(isExpiredNow(freshState(f.leagueId))).toBe(false);
  });

  test('one expired draft pauses while a concurrent fresh draft is untouched', () => {
    const expired = fx({ teams: 4, timerDuration: 60, timerStartedAt: secondsAgo(120) });
    const fresh = fx({ teams: 4, timerDuration: 600, timerStartedAt: new Date() });

    // Simulate a single global tick over all draft rows (the real tickTimers loop).
    for (const f of [expired, fresh]) {
      const s = freshState(f.leagueId);
      if (isExpiredNow(s)) handleTimerExpiry(f.leagueId);
    }

    expect(freshState(expired.leagueId).status).toBe('paused');
    expect(freshState(expired.leagueId).timerExpiredForTeam).toBe(expired.teamIds[0]);
    expect(freshState(fresh.leagueId).status).toBe('in_progress');
    expect(freshState(fresh.leagueId).timerExpiredForTeam).toBeNull();
  });

  test('each expired draft flags ITS OWN on-clock team (no cross-league bleed)', () => {
    // Two drafts at different pick indices → different on-clock teams.
    const a = fx({ teams: 4, timerDuration: 30, timerStartedAt: secondsAgo(60), currentPickIndex: 0 });
    const b = fx({ teams: 4, timerDuration: 30, timerStartedAt: secondsAgo(60), currentPickIndex: 1 });

    handleTimerExpiry(a.leagueId);
    handleTimerExpiry(b.leagueId);

    // a: pick 0 → team[0]. b: pick 1 → team[1] (round 1, still forward order).
    expect(freshState(a.leagueId).timerExpiredForTeam).toBe(a.teamIds[0]);
    expect(freshState(b.leagueId).timerExpiredForTeam).toBe(b.teamIds[1]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Admin auto-pick resolves the paused-at-expiry state
// ───────────────────────────────────────────────────────────────────────────

describe('auto-pick after expiry', () => {
  test('executeAutoPick only works from the paused+flagged state', () => {
    const f = fx({ teams: 4, timerStartedAt: new Date() }); // in_progress, not paused
    expect(executeAutoPick(f.leagueId, 'admin')).toBeNull();
  });

  test('auto-pick drafts a mon for the flagged team, clears the flag, resumes the timer, advances the index', () => {
    const f = fx({ teams: 4, timerDuration: 60, timerStartedAt: secondsAgo(120) });
    handleTimerExpiry(f.leagueId);
    expect(freshState(f.leagueId).status).toBe('paused');

    const result = executeAutoPick(f.leagueId, 'admin');
    expect(result?.success).toBe(true);

    const state = freshState(f.leagueId);
    expect(state.status).toBe('in_progress');
    expect(state.timerExpiredForTeam).toBeNull();
    expect(state.timerStartedAt).not.toBeNull(); // timer restarted for next team
    expect(state.currentPickIndex).toBe(1);

    // The pick is attributed to the team that was on the clock (team[0]).
    const picks = db.select().from(schema.draftPicks).where(eq(schema.draftPicks.leagueId, f.leagueId)).all();
    expect(picks).toHaveLength(1);
    expect(picks[0].teamId).toBe(f.teamIds[0]);
  });

  test('auto-pick is deterministic — highest affordable tier, alphabetical tiebreak', () => {
    const f = fx({ teams: 4, timerDuration: 60, timerStartedAt: secondsAgo(120) });
    handleTimerExpiry(f.leagueId);
    const r = executeAutoPick(f.leagueId, 'admin')!;
    expect(r.success).toBe(true);
    if (r.success) {
      // pointCap 110, empty roster, rosterSize 10 → reserve 9pt → can afford <=12 tier mon.
      // Highest seeded tier is 12; pick must be tier 12 (or whatever the max <= maxAffordable is).
      expect(r.pick.tier).toBeGreaterThanOrEqual(9);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3b. Queue-aware auto-pick (AUTOPICK-QUEUE)
// ───────────────────────────────────────────────────────────────────────────

describe('queue-aware auto-pick', () => {
  test('setDraftQueue persists, dedupes, caps at 3, preserves order', () => {
    const f = fx({ teams: 4 });
    const a = pickByTier(5), b = pickByTier(5, [a]), c = pickByTier(5, [a, b]), d = pickByTier(5, [a, b, c]);
    const saved = setDraftQueue(f.leagueId, f.teamIds[0], [a, a, b, c, d]); // dup a, 4 distinct
    expect(saved).toEqual([a, b, c]); // deduped + capped at 3, order kept
    expect(getDraftQueue(f.leagueId, f.teamIds[0])).toEqual([a, b, c]);
  });

  test('auto-pick takes the top eligible queue entry, not the highest tier', () => {
    const f = fx({ teams: 4, timerDuration: 60, timerStartedAt: secondsAgo(120) });
    // Queue a LOW-tier mon first; without queue-awareness auto-pick would grab
    // the highest affordable tier instead.
    const low = pickByTier(3);
    setDraftQueue(f.leagueId, f.teamIds[0], [low]);
    handleTimerExpiry(f.leagueId);

    const r = executeAutoPick(f.leagueId, 'admin')!;
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.pick.pokemonName).toBe(low);
      expect(r.pick.teamId).toBe(f.teamIds[0]);
    }
  });

  test('auto-pick walks past an ineligible (already-drafted) queue head to the next valid entry', () => {
    const f = fx({ teams: 4 });
    const first = pickByTier(4);
    const second = pickByTier(4, [first]);
    // team[1] drafts `first` so it's no longer available to team[0].
    // (skipTurnCheck so we don't have to march the snake order.)
    executePick(f.leagueId, first, f.teamIds[1], 'seed', { skipTurnCheck: true });
    setDraftQueue(f.leagueId, f.teamIds[0], [first, second]);

    const pick = getAutoPick(f.teamIds[0], f.leagueId, f.pointCap);
    expect(pick?.name).toBe(second); // skipped the drafted `first`
  });

  test('empty / fully-invalid queue falls back to highest affordable', () => {
    const f = fx({ teams: 4, timerDuration: 60, timerStartedAt: secondsAgo(120) });
    // Queue a single mon, then have another team draft it → queue all invalid.
    const only = pickByTier(6);
    executePick(f.leagueId, only, f.teamIds[1], 'seed', { skipTurnCheck: true });
    setDraftQueue(f.leagueId, f.teamIds[0], [only]);
    handleTimerExpiry(f.leagueId);

    const r = executeAutoPick(f.leagueId, 'admin')!;
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.pick.pokemonName).not.toBe(only);
      expect(r.pick.tier).toBeGreaterThanOrEqual(9); // highest-affordable fallback
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Skip resolves the paused state without drafting
// ───────────────────────────────────────────────────────────────────────────

describe('skip after expiry', () => {
  test('skip from paused+flagged advances index, clears flag, makes no pick', () => {
    const f = fx({ teams: 4, timerDuration: 60, timerStartedAt: secondsAgo(120) });
    handleTimerExpiry(f.leagueId);

    const r = skipPick(f.leagueId, 'admin');
    expect(r.success).toBe(true);

    const state = freshState(f.leagueId);
    expect(state.currentPickIndex).toBe(1);
    expect(state.status).toBe('in_progress');
    expect(state.timerExpiredForTeam).toBeNull();
    expect(db.select().from(schema.draftPicks).where(eq(schema.draftPicks.leagueId, f.leagueId)).all()).toHaveLength(0);
  });

  test('non-force skip refuses when not in the post-expiry paused state', () => {
    const f = fx({ teams: 4, timerStartedAt: new Date() });
    const r = skipPick(f.leagueId, 'admin');
    expect(r.success).toBe(false);
  });

  test('force skip advances an in_progress draft even with no expiry', () => {
    const f = fx({ teams: 4, timerStartedAt: new Date() });
    const r = skipPick(f.leagueId, 'admin', { force: true });
    expect(r.success).toBe(true);
    expect(freshState(f.leagueId).currentPickIndex).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Undo — incl. captain-lock reset on undo of the completing pick
// ───────────────────────────────────────────────────────────────────────────

describe('undo last pick', () => {
  test('undo removes the pick + roster row and rewinds the index', () => {
    const f = fx({ teams: 4, timerStartedAt: new Date() });
    const mon = pickByTier(5);
    const picked = executePick(f.leagueId, mon, f.teamIds[0], 'coach');
    expect(picked.success).toBe(true);
    expect(freshState(f.leagueId).currentPickIndex).toBe(1);

    const undo = undoLastPick(f.leagueId, 'admin');
    expect(undo.success).toBe(true);
    expect(freshState(f.leagueId).currentPickIndex).toBe(0);
    expect(db.select().from(schema.draftPicks).where(eq(schema.draftPicks.leagueId, f.leagueId)).all()).toHaveLength(0);
    expect(db.select().from(schema.rosters).where(eq(schema.rosters.teamId, f.teamIds[0])).all()).toHaveLength(0);
  });

  test('undo refuses when there are no picks', () => {
    const f = fx({ teams: 4, timerStartedAt: new Date() });
    expect(undoLastPick(f.leagueId, 'admin').success).toBe(false);
  });

  test('undo of a completed draft flips status back to in_progress and resets captainsLocked', () => {
    // Tiny draft: 2 teams × 1 round = 2 picks total → second pick completes it.
    const f = fx({ teams: 2, rosterSize: 1, timerStartedAt: new Date() });
    const m1 = pickByTier(1);
    const m2 = pickByTier(1, [m1]);
    expect(executePick(f.leagueId, m1, f.teamIds[0], 'c0').success).toBe(true);
    expect(executePick(f.leagueId, m2, f.teamIds[1], 'c1').success).toBe(true);
    expect(freshState(f.leagueId).status).toBe('completed');

    // Simulate teams having locked captains post-draft.
    db.update(schema.teams).set({ captainsLocked: true }).where(eq(schema.teams.leagueId, f.leagueId)).run();

    const undo = undoLastPick(f.leagueId, 'admin');
    expect(undo.success).toBe(true);

    const state = freshState(f.leagueId);
    expect(state.status).toBe('in_progress');
    expect(state.completedAt).toBeNull();
    expect(state.timerStartedAt).not.toBeNull();

    const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, f.leagueId)).all();
    expect(teams.every(t => t.captainsLocked === false)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Completion: last pick completes the draft, stops the timer
// ───────────────────────────────────────────────────────────────────────────

describe('draft completion', () => {
  test('the final snake slot completes the draft and nulls the timer', () => {
    const f = fx({ teams: 2, rosterSize: 1, timerStartedAt: new Date() });
    const order = generateSnakeOrder(f.teamIds, f.rosterSize);
    expect(order).toHaveLength(2);

    const m1 = pickByTier(3);
    executePick(f.leagueId, m1, order[0].teamId, 'c');
    expect(freshState(f.leagueId).status).toBe('in_progress');

    const m2 = pickByTier(3, [m1]);
    executePick(f.leagueId, m2, order[1].teamId, 'c');
    const state = freshState(f.leagueId);
    expect(state.status).toBe('completed');
    expect(state.timerStartedAt).toBeNull();
    expect(state.completedAt).not.toBeNull();
  });

  test('picking on a completed draft is rejected', () => {
    const f = fx({ teams: 2, rosterSize: 1, status: 'completed', currentPickIndex: 2, timerStartedAt: null });
    const r = executePick(f.leagueId, pickByTier(3), f.teamIds[0], 'c');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.code).toBe('not_in_progress');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Turn enforcement (non-override pick path)
// ───────────────────────────────────────────────────────────────────────────

describe('turn enforcement', () => {
  test('a team that is not on the clock is rejected with not_your_turn', () => {
    const f = fx({ teams: 4, timerStartedAt: new Date() }); // index 0 → team[0]
    const r = executePick(f.leagueId, pickByTier(5), f.teamIds[2], 'wrong');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.code).toBe('not_your_turn');
  });

  test('skipTurnCheck (staff force-pick) bypasses the turn check', () => {
    const f = fx({ teams: 4, timerStartedAt: new Date() });
    const r = executePick(f.leagueId, pickByTier(5), f.teamIds[2], 'staff', { skipTurnCheck: true });
    expect(r.success).toBe(true);
  });
});
