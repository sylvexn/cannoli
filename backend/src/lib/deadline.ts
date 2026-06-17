/**
 * Match-deadline derivation — the ONE place that turns a league's SCHEDULE
 * (its `weekDates` map) into a concrete cutoff timestamp.
 *
 * `weekDates[w]` is the date week `w` BEGINS (this is exactly how the
 * advance-week job reads it: the league stays in week W until weekDates[W+1]
 * arrives). So a week W match is due at the END of its week — the moment week
 * W+1 begins — NOT on week W's own start date. We anchor the cutoff to the end
 * of the day BEFORE the next week starts (e.g. week 1 starting Mon 06-15 with
 * week 2 on Mon 06-22 is due end of Sun 06-21), evaluated in the league
 * timezone. This keeps auto-forfeit consistent with advance-week and gives
 * coaches their whole week to play.
 *
 * The schedule is the source of truth. We deliberately do NOT trust a date
 * baked onto the match row at creation time: editing the schedule must move the
 * deadline, and a stale literal value must never drive an auto-forfeit. The
 * stored `match.deadline` is only a fallback for matches whose week has no
 * scheduled date — playoff weeks (past the regular schedule) and manual rows.
 */

/** Shift a YYYY-MM-DD date string by `days` (date-only UTC math, no TZ drift). */
function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

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
 * The deadline a given week resolves to under the league's live schedule: the
 * END of that week (end-of-day the day before the next week begins), as an ISO
 * timestamp in the league timezone. For the final scheduled week (no next-week
 * date) the week length is inferred from the previous gap (default 7 days).
 * Returns null when the week itself has no scheduled date — e.g. playoff weeks,
 * which sit beyond the regular `weekDates` map. `weekDates` may be passed as the
 * raw JSON string off the league row or as an already-parsed map.
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

    const nextStart = map[String(week + 1)];
    if (nextStart) {
      // Week ends the day before the next week begins.
      return endOfDayInZone(shiftDateStr(nextStart, -1), timeZone);
    }

    const thisStart = map[String(week)];
    if (!thisStart) return null;

    // Final week (or a gap in the map): give a full week from this week's
    // start, inferring the span from the previous week's gap (default 7).
    const prevStart = map[String(week - 1)];
    let span = 7;
    if (prevStart) {
      const days = (Date.parse(thisStart) - Date.parse(prevStart)) / 86400000;
      if (Number.isFinite(days) && days > 0) span = Math.round(days);
    }
    return endOfDayInZone(shiftDateStr(thisStart, span - 1), timeZone);
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
