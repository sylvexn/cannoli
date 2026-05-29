import type { ApiActivityEvent } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

interface RecentHighlightsProps {
  events: ApiActivityEvent[];
  /** Accent color — drives the left rail of each card. */
  accent: string;
}

/** Map activity category → soft accent. Falls back to the coach color. */
function categoryAccent(category: string, fallback: string): string {
  switch (category) {
    case 'matches': return '#22c55e';   // green — wins / completions
    case 'trades':  return '#a78bfa';   // purple — trades
    case 'draft':   return '#facc15';   // amber — picks
    case 'admin':   return '#fb7185';   // rose — admin actions
    default:        return fallback;
  }
}

/**
 * Top 1-3 most recent activity events, rendered as larger highlighted cards.
 * Sits above the long-tail Wall list. Each card shows a single sentence
 * (the existing description text) plus relative time, with a left-rail
 * accent keyed off the event's category.
 */
export function RecentHighlights({ events, accent }: RecentHighlightsProps) {
  const top = events.slice(0, 3);
  if (top.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {top.map(e => {
        const tone = categoryAccent(e.category, accent);
        return (
          <div
            key={e.id}
            className="relative rounded-lg border border-border-default bg-surface-raised p-3 pl-4 overflow-hidden"
          >
            {/* Left rail — colored accent strip keyed off category. */}
            <span
              aria-hidden
              className="absolute left-0 top-0 bottom-0 w-1"
              style={{ backgroundColor: tone, boxShadow: `0 0 12px ${tone}55` }}
            />
            <div className="flex items-center justify-between gap-2 mb-1">
              <span
                className="text-[9px] font-mono uppercase tracking-wider"
                style={{ color: tone }}
              >
                {e.category}
              </span>
              <span className="text-[10px] font-mono text-text-muted tabular-nums shrink-0">
                {formatRelativeTime(e.timestamp ?? '')}
              </span>
            </div>
            <p className="text-sm font-heading text-text-primary leading-snug line-clamp-3">
              {e.description}
            </p>
          </div>
        );
      })}
    </div>
  );
}
