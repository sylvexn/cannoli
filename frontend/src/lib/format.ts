/**
 * Shared formatting helpers used across the design pass surfaces
 * (CoachLink hover card, activity feed, replay glance lines, etc).
 *
 * Timezone strategy
 * -----------------
 * Storage is always ISO/UTC. Display routes through these helpers, which
 * accept an optional `tz` (an IANA zone string). The React-side hooks
 * (`useFormatDateTime`, etc.) read the active user zone from the auth
 * context and pass it in. Pure callers (non-React, e.g. timer ticks) can
 * fall back to the browser default by passing nothing.
 *
 * `tzSuffix` is opt-in: set it on cross-timezone-coordinated displays
 * (draft start time, scheduled events) and leave it off for log lines.
 */

import { useMemo } from 'react';
import { useAuth } from './auth-context';

type DateInput = string | number | Date;

interface FormatDateTimeOpts {
  tz?: string;
  /** 'auto' (default): hide year if same as today's year. */
  year?: 'auto' | 'show' | 'hide';
  /** Append a short TZ token like "EDT". */
  tzSuffix?: boolean;
  /** 24-hour clock (default true to match the existing dense look). */
  hour24?: boolean;
}

interface FormatDateOpts {
  tz?: string;
  year?: 'auto' | 'show' | 'hide';
}

interface FormatTimeOpts {
  tz?: string;
  tzSuffix?: boolean;
  hour24?: boolean;
}

/**
 * Parse a stored timestamp into a Date. SQLite's `datetime('now')` default
 * (used for `created_at` and friends) emits "YYYY-MM-DD HH:MM:SS" — UTC, but
 * with a space separator and NO zone marker, which `new Date()` reinterprets as
 * *local* time (so the rendered clock is off by the viewer's UTC offset). Treat
 * that — and any ISO string lacking a trailing Z / ±HH:MM — as UTC, matching the
 * "storage is always UTC" contract. Numbers and Date objects pass through.
 */
export function parseTimestamp(input: DateInput): Date {
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  const s = input.trim();
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasZone && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    return new Date(s.replace(' ', 'T') + 'Z');
  }
  return new Date(s);
}

function toDate(input: DateInput): Date {
  return parseTimestamp(input);
}

/** Pluck the short TZ token (e.g. "EDT") for a given moment + zone. */
export function getTimezoneAbbreviation(date: Date, tz?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(date);
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/**
 * Resolve "end of day (23:59:59) on `dateStr` (YYYY-MM-DD) in IANA `timeZone`"
 * to a real Date (UTC instant). MUST mirror the backend's `endOfDayInZone`
 * (auto-forfeit.ts) exactly so the displayed cutoff equals the enforced one.
 * Appending 'T23:59:59' and letting the browser parse as local would
 * reintroduce the local-midnight bug for viewers outside the league zone.
 */
export function endOfDayInZone(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const desiredLocalMs = Date.UTC(y, m - 1, d, 23, 59, 59);

  function offsetMinutes(utcMs: number): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
    let hour = get('hour');
    if (hour === 24) hour = 0;
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
    return Math.round((asUtc - utcMs) / 60000);
  }

  let utcMs = desiredLocalMs - offsetMinutes(desiredLocalMs) * 60000;
  utcMs = desiredLocalMs - offsetMinutes(utcMs) * 60000;
  return new Date(utcMs);
}

/**
 * Format a week-end / match deadline for display. The instant is anchored to
 * the league's timezone (cutoff) but RENDERED in the viewer's zone with a TZ
 * label — e.g. "Sun 11:59 PM EDT". Pass the viewer's `tz`.
 */
export function formatDeadline(instant: Date, tz?: string): string {
  const day = instant.toLocaleDateString(undefined, { weekday: 'short', timeZone: tz });
  const time = instant.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const abbr = getTimezoneAbbreviation(instant, tz);
  return `${day} ${time}${abbr ? ` ${abbr}` : ''}`;
}

function pickYearOpt(date: Date, mode: 'auto' | 'show' | 'hide' = 'auto'): 'numeric' | undefined {
  if (mode === 'show') return 'numeric';
  if (mode === 'hide') return undefined;
  return date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
}

/** Full date + time. Default: short month, day, [year if not current], 24h time. */
export function formatDateTime(input: DateInput, opts: FormatDateTimeOpts = {}): string {
  const date = toDate(input);
  const { tz, year = 'auto', tzSuffix = false, hour24 = true } = opts;
  const yearOpt = pickYearOpt(date, year);
  const datePart = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(yearOpt ? { year: yearOpt } : {}),
    timeZone: tz,
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !hour24,
    timeZone: tz,
  });
  const suffix = tzSuffix ? ` ${getTimezoneAbbreviation(date, tz)}` : '';
  return `${datePart} ${timePart}${suffix}`;
}

