/**
 * Shared formatting helpers used across the design pass surfaces
 * (CoachLink hover card, activity feed, replay glance lines, etc).
 */

/** Compact relative time: "12s", "4m", "3h", "2d", "5w", "Mar 4". */
export function formatRelativeTime(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
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

  // Older than ~a month — show a short absolute date, no year
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
 */
export function formatTimestamp(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const datePart = date.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${datePart} ${timePart}`;
}
