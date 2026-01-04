import { cn } from '@/lib/utils';

interface PointCapBarProps {
  used: number;
  total?: number;
  className?: string;
}

export function PointCapBar({ used, total = 110, className }: PointCapBarProps) {
  const pct = Math.min((used / total) * 100, 100);
  const remaining = total - used;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex-1 h-2 rounded-full bg-surface-overlay overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            background: pct > 90
              ? 'var(--color-loss)'
              : pct > 70
                ? 'var(--color-draw)'
                : 'var(--color-neon)',
          }}
        />
      </div>
      <span className="text-xs tabular-nums text-text-secondary">
        {used}/{total}
        <span className="text-text-muted ml-1">({remaining} left)</span>
      </span>
    </div>
  );
}
