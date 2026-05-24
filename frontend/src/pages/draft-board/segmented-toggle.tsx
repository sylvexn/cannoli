import { cn } from '@/lib/utils';

/**
 * Simple segmented toggle button group used across draft-board chrome
 * (mode, view, density). Kept tiny and headless so callers control labels,
 * icons, and the active-state colour per option.
 */
export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode; activeClass?: string; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  const sizing = size === 'sm'
    ? 'px-1.5 py-0.5 text-[10px] gap-0.5'
    : 'px-2.5 py-1 text-xs gap-1';
  return (
    <div className="flex rounded-lg border border-border-default overflow-hidden">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          title={opt.title}
          className={cn(
            'flex items-center font-medium transition-colors',
            sizing,
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
