/**
 * MiniSpark — tiny inline bar sparkline rendered with pure CSS/flex divs.
 * No chart library. Bars represent normalized values (oldest→newest).
 * Accepts a `color` Tailwind class string applied to each bar.
 */

import { cn } from '@/lib/utils';

interface MiniSparkProps {
  /** Values oldest→newest. */
  values: number[];
  /** Tailwind bg-* class for the bars, e.g. "bg-loss/60". */
  colorClass?: string;
  className?: string;
  /** Height of the sparkline container in px. Default 20. */
  height?: number;
}

export function MiniSpark({
  values,
  colorClass = 'bg-neon/60',
  className,
  height = 20,
}: MiniSparkProps) {
  if (!values.length) return null;

  const max = Math.max(...values, 1);

  return (
    <div
      className={cn('flex items-end gap-px shrink-0', className)}
      style={{ height }}
      aria-hidden
    >
      {values.map((v, i) => {
        const pct = Math.max(2, Math.round((v / max) * 100));
        return (
          <div
            key={i}
            className={cn('w-1 rounded-sm', colorClass)}
            style={{ height: `${pct}%` }}
          />
        );
      })}
    </div>
  );
}

/**
 * DualSpark — overlapping bars for errors vs total.
 * Total is grey, errors are loss-red. Both normalized to the same scale.
 */
interface DualSparkProps {
  buckets: { total: number; errors: number }[];
  className?: string;
  height?: number;
}

export function DualSpark({ buckets, className, height = 28 }: DualSparkProps) {
  if (!buckets.length) return null;

  const maxTotal = Math.max(...buckets.map(b => b.total), 1);

  return (
    <div
      className={cn('flex items-end gap-px shrink-0', className)}
      style={{ height }}
      aria-hidden
    >
      {buckets.map((b, i) => {
        const totalPct = Math.max(2, Math.round((b.total / maxTotal) * 100));
        const errPct = b.total > 0 ? Math.round((b.errors / b.total) * totalPct) : 0;
        return (
          <div
            key={i}
            className="relative w-1.5"
            style={{ height: `${totalPct}%` }}
          >
            {/* total bar */}
            <div className="absolute inset-0 rounded-sm bg-text-muted/20" />
            {/* error overlay */}
            {errPct > 0 && (
              <div
                className="absolute bottom-0 left-0 right-0 rounded-sm bg-loss/70"
                style={{ height: `${errPct}%` }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
