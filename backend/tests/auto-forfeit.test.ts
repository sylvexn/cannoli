/**
 * Tests for the auto-forfeit job's deadline-resolution helper.
 *
 * The full job is exercised via integration but the deadline-fallback logic
 * is the load-bearing piece for "regular-season `scheduled` matches at
 * week-end" — without it, matches whose `deadline` column is null (older
 * data, manual inserts) silently slip past the forfeit policy.
 */
import { describe, expect, test } from 'bun:test';
import { effectiveMatchDeadline, endOfDayInZone } from '../src/lib/jobs/auto-forfeit';

describe('effectiveMatchDeadline', () => {
  test('uses match.deadline when set (round-trips ISO)', () => {
    const iso = '2026-04-15T03:00:00.000Z';
    expect(effectiveMatchDeadline({ deadline: iso, week: 1 }, '{"1":"2026-01-01"}'))
      .toBe(iso);
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

  test('explicit deadline wins even when weekDates also has the week', () => {
    const explicit = '2026-04-15T12:00:00.000Z';
    const out = effectiveMatchDeadline(
      { deadline: explicit, week: 3 },
      '{"3":"2026-12-31"}',
    );
    expect(out).toBe(explicit);
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
