/**
 * EventsPanel — named feature events (trackEvent beacons): total fires and
 * distinct users per event over the selected window.
 */
import { MousePointerClick } from 'lucide-react';
import type { ApiAnalyticsSummary } from '@/lib/api';
import { Panel, PanelEmpty, BarRow } from './panel';

interface EventsPanelProps {
  events: ApiAnalyticsSummary['events'];
  loading: boolean;
}

export function EventsPanel({ events, loading }: EventsPanelProps) {
  const maxCount = events.reduce((m, e) => Math.max(m, e.count), 0);

  return (
    <Panel icon={MousePointerClick} title="Feature events">
      {events.length === 0 ? (
        <PanelEmpty label={loading ? 'Loading…' : 'No feature events recorded yet.'} />
      ) : (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 px-1.5 text-[10px] uppercase tracking-wide text-text-muted">
            <span className="flex-1 min-w-0">Event</span>
            <span className="w-14 text-right shrink-0">Count</span>
            <span className="w-14 text-right shrink-0 hidden sm:block">Users</span>
          </div>
          {events.map(e => (
            <BarRow key={e.event} pct={maxCount > 0 ? (e.count / maxCount) * 100 : 0}>
              <span className="relative flex-1 min-w-0 truncate font-mono text-text-secondary" title={e.event}>
                {e.event}
              </span>
              <span className="relative w-14 text-right shrink-0 font-mono tabular-nums text-text-primary">
                {e.count.toLocaleString()}
              </span>
              <span className="relative w-14 text-right shrink-0 font-mono tabular-nums text-text-muted hidden sm:block">
                {e.users.toLocaleString()}
              </span>
            </BarRow>
          ))}
        </div>
      )}
    </Panel>
  );
}
