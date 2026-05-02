import { cn, tierToHslColor } from '@/lib/utils';

interface TierBadgeProps {
  points: number;
  className?: string;
}

function tierHsl(points: number): { bg: string; text: string } {
  const clamped = Math.max(1, Math.min(20, points));
  const hue = Math.round(270 - ((clamped - 1) / 19) * 270);
  const text = (hue >= 40 && hue <= 160) ? '#000' : '#fff';
  return { bg: tierToHslColor(points), text };
}

export function TierBadge({ points, className }: TierBadgeProps) {
  const { bg, text } = tierHsl(points);

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center w-[18px] h-[18px] text-[9px] font-bold tabular-nums leading-none rotate-45',
        className,
      )}
      style={{ backgroundColor: bg, color: text, borderRadius: '2px' }}
    >
      <span className="-rotate-45">{points}</span>
    </span>
  );
}
