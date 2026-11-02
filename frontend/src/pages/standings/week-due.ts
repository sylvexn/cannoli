import type { League } from '@/lib/types';
import { endOfDayInZone } from '@/lib/format';

/** End of a league week (start date + 6 days, 23:59:59 in the league zone), or
 *  null when the week has no configured start date. */
export function weekDueInstant(league: League, week: number): Date | null {
  const start = league.season.weekDates?.[String(week)];
  if (!start) return null;
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return endOfDayInZone(d.toISOString().slice(0, 10), league.timezone ?? 'America/New_York');
}
