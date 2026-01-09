import { cn } from '@/lib/utils';

interface PointCapBarProps {
  used: number;
  total?: number;
  className?: string;
}

const COLORS = {
  neon: { bar: '#22d3ee', glow: 'rgba(34, 211, 238, 0.25)' },
  warn: { bar: '#fbbf24', glow: 'rgba(251, 191, 36, 0.25)' },
  crit: { bar: '#f87171', glow: 'rgba(248, 113, 113, 0.3)' },
};

export function PointCapBar({ used, total = 110, className }: PointCapBarProps) {
  const pct = Math.min((used / total) * 100, 100);
  const remaining = total - used;
  const palette = pct > 95 ? COLORS.crit : pct > 80 ? COLORS.warn : COLORS.neon;

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="flex-1 h-1.5 rounded-full bg-surface-overlay/80 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: palette.bar,
            boxShadow: pct > 80 ? `0 0 8px ${palette.glow}` : 'none',
          }}
        />
      </div>
      <span className="text-[11px] font-mono tabular-nums text-text-secondary font-medium shrink-0">
        <span style={{ color: palette.bar }}>{used}</span>
        <span className="text-text-muted">/{total}</span>
        {remaining > 0 && <span className="text-text-muted/60 ml-1 text-[10px]">{remaining} left</span>}
      </span>
    </div>
  );
}
