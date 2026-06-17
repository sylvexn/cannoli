import { Button } from '@/components/ui/button';
import { Calendar } from 'lucide-react';

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Calendar-date input (YYYY-MM-DD), no time component. We anchor to local
// midnight and format directly — this is a pure date marker, not a moment
// in time, so no zone conversion happens (and we deliberately don't attach
// a tz suffix because there's no instant the suffix could refer to).
export function formatShortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ScheduleDatesStep({
  totalWeeks,
  weekDates,
  setWeekDates,
  leagues = [],
  draftDates = {},
  setDraftDates,
}: {
  totalWeeks: number;
  weekDates: Record<string, string>;
  setWeekDates: (next: Record<string, string>) => void;
  /** Included leagues — used to render per-league draft datetime pickers */
  leagues?: { id: string; name: string; color: string }[];
  draftDates?: Record<string, string>;
  setDraftDates?: (next: Record<string, string>) => void;
}) {
  const week1 = weekDates['1'] ?? '';

  function setWeek(week: number, date: string) {
    const next = { ...weekDates };
    if (date) next[String(week)] = date;
    else delete next[String(week)];
    setWeekDates(next);
  }

  function fillRest() {
    if (!week1) return;
    const next: Record<string, string> = { '1': week1 };
    for (let w = 2; w <= totalWeeks; w++) {
      next[String(w)] = addDays(week1, (w - 1) * 7);
    }
    setWeekDates(next);
  }

  function clearAll() {
    setWeekDates({});
  }

  const filledCount = Object.keys(weekDates).filter(k => weekDates[k]).length;

  function setDraftDate(leagueId: string, value: string) {
    if (!setDraftDates) return;
    const next = { ...draftDates };
    if (value) next[leagueId] = value;
    else delete next[leagueId];
    setDraftDates(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        Set the date each week ends. Auto-forfeit and auto-week-advance jobs use these to fire on time.
      </p>

      {/* Per-league draft datetime pickers — drives the predraft → draft auto-advance */}
      {leagues.length > 0 && setDraftDates && (
        <div className="rounded-lg border border-border bg-surface-overlay p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-pink shrink-0" />
            <span className="text-xs font-medium text-text-primary">Draft dates (per league)</span>
          </div>
          <div className="space-y-1">
            {leagues.map(l => (
              <div key={l.id} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                <span className="text-xs text-text-primary w-32 shrink-0 truncate">{l.name}</span>
                <input
                  type="datetime-local"
                  value={draftDates[l.id] ?? ''}
                  onChange={e => setDraftDate(l.id, e.target.value)}
                  className="flex-1 h-7 px-2 rounded border border-border bg-surface-base text-text-primary text-[11px] font-mono outline-none transition-colors focus:border-pink/60 [color-scheme:dark]"
                />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-text-muted">
            Optional — leagues without a draft date won't be auto-advanced from predraft.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface-overlay p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-pink shrink-0" />
          <label className="text-xs text-text-muted shrink-0">Week 1 date</label>
          <input
            type="date"
            value={week1}
            onChange={e => setWeek(1, e.target.value)}
            className="flex h-8 rounded-md border border-border bg-surface-base px-2 py-1 text-xs text-text-primary outline-none transition-colors focus:border-pink/60 [color-scheme:dark]"
          />
          <Button
            size="xs"
            variant="outline"
            onClick={fillRest}
            disabled={!week1}
            className="ml-auto"
          >
            Fill rest weekly
          </Button>
        </div>
        <p className="text-[10px] text-text-muted">
          Click "Fill rest weekly" to auto-populate weeks 2–{totalWeeks} as +7 day increments. You can edit any week after.
        </p>
      </div>

      <div className="max-h-64 overflow-y-auto pr-1 space-y-1">
        {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(week => {
          const value = weekDates[String(week)] ?? '';
          return (
            <div key={week} className="flex items-center gap-3 px-2 py-1.5 rounded border border-border-subtle">
              <span className="text-xs font-mono text-text-muted w-12 shrink-0">W{week}</span>
              <input
                type="date"
                value={value}
                onChange={e => setWeek(week, e.target.value)}
                className="flex h-7 flex-1 rounded-md border border-border bg-surface-base px-2 py-1 text-xs text-text-primary outline-none transition-colors focus:border-pink/60 [color-scheme:dark]"
              />
              <span className="text-[10px] text-text-muted w-16 text-right">
                {value ? formatShortDate(value) : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[10px] text-text-muted">
        <span>{filledCount} of {totalWeeks} weeks set</span>
        {filledCount > 0 && (
          <button onClick={clearAll} className="hover:text-loss transition-colors">Clear all</button>
        )}
      </div>
    </div>
  );
}
