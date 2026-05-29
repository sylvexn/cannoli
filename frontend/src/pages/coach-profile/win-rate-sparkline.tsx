import { TrendingUp } from 'lucide-react';
import type { CoachResult } from './use-coach-extras';

interface WinRateSparklineProps {
  /** All recorded results, oldest → newest. We slice to the trailing window. */
  results: CoachResult[];
  /** How many trailing matches to plot. Defaults to 12. */
  window?: number;
  /** Stroke + dot color for the polyline. */
  color: string;
}

const WIDTH = 120;
const HEIGHT = 28;
const PADDING_X = 2;
const PADDING_Y = 3;

/**
 * Cumulative win-rate sparkline. Plots running W% across the trailing N
 * matches as a single inline SVG polyline. Each result is a step on the X
 * axis; Y is the running win rate (0 → 1) anchored to the same scale across
 * the whole line so a flat polyline genuinely means "stable rate".
 *
 * Emits a themed empty state when there's no match history yet (handled
 * by the parent — this component only renders the chart).
 */
export function WinRateSparkline({ results, window = 12, color }: WinRateSparklineProps) {
  // Use the trailing `window` results so the sparkline tracks recent form
  // rather than blurring against a long career average.
  const tail = results.slice(-window);

  // Cumulative win rate at each step (post-match), 0..1.
  const points: { x: number; y: number; result: 'W' | 'L' }[] = [];
  let wins = 0;
  for (let i = 0; i < tail.length; i++) {
    if (tail[i].result === 'W') wins += 1;
    const rate = wins / (i + 1);
    const x =
      PADDING_X +
      (tail.length === 1
        ? (WIDTH - PADDING_X * 2) / 2
        : (i / (tail.length - 1)) * (WIDTH - PADDING_X * 2));
    // Invert: SVG y grows downward; high win-rate sits at the top.
    const y = PADDING_Y + (1 - rate) * (HEIGHT - PADDING_Y * 2);
    points.push({ x, y, result: tail[i].result });
  }

  const pathData = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const finalRate = tail.length > 0 ? wins / tail.length : 0;
  const lastResult = tail[tail.length - 1]?.result;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 min-w-0">
        <TrendingUp size={11} className="text-text-muted shrink-0" />
        <dt className="text-[10px] font-mono uppercase tracking-wider text-text-muted truncate">
          Form (last {tail.length})
        </dt>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          aria-label={`Win rate over the last ${tail.length} matches: ${(finalRate * 100).toFixed(0)} percent`}
          className="overflow-visible"
        >
          {/* Mid line at 50% — sets the visual anchor for above/below average. */}
          <line
            x1={PADDING_X}
            x2={WIDTH - PADDING_X}
            y1={HEIGHT / 2}
            y2={HEIGHT / 2}
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-border-subtle"
            strokeDasharray="2 2"
          />
          {tail.length >= 2 && (
            <polyline
              points={pathData}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {/* Per-match dots — small enough to read as "ticks", large enough
              that a single result still renders meaningfully. */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={i === points.length - 1 ? 2 : 1.25}
              fill={p.result === 'W' ? color : 'rgba(255,255,255,0.25)'}
              stroke={i === points.length - 1 ? color : 'none'}
              strokeWidth={i === points.length - 1 ? 0.75 : 0}
            />
          ))}
        </svg>
        <span
          className="text-sm font-bold tabular-nums"
          style={{ color: lastResult ? color : undefined }}
        >
          {(finalRate * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
