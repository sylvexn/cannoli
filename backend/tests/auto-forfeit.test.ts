/**
 * Tests for the auto-forfeit job's deadline-resolution helper.
 *
 * Deadlines are SCHEDULE-FIRST: the cutoff for a match comes from the league's
 * live `weekDates` (end-of-day in the league timezone), NOT from a literal date
 * baked onto the match row at creation time. Correcting the schedule must move
 * the cutoff, and a stale baked value must never drive a forfeit. The stored
 * `match.deadline` is only a fallback for weeks the schedule doesn't cover —
 * playoff weeks and manually-created fixtures.
 */
import { describe, expect, test } from 'bun:test';
import { effectiveMatchDeadline, endOfDayInZone } from '../src/lib/jobs/auto-forfeit';

// weekDates[w] is the date week w BEGINS; a week-w match is due at the END of
// its week — end-of-day the day before week w+1 starts, in the league TZ.
const SCHED = '{"1":"2026-06-15","2":"2026-06-22","3":"2026-06-29"}';

describe('effectiveMatchDeadline', () => {
  test('deadline is the end of the week, not its start date (the regression)', () => {
    // Week 1 starts Mon 06-15, week 2 starts Mon 06-22 → week-1 matches are due
    // end of Sun 06-21 (EDT, UTC-4) == 06-22T03:59:59Z. Anchoring to the week's
    // OWN start (06-15) is what forfeited live matches the day the season began.
    expect(effectiveMatchDeadline({ deadline: null, week: 1 }, SCHED))
      .toBe('2026-06-22T03:59:59.000Z');
  });

  test('schedule wins over a stale baked deadline', () => {
    // A literal date baked onto the row must NOT drive the cutoff — the live
    // schedule does. Week 2 → end of Sun 06-28 == 06-29T03:59:59Z.
    const stale = '2020-01-01T00:00:00.000Z';
    expect(effectiveMatchDeadline({ deadline: stale, week: 2 }, SCHED))
      .toBe('2026-06-29T03:59:59.000Z');
  });

  test('final scheduled week infers its length from the previous gap (default 7)', () => {
    // Week 3 has no week 4 → full week from its start: end of (06-29 + 6) = Sun
    // 07-05 == 07-06T03:59:59Z. Gap inferred from weeks 2→3 (7 days).
    expect(effectiveMatchDeadline({ deadline: null, week: 3 }, SCHED))
      .toBe('2026-07-06T03:59:59.000Z');
  });

  test('honors an explicit league timezone for the cutoff', () => {
    // Los Angeles is PDT (UTC-7) → local 23:59:59 == 06:59:59 UTC next day.
    expect(effectiveMatchDeadline({ deadline: null, week: 1 }, SCHED, 'America/Los_Angeles'))
      .toBe('2026-06-22T06:59:59.000Z');
    // UTC zone is a no-op offset (end of Sun 06-21).
    expect(effectiveMatchDeadline({ deadline: null, week: 1 }, SCHED, 'UTC'))
      .toBe('2026-06-21T23:59:59.000Z');
  });

  test('returns null when deadline is null AND week not in weekDates', () => {
    expect(effectiveMatchDeadline({ deadline: null, week: 99 }, SCHED))
      .toBeNull();
  });

  test('returns null when deadline is null AND weekDatesJson is null', () => {
    expect(effectiveMatchDeadline({ deadline: null, week: 1 }, null)).toBeNull();
  });

  test('returns null on malformed weekDatesJson (does not throw)', () => {
    expect(effectiveMatchDeadline({ deadline: null, week: 1 }, '{not json}'))
      .toBeNull();
  });

  test('schedule (weekDates) wins over the stored deadline when the week is scheduled', () => {
    // Even with a stored deadline present, a scheduled week resolves to the
    // schedule — so editing weekDates moves it. Week 1 → end of Sun 06-21.
    const stored = '2026-04-15T12:00:00.000Z';
    expect(effectiveMatchDeadline({ deadline: stored, week: 1 }, SCHED))
      .toBe('2026-06-22T03:59:59.000Z');
  });

  test('falls back to the stored deadline when the week is NOT in the schedule (playoff/manual)', () => {
    // Playoff weeks live past the regular schedule; their cutoff comes from the
    // deadline set on the row (manually or by the bracket), not from weekDates.
    const stored = '2026-07-15T03:59:59.000Z';
    expect(effectiveMatchDeadline({ deadline: stored, week: 99 }, '{"1":"2026-04-21"}'))
      .toBe(stored);
  });
});

describe('endOfDayInZone (TZ-DEADLINE cutoff anchor)', () => {
  test('EST (winter, UTC-5) end-of-day', () => {
    // 2026-01-15 is EST → local 23:59:59 == 04:59:59 UTC next day.
    expect(endOfDayInZone('2026-01-15', 'America/New_York'))
      .toBe('2026-01-16T04:59:59.000Z');
  });

  test('EDT (summer, UTC-4) end-of-day', () => {
    expect(endOfDayInZone('2026-07-15', 'America/New_York'))
      .toBe('2026-07-16T03:59:59.000Z');
  });

  test('UTC zone is the identity offset', () => {
    expect(endOfDayInZone('2026-04-21', 'UTC')).toBe('2026-04-21T23:59:59.000Z');
  });
});
