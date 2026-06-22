/**
 * Shared schedule/availability date utilities.
 *
 * The key invariant: when a week's `weekDates` entry is absent (common for
 * live leagues that haven't had dates configured yet), callers get back
 * `date: null` items with generic weekday labels instead of falling back to
 * the current week's real dates — which was the bug that caused every future
 * week to show the same "today's week" columns.
 */

// League weeks run Tuesday → Monday, so a week's days start on Tuesday and the
// final day is Monday. These labels are only used for placeholder (dates-TBD)
// weeks; weeks with a real `weekDates` entry re-derive each column's label from
// the actual calendar date in formatWeekDay().
const WEEKDAY_SHORT = ['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'] as const;

export interface WeekDay {
  /** Real calendar date — null when the week has no configured date. */
  date: Date | null;
  /** Short weekday name: "Mon", "Tue", … "Sun" */
  label: string;
  /**
   * ISO date string (YYYY-MM-DD) used as a stable key and for API calls.
   * When date is null this is a synthetic key like "tbd-0", "tbd-1", …
   */
  key: string;
}

/**
 * Return 7 WeekDay descriptors for `week` in `weekDates`.
 *
 * - If `weekDates[week]` exists: returns real Date objects anchored to that
 *   week-start date (a Tuesday; local midnight).
 * - If absent: returns generic Tue–Mon labels with `date: null`.
 */
export function getWeekDays(
  weekDates: Record<string, string> | null | undefined,
  week: number | string,
): WeekDay[] {
  const dateStr = weekDates?.[String(week)];

  if (dateStr) {
    // Anchor to local midnight so the day never shifts due to timezone.
    const start = new Date(`${dateStr}T00:00:00`);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return {
        date: d,
        label: WEEKDAY_SHORT[i]!,
        key: d.toISOString().slice(0, 10),
      };
    });
  }

  // No date configured — generic Tue-Mon placeholders.
  return WEEKDAY_SHORT.map((label, i) => ({
    date: null,
    label,
    key: `tbd-${i}`,
  }));
}

/**
 * Format a WeekDay for display in a column header.
 *
 * Returns `{ short: string; date: string | null }` where `date` is the
 * formatted calendar date (e.g. "6/16") or null when unknown.
 */
export function formatWeekDay(day: WeekDay): { short: string; date: string | null } {
  if (day.date === null) {
    return { short: day.label, date: null };
  }
  return {
    short: day.date.toLocaleDateString('en-US', { weekday: 'short' }),
    date: day.date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
  };
}

/**
 * Returns true when the selected week has no configured date, so callers can
 * render a "Dates TBD" notice without computing weekDays themselves.
 */
export function weekHasDates(
  weekDates: Record<string, string> | null | undefined,
  week: number | string,
): boolean {
  return !!weekDates?.[String(week)];
}
