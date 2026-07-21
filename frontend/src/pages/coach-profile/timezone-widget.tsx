import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { getTimezoneAbbreviation } from '@/lib/format';

/**
 * Small live-ticking clock chip for the profile header — shows the
 * profiled coach's timezone (from their Settings preference) and their
 * current local time, useful for scheduling battles across zones.
 *
 * Renders nothing when the coach never set a zone: `timezone` is
 * server-derived from `userPreferences.timezone`, which is `null` until
 * the user explicitly picks one in Settings. Guessing a zone on their
 * behalf would show a potentially wrong time, which is worse than no
 * widget at all.
 */
export function CoachTimezoneWidget({ timezone }: { timezone?: string | null }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!timezone) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [timezone]);

  if (!timezone) return null;

  let time: string;
  let abbrev: string;
  try {
    time = now.toLocaleTimeString(undefined, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
    abbrev = getTimezoneAbbreviation(now, timezone);
  } catch {
    // Stored zone string no longer resolves — treat like "not set" rather
    // than crash the header on a stale/invalid IANA value.
    return null;
  }

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border-default bg-surface-overlay/40 text-[11px] font-mono text-text-muted"
      title={`Local time · ${timezone}`}
    >
      <Clock size={11} className="shrink-0" />
      <span className="tabular-nums text-text-secondary">{time}</span>
      {abbrev && <span className="uppercase tracking-wider">{abbrev}</span>}
    </div>
  );
}
