import { cn } from '@/lib/utils';

interface WeekSelectorProps {
  totalWeeks: number;
  currentWeek: number;
  selectedWeek: number;
  onSelectWeek: (week: number) => void;
  weekDates?: Record<string, string> | null;
}

// The week date is a bare calendar date (no zone). Pin it to noon UTC and
// render in UTC so a far-west viewer never sees it roll back a day (the
// `+'T00:00:00'` local-midnight parse that TZ-DEADLINE warned about).
function formatWeekDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function WeekSelector({ totalWeeks, currentWeek, selectedWeek, onSelectWeek, weekDates }: WeekSelectorProps) {
  return (
    <div className="flex gap-1 flex-wrap">
      {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(week => {
        const isSelected = week === selectedWeek;
        const isCurrent = week === currentWeek;
        const isCompleted = week <= currentWeek;
        const dateStr = weekDates?.[String(week)];

        return (
          <button
            key={week}
            onClick={() => onSelectWeek(week)}
            className={cn(
              'relative px-3 py-1.5 rounded-md font-medium tabular-nums transition-all duration-150 flex flex-col items-center gap-0.5',
              isSelected
                ? 'bg-neon/15 text-neon border border-neon/30 shadow-glow-sm'
                : isCompleted
                  ? 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
                  : 'text-text-muted hover:bg-surface-overlay/50 hover:text-text-secondary',
            )}
          >
            <span className="text-sm">{week}</span>
            {dateStr && (
              <span className={cn(
                'text-[9px] leading-none',
                isSelected ? 'text-neon/70' : 'text-text-muted/60',
              )}>
                {formatWeekDate(dateStr)}
              </span>
            )}
            {isCurrent && !isSelected && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-neon" />
            )}
          </button>
        );
      })}
    </div>
  );
}
