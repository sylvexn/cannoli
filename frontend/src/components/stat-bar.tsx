import { cn } from '@/lib/utils';

interface StatBarProps {
  label: string;
  value: number;
  max?: number;
  className?: string;
}

function statColor(value: number): string {
  if (value >= 130) return '#4ade80';
  if (value >= 100) return '#86efac';
  if (value >= 80) return '#a3e635';
  if (value >= 60) return '#fbbf24';
  return '#f87171';
}

export function StatBar({ label, value, max = 255, className }: StatBarProps) {
  const pct = Math.min((value / max) * 100, 100);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="w-8 text-[10px] font-bold text-text-muted uppercase">{label}</span>
      <span className="w-8 text-right text-xs tabular-nums font-medium text-text-primary">{value}</span>
      <div className="flex-1 h-1.5 rounded-full bg-surface-overlay overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: statColor(value) }}
        />
      </div>
    </div>
  );
}
