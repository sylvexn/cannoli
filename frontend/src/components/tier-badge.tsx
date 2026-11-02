import { cn } from '@/lib/utils';
import { tierColor } from '@/lib/constants';

interface TierBadgeProps {
  points: number;
  className?: string;
}

/** Tier symbol (1.4): a rounded square with a soft tinted fill, colored edge
 *  and colored number, on the 20-step tier spectrum. */
export function TierBadge({ points, className }: TierBadgeProps) {
  const c = tierColor(points);
  // Low tiers are stone-dark; lift the edge/number so they still read on ink.
  const ink = `oklch(from ${c} max(l, 0.72) c h)`;
  return (
    <span
      title={`Tier ${points}`}
      className={cn(
        'inline-flex items-center justify-center size-[18px] shrink-0 rounded-[4px] font-mono text-[9.5px] font-bold leading-none tabular-nums',
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklab, ${c} 24%, transparent)`,
        boxShadow: `inset 0 0 0 1.25px ${ink}`,
        color: ink,
      }}
    >
      {points}
    </span>
  );
}
