import { tierColor } from '@/lib/pokemon';
import { cn } from '@/lib/utils';

interface TierBadgeProps {
  points: number;
  className?: string;
}

export function TierBadge({ points, className }: TierBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-sm px-1.5 py-0.5 text-[11px] font-bold tabular-nums',
        className,
      )}
      style={{
        backgroundColor: tierColor(points),
        color: points >= 14 ? '#000' : '#fff',
      }}
    >
      {points}
    </span>
  );
}
