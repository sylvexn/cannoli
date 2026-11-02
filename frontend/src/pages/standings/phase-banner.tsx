import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague } from '@/lib/league-context';
import { formatDeadline, useUserTimezone } from '@/lib/format';
import { weekDueInstant } from './week-due';

function Box({ n, unit }: { n: number; unit: string }) {
  return (
    <div className="flex flex-col items-center rounded-md border border-border-subtle bg-surface px-2 py-1 min-w-[46px]">
      <span className="font-mono text-lg font-semibold leading-none tabular-nums text-text-primary">
        {String(n).padStart(2, '0')}
      </span>
      <span className="text-[10px] text-text-muted mt-0.5">{unit}</span>
    </div>
  );
}

/** Current-week due countdown (+ trade-deadline note). Renders nothing when the
 *  week has no configured dates or is already past. */
export function PhaseBanner() {
  const league = useLeague();
  const tz = useUserTimezone();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { phase, currentWeek, tradeDeadlineWeek } = league.season;
  if ((phase === 'draft' || phase === 'playoffs') && !league.season.archived) {
    const draft = phase === 'draft';
    return (
      <div className="relative flex items-center justify-between gap-4 flex-wrap rounded-md border border-border-subtle bg-surface-raised pl-5 pr-3 py-2.5 overflow-hidden">
        <span className="absolute left-0 inset-y-0 w-1 bg-gem" aria-hidden />
        <div className="font-display text-lg leading-tight text-text-primary">{draft ? 'Draft live' : 'Playoffs'}</div>
        <Link
          to={`/league/${league.id}/${draft ? 'draft' : 'schedule'}`}
          className="text-sm text-gem-ink hover:underline px-2 py-1.5"
        >
          {draft ? 'Open draft room' : 'View bracket'}
        </Link>
      </div>
    );
  }
  if (phase !== 'regular') return null;
  const due = weekDueInstant(league, currentWeek);
  if (!due) return null;
  const ms = due.getTime() - now;
  if (ms <= 0) return null;

  const mins = Math.floor(ms / 60_000);
  const tradeNote = tradeDeadlineWeek === currentWeek
    ? 'Trade deadline this week'
    : tradeDeadlineWeek > currentWeek ? `Trade deadline: week ${tradeDeadlineWeek}` : null;

  return (
    <div className="relative flex items-center justify-between gap-4 flex-wrap rounded-md border border-border-subtle bg-surface-raised pl-5 pr-3 py-2.5 overflow-hidden">
      <span className="absolute left-0 inset-y-0 w-1 bg-gem" aria-hidden />
      <div className="min-w-0">
        <div className="font-display text-lg leading-tight text-text-primary">Week {currentWeek} is due</div>
        <div className="text-xs text-text-muted">
          {formatDeadline(due, tz)}{tradeNote ? ` · ${tradeNote}` : ''}
        </div>
      </div>
      <div className="flex gap-1.5 shrink-0" role="timer" aria-label="Time until week is due">
        <Box n={Math.floor(mins / 1440)} unit="days" />
        <Box n={Math.floor((mins % 1440) / 60)} unit="hrs" />
        <Box n={mins % 60} unit="min" />
      </div>
    </div>
  );
}
