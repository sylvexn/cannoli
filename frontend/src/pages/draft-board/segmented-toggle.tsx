import { cn } from '@/lib/utils';

/** Simple segmented toggle button group used by the draft top bar. */
export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode; activeClass?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border-default overflow-hidden">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors',
            value === opt.value
              ? opt.activeClass ?? 'bg-surface-overlay text-text-primary'
              : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
