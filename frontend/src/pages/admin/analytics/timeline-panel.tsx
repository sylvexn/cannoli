/**
 * TimelinePanel — daily views + visitors over the selected window, rendered
 * as CSS overlay bars (the DualSpark pattern from observability/mini-spark:
 * grey = views, neon overlay = visitors; visitors ⊆ views so the overlay is
 * always contained). No chart library. Per-day native tooltips carry exact
 * values; the summary column carries the headline numbers.
 */
import { TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ApiAnalyticsSummary } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Panel, RefreshButton } from './panel';

export type AnalyticsWindow = 7 | 30 | 90;
const WINDOWS: AnalyticsWindow[] = [7, 30, 90];

interface TimelinePanelProps {
  timeline: ApiAnalyticsSummary['timeline'];
  days: AnalyticsWindow;
  onDaysChange: (days: AnalyticsWindow) => void;
  loading: boolean;
  onRefresh: () => void;
}

export function TimelinePanel({ timeline, days, onDaysChange, loading, onRefresh }: TimelinePanelProps) {
  const totalViews = timeline.reduce((s, d) => s + d.views, 0);
  const totalVisitors = timeline.reduce((s, d) => s + d.visitors, 0);
  const maxViews = timeline.reduce((m, d) => Math.max(m, d.views), 0);
  const avgViews = timeline.length > 0 ? Math.round(totalViews / timeline.length) : 0;
  const peak = timeline.reduce(
    (best, d) => (d.views > best.views ? d : best),
    { date: '', views: 0, visitors: 0 },
  );

  const toggle = (
    <>
      <div className="flex rounded border border-border-default overflow-hidden">
        {WINDOWS.map(w => (
          <button
            key={w}
            onClick={() => onDaysChange(w)}
            className={cn(
              'px-2.5 py-0.5 text-[11px] font-mono transition-colors',
              days === w ? 'bg-neon/20 text-neon' : 'text-text-muted hover:text-text-primary',
            )}
          >
            {w}d
          </button>
        ))}
      </div>
      <RefreshButton onClick={onRefresh} spinning={loading} title="Refresh usage data" />
    </>
  );

  return (
    <Panel icon={TrendingUp} title="Traffic" right={toggle}>
      <div className="flex flex-col md:flex-row items-stretch md:items-start gap-4">
        <div className="flex-1 min-w-0">
          {timeline.length > 0 ? (
            <>
              <div className="flex items-end gap-px h-32" role="img" aria-label="Daily views and visitors">
                {timeline.map(d => {
                  const viewsPct = maxViews > 0 ? Math.max(2, Math.round((d.views / maxViews) * 100)) : 2;
                  const visitorsPct = d.views > 0 ? Math.round((d.visitors / d.views) * viewsPct) : 0;
                  return (
                    <div
                      key={d.date}
                      className="group relative flex-1 min-w-0 h-full flex items-end rounded-sm hover:bg-surface-overlay/50 transition-colors"
                      title={`${d.date} — ${d.views.toLocaleString()} views, ${d.visitors.toLocaleString()} visitors`}
                    >
                      <div className="relative w-full" style={{ height: `${viewsPct}%` }}>
                        <div className="absolute inset-0 rounded-sm bg-text-muted/20 group-hover:bg-text-muted/30" />
                        {visitorsPct > 0 && (
                          <div
                            className="absolute bottom-0 left-0 right-0 rounded-sm bg-neon/70"
                            style={{ height: `${visitorsPct}%` }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-1 font-mono text-[10px] text-text-muted tabular-nums">
                <span>{formatDate(timeline[0]!.date, { year: 'hide', tz: 'UTC' })}</span>
                <span className="text-text-muted/70">grey=views, neon=visitors</span>
                <span>{formatDate(timeline[timeline.length - 1]!.date, { year: 'hide', tz: 'UTC' })}</span>
              </div>
            </>
          ) : (
            <div className="h-32 flex items-center justify-center text-xs text-text-muted">
              {loading ? 'Loading…' : 'No traffic recorded in this window yet.'}
            </div>
          )}
        </div>

        <div className="flex md:flex-col flex-wrap gap-x-4 gap-y-2 shrink-0 text-xs md:w-[120px]">
          <SummaryStat label="Views" value={totalViews.toLocaleString()} />
          <SummaryStat label="Visitors" value={totalVisitors.toLocaleString()} />
          <SummaryStat label="Avg / day" value={avgViews.toLocaleString()} />
          <SummaryStat
            label="Peak day"
            value={peak.views > 0 ? `${peak.views.toLocaleString()}` : '—'}
            sub={peak.views > 0 ? formatDate(peak.date, { year: 'hide', tz: 'UTC' }) : undefined}
          />
        </div>
      </div>
    </Panel>
  );
}

function SummaryStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-text-muted text-[10px] uppercase tracking-wide">{label}</div>
      <div className="font-mono tabular-nums text-text-primary">
        {value}
        {sub && <span className="ml-1.5 text-[10px] text-text-muted">{sub}</span>}
      </div>
    </div>
  );
}
