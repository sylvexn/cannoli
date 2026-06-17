/**
 * Match-deadline derivation — the ONE place that turns a league's SCHEDULE
 * (its `weekDates` map) into a concrete cutoff timestamp.
 *
 * The schedule is the source of truth. A match's deadline is whatever its week
 * resolves to in the league's live `weekDates`, evaluated as end-of-day in the
 * league timezone. We deliberately do NOT trust a date baked onto the match row
 * at creation time: regenerating or editing the schedule must move the deadline,
 * and a stale literal value (e.g. an old date entered before the dates were
 * corrected) must never drive an auto-forfeit. The stored `match.deadline` is
 * only a fallback for matches whose week has no scheduled date — playoff weeks
 * (which live past the regular schedule) and any manually-created fixture.
 */

/**
 * Resolve "end of day (23:59:59) on `dateStr` (YYYY-MM-DD) in IANA `timeZone`"
 * to a UTC ISO timestamp. We can't just append 'T23:59:59Z' (that's UTC
 * midnight-minus-1s, not the league's local end-of-day) nor a fixed offset
 * (DST changes it). Instead we ask Intl what wall-clock time the zone shows
 * for a candidate UTC instant, derive the zone's offset for that date, and
 * back the UTC instant out of the desired local time. One iteration is enough
 * for the once-a-day boundary we care about.
 */
export function endOfDayInZone(dateStr: string, timeZone: string): string {
  // Desired local wall-clock: dateStr 23:59:59.
  const [y, m, d] = dateStr.split('-').map(Number);
  const desiredLocalMs = Date.UTC(y, m - 1, d, 23, 59, 59);

  // Offset (minutes) the zone is ahead of UTC, computed at the candidate
  // instant. tzOffset = localWallClock - utc.
  function offsetMinutes(utcMs: number): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
    let hour = get('hour');
    if (hour === 24) hour = 0; // some engines render midnight as 24
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
    return Math.round((asUtc - utcMs) / 60000);
  }

  // First guess: treat the desired local time as if it were UTC, find the
  // zone's offset there, then correct. Re-derive the offset at the corrected
  // instant to handle the rare case the first guess straddled a DST change.
  let utcMs = desiredLocalMs - offsetMinutes(desiredLocalMs) * 60000;
  utcMs = desiredLocalMs - offsetMinutes(utcMs) * 60000;
  return new Date(utcMs).toISOString();
}

/**
 * The deadline a given week resolves to under the league's live schedule, as an
 * ISO timestamp (end-of-day in the league timezone). Returns null when the week
 * has no scheduled date — e.g. playoff weeks, which sit beyond the regular
 * `weekDates` map. `weekDates` may be passed as the raw JSON string off the
 * league row or as an already-parsed map.
 */
export function scheduleDeadline(
  weekDates: string | Record<string, string> | null | undefined,
  week: number,
  timeZone: string = 'America/New_York',
): string | null {
  if (!weekDates) return null;
  try {
    const map = typeof weekDates === 'string'
      ? (JSON.parse(weekDates) as Record<string, string>)
      : weekDates;
    const dateStr = map[String(week)];
    if (!dateStr) return null;
    return endOfDayInZone(dateStr, timeZone);
  } catch {
    return null;
  }
}

/**
 * The effective deadline a forfeit decision uses for a match. Schedule-first:
 * if the match's week has a scheduled date, that (end-of-day, league timezone)
 * is the deadline — so correcting the schedule moves it and a stale baked value
 * is ignored. Only when the week has no scheduled date do we fall back to the
 * deadline stored on the match row (playoffs / manual fixtures).
 *
 * Returns an ISO timestamp or null if no deadline can be derived.
 */
export function effectiveMatchDeadline(
  match: { deadline: string | null; week: number },
  weekDates: string | Record<string, string> | null | undefined,
  timeZone: string = 'America/New_York',
): string | null {
  const scheduled = scheduleDeadline(weekDates, match.week, timeZone);
  if (scheduled) return scheduled;
  return match.deadline;
}
