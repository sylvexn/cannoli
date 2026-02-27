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

/** Compact bar for sidebars, popovers, standings rows */
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

/** Large featured bar for team profile page */
export function PointCapBarLarge({ used, total = 110, className }: PointCapBarProps) {
  const pct = Math.min((used / total) * 100, 100);
  const remaining = total - used;
  const palette = pct > 95 ? COLORS.crit : pct > 80 ? COLORS.warn : COLORS.neon;

  // Tick marks at every 10 points
  const ticks = Array.from({ length: Math.floor(total / 10) - 1 }, (_, i) => ((i + 1) * 10 / total) * 100);

  return (
    <div className={cn('flex items-center gap-4', className)}>
      {/* Label — left */}
      <div className="flex flex-col items-end shrink-0">
        <span className="text-[9px] font-semibold text-text-muted uppercase tracking-[0.15em] leading-none">Budget</span>
        <span className="text-lg font-mono font-bold tabular-nums leading-tight" style={{ color: palette.bar }}>
          {used}<span className="text-text-muted/40 text-sm font-normal">/{total}</span>
        </span>
      </div>

      {/* Bar */}
      <div className="flex-1 relative">
        <div className="h-3 rounded-full bg-surface-overlay/80 overflow-hidden relative">
          {/* Fill */}
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${palette.bar}cc, ${palette.bar})`,
              boxShadow: `0 0 12px ${palette.glow}, inset 0 1px 0 rgba(255,255,255,0.15)`,
            }}
          />
          {/* Animated shimmer overlay */}
          <div
            className="absolute inset-y-0 left-0 rounded-full overflow-hidden"
            style={{ width: `${pct}%` }}
          >
            <div
              className="absolute inset-0 animate-shimmer"
              style={{
                background: `linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.08) 55%, transparent 70%)`,
                backgroundSize: '250% 100%',
              }}
            />
          </div>
          {/* Tick marks */}
          {ticks.map(pos => (
            <div
              key={pos}
              className="absolute top-0 bottom-0 w-px"
              style={{
                left: `${pos}%`,
                backgroundColor: pos < pct ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Remaining — right */}
      <div className="flex flex-col items-start shrink-0">
        <span className="text-[9px] font-semibold text-text-muted uppercase tracking-[0.15em] leading-none">Left</span>
        <span className="text-lg font-mono font-bold tabular-nums leading-tight" style={{ color: remaining <= 5 ? palette.bar : 'var(--color-text-secondary)' }}>
          {remaining}
        </span>
      </div>
    </div>
  );
}
