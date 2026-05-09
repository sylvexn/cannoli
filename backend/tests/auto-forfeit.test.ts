/**
 * Tests for the auto-forfeit job's deadline-resolution helper.
 *
 * The full job is exercised via integration but the deadline-fallback logic
 * is the load-bearing piece for "regular-season `scheduled` matches at
 * week-end" — without it, matches whose `deadline` column is null (older
 * data, manual inserts) silently slip past the forfeit policy.
 */
import { describe, expect, test } from 'bun:test';
import { effectiveMatchDeadline } from '../src/lib/jobs/auto-forfeit';

describe('effectiveMatchDeadline', () => {
  test('uses match.deadline when set (round-trips ISO)', () => {
    const iso = '2026-04-15T03:00:00.000Z';
    expect(effectiveMatchDeadline({ deadline: iso, week: 1 }, '{"1":"2026-01-01"}'))
      .toBe(iso);
  });

  test('falls back to weekDates entry when match.deadline is null', () => {
    // weekDates is a YYYY-MM-DD per week; the helper appends 23:59:59 UTC.
    const out = effectiveMatchDeadline(
      { deadline: null, week: 3 },
      '{"3":"2026-04-21"}',
    );
    expect(out).toBe('2026-04-21T23:59:59.000Z');
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
