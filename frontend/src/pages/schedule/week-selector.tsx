import { cn } from '@/lib/utils';

interface WeekSelectorProps {
  totalWeeks: number;
  currentWeek: number;
  selectedWeek: number;
  onSelectWeek: (week: number) => void;
}

export function WeekSelector({ totalWeeks, currentWeek, selectedWeek, onSelectWeek }: WeekSelectorProps) {
  return (
    <div className="flex gap-1 flex-wrap">
      {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(week => {
        const isSelected = week === selectedWeek;
        const isCurrent = week === currentWeek;
        const isCompleted = week <= currentWeek;

        return (
          <button
            key={week}
            onClick={() => onSelectWeek(week)}
            className={cn(
              'relative px-3 py-1.5 rounded-md text-sm font-medium tabular-nums transition-all duration-150',
              isSelected
                ? 'bg-neon/15 text-neon border border-neon/30 shadow-glow-sm'
                : isCompleted
                  ? 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
                  : 'text-text-muted hover:bg-surface-overlay/50 hover:text-text-secondary',
            )}
          >
            {week}
            {isCurrent && !isSelected && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-neon" />
            )}
          </button>
        );
      })}
    </div>
  );
}
