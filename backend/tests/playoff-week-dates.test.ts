/**
 * Playoff weeks live past the regular schedule, so `weekDates` never had an
 * entry for them: `scheduleDeadline()` returned null, `effectiveMatchDeadline()`
 * fell through to a `match.deadline` that bracket generation never set, and
 * `runAutoForfeit()` skipped every playoff match forever — the whole
 * `decidePlayoffForfeit` path was dead in production.
 *
 * Bracket generation now continues the league's own cadence onto those weeks.
 */
import { describe, expect, test } from 'bun:test';
import {
  extendWeekDatesForPlayoffs,
  scheduleDeadline,
  effectiveMatchDeadline,
} from '../src/lib/deadline';

// League weeks run Tuesday→Monday.
const REGULAR = { '1': '2026-06-16', '2': '2026-06-23', '3': '2026-06-30' };
const PLAYOFF_WEEKS = [4, 4, 5, 5, 6]; // qf, qf, sf, sf, f — duplicates on purpose

describe('extendWeekDatesForPlayoffs', () => {
  test('continues the weekly cadence onto every playoff week', () => {
    const out = extendWeekDatesForPlayoffs(REGULAR, 3, PLAYOFF_WEEKS);
    expect(out['4']).toBe('2026-07-07');
    expect(out['5']).toBe('2026-07-14');
    expect(out['6']).toBe('2026-07-21');
    // Regular weeks untouched, input not mutated.
    expect(out['3']).toBe('2026-06-30');
    expect(REGULAR['4' as keyof typeof REGULAR]).toBeUndefined();
  });

  test('infers a non-weekly cadence from the last regular gap', () => {
    const biweekly = { '1': '2026-06-16', '2': '2026-06-30' }; // 14-day span
    const out = extendWeekDatesForPlayoffs(biweekly, 2, [3, 4]);
    expect(out['3']).toBe('2026-07-14');
    expect(out['4']).toBe('2026-07-28');
  });

  test('never clobbers a date staff set by hand', () => {
    const manual = { ...REGULAR, '4': '2026-08-01' };
    const out = extendWeekDatesForPlayoffs(manual, 3, [4, 5]);
    expect(out['4']).toBe('2026-08-01');
    expect(out['5']).toBe('2026-07-14'); // still derived from the cadence
  });

  test('no-ops when the final regular week has no date', () => {
    const out = extendWeekDatesForPlayoffs({ '1': '2026-06-16' }, 3, [4]);
    expect(out['4']).toBeUndefined();
  });
});

describe('playoff deadlines resolve once the weeks are dated', () => {
  test('a playoff match gets a real cutoff instead of null', () => {
    const qfWeek = 4;
    const match = { deadline: null, week: qfWeek };

    // Before: no date for week 4 → no deadline → auto-forfeit skips it.
    expect(scheduleDeadline(REGULAR, qfWeek)).toBeNull();
    expect(effectiveMatchDeadline(match, REGULAR)).toBeNull();

    // After: week 4 ends the day before week 5 begins (Mon 2026-07-13).
    const extended = extendWeekDatesForPlayoffs(REGULAR, 3, PLAYOFF_WEEKS);
    const due = effectiveMatchDeadline(match, extended);
    expect(due).not.toBeNull();
    expect(due!.startsWith('2026-07-14')).toBe(true); // 23:59:59 ET → next-day UTC

    // The Final is the last dated week — it still gets a full week.
    const finalDue = effectiveMatchDeadline({ deadline: null, week: 6 }, extended);
    expect(finalDue).not.toBeNull();
    expect(finalDue! > due!).toBe(true);
  });
});
