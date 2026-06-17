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

describe('effectiveMatchDeadline', () => {
  test('schedule wins over a stale baked deadline when the week is scheduled', () => {
    // A literal date baked onto the row at creation time must NOT drive the
    // cutoff once the schedule says otherwise — this is the regression that
    // forfeited live matches after the dates were corrected. 2026-04-21 is EDT
    // (UTC-4), so local 23:59:59 == 03:59:59 UTC the next day.
    const stale = '2020-01-01T00:00:00.000Z';
    expect(effectiveMatchDeadline({ deadline: stale, week: 1 }, '{"1":"2026-04-21"}'))
      .toBe('2026-04-22T03:59:59.000Z');
  });

  test('falls back to weekDates entry as end-of-day in the league TZ (TZ-DEADLINE)', () => {
    // weekDates is a YYYY-MM-DD per week; the helper resolves 23:59:59 IN the
    // league's timezone. Default is America/New_York; 2026-04-21 is EDT (UTC-4),
    // so local 23:59:59 == 03:59:59 UTC the NEXT day.
    const out = effectiveMatchDeadline(
      { deadline: null, week: 3 },
      '{"3":"2026-04-21"}',
    );
    expect(out).toBe('2026-04-22T03:59:59.000Z');
  });

  test('honors an explicit league timezone for the cutoff', () => {
    // Los Angeles is PDT (UTC-7) on this date → local 23:59:59 == 06:59:59 UTC next day.
    const la = effectiveMatchDeadline(
      { deadline: null, week: 3 },
      '{"3":"2026-04-21"}',
      'America/Los_Angeles',
    );
    expect(la).toBe('2026-04-22T06:59:59.000Z');
    // UTC zone is a no-op offset.
    const utc = effectiveMatchDeadline({ deadline: null, week: 3 }, '{"3":"2026-04-21"}', 'UTC');
    expect(utc).toBe('2026-04-21T23:59:59.000Z');
  });

  test('returns null when deadline is null AND week not in weekDates', () => {
    expect(effectiveMatchDeadline({ deadline: null, week: 99 }, '{"1":"2026-04-21"}'))
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
    // Even with a stored deadline present, a week that appears in the live
    // schedule resolves to the schedule date — so editing weekDates moves it.
    const stored = '2026-04-15T12:00:00.000Z';
    const out = effectiveMatchDeadline(
      { deadline: stored, week: 3 },
      '{"3":"2026-04-21"}',
    );
    expect(out).toBe('2026-04-22T03:59:59.000Z');
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