/** Date only (no time). */
export function formatDate(input: DateInput, opts: FormatDateOpts = {}): string {
  const date = toDate(input);
  const { tz, year = 'auto' } = opts;
  const yearOpt = pickYearOpt(date, year);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(yearOpt ? { year: yearOpt } : {}),
    timeZone: tz,
  });
}

/** Time only. */
export function formatTime(input: DateInput, opts: FormatTimeOpts = {}): string {
  const date = toDate(input);
  const { tz, tzSuffix = false, hour24 = true } = opts;
  const timePart = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !hour24,
    timeZone: tz,
  });
  const suffix = tzSuffix ? ` ${getTimezoneAbbreviation(date, tz)}` : '';
  return `${timePart}${suffix}`;
}

/** Compact relative time: "12s", "4m", "3h", "2d", "5w", "Mar 4". */
export function formatRelativeTime(input: DateInput, opts: { tz?: string } = {}): string {
  const date = toDate(input);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.round(diffMs / 1000);

  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  const diffWeek = Math.round(diffDay / 7);
  if (diffWeek < 4) return `${diffWeek}w ago`;

  // Older than ~a month — short absolute date in the user's zone.
  return formatDate(date, { tz: opts.tz, year: 'hide' });
}

/**
 * Format an "on the clock" / picker phrase for the draft + activity feed:
 *   formatVerbosePicker('Sylvex', { teamAbbrev: 'INF', pickNumber: 24 })
 *     → "Sylvex (INF) — Pick #24"
 */
export function formatVerbosePicker(
  username: string,
  opts: { teamAbbrev?: string | null; pickNumber?: number | null } = {},
): string {
  const team = opts.teamAbbrev ? ` (${opts.teamAbbrev})` : '';
  const pick = opts.pickNumber != null ? ` — Pick #${opts.pickNumber}` : '';
  return `${username}${team}${pick}`;
}

/** Compact tenure label for profile / hover card: "joined S6". */
export function formatTenure(joinedSeasonNumber: number | null | undefined): string | null {
  if (joinedSeasonNumber == null) return null;
  return `joined S${joinedSeasonNumber}`;
}

/** Compact W-L record string. */
export function formatRecord(wins: number, losses: number, draws = 0): string {
  return draws > 0 ? `${wins}-${losses}-${draws}` : `${wins}-${losses}`;
}

/**
 * Dense full-date + time stamp for admin tables — short month, no year if
 * current year, 24-hour time. Use this instead of `new Date(x).toLocaleString()`
 * across admin surfaces so the date format stays consistent.
 *
 * Now timezone-aware via the optional second arg; legacy callers that pass a
 * single argument continue to work and render in the browser zone.
 */
export function formatTimestamp(input: DateInput, opts: { tz?: string } = {}): string {
  return formatDateTime(input, { tz: opts.tz });
}

// React hooks
//
// These read the active user zone from the auth context once and return
// stable formatter functions. Components call e.g.
//   const fmt = useFormatDateTime();
//   <span>{fmt(match.startedAt, { tzSuffix: true })}</span>
// without having to pipe `tz` through every prop.

/** The active IANA zone — explicit user pref or browser default. */
export function useUserTimezone(): string {
  const { userTimezone } = useAuth();
  return userTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function useFormatDateTime() {
  const tz = useUserTimezone();
  return useMemo(
    () => (input: DateInput, opts: Omit<FormatDateTimeOpts, 'tz'> = {}) =>
      formatDateTime(input, { ...opts, tz }),
    [tz],
  );
}

export function useFormatDate() {
  const tz = useUserTimezone();
  return useMemo(
    () => (input: DateInput, opts: Omit<FormatDateOpts, 'tz'> = {}) =>
      formatDate(input, { ...opts, tz }),
    [tz],
  );
}

export function useFormatTime() {
  const tz = useUserTimezone();
  return useMemo(
    () => (input: DateInput, opts: Omit<FormatTimeOpts, 'tz'> = {}) =>
      formatTime(input, { ...opts, tz }),
    [tz],
  );
}

export function useFormatTimestamp() {
  const tz = useUserTimezone();
  return useMemo(
    () => (input: DateInput) => formatTimestamp(input, { tz }),
    [tz],
  );
}

export function useFormatRelativeTime() {
  const tz = useUserTimezone();
  return useMemo(
    () => (input: DateInput) => formatRelativeTime(input, { tz }),
    [tz],
  );
}
