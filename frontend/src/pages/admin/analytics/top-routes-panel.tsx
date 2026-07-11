/**
 * TopRoutesPanel — most-viewed route patterns with views/visitors counts and
 * a proportional background bar for at-a-glance magnitude.
 */
import { Route } from 'lucide-react';
import type { ApiAnalyticsSummary } from '@/lib/api';
import { Panel, PanelEmpty, BarRow } from './panel';

interface TopRoutesPanelProps {
  routes: ApiAnalyticsSummary['topRoutes'];
  loading: boolean;
}

export function TopRoutesPanel({ routes, loading }: TopRoutesPanelProps) {
  const maxViews = routes.reduce((m, r) => Math.max(m, r.views), 0);

  return (
    <Panel icon={Route} title="Top pages">
      {routes.length === 0 ? (
        <PanelEmpty label={loading ? 'Loading…' : 'No pageviews recorded yet.'} />
      ) : (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 px-1.5 text-[10px] uppercase tracking-wide text-text-muted">
            <span className="flex-1 min-w-0">Route</span>
            <span className="w-14 text-right shrink-0">Views</span>
            <span className="w-14 text-right shrink-0 hidden sm:block">Visitors</span>
          </div>
          {routes.map(r => (
            <BarRow key={r.route} pct={maxViews > 0 ? (r.views / maxViews) * 100 : 0}>
              <span className="relative flex-1 min-w-0 truncate font-mono text-text-secondary" title={r.route}>
                {r.route}
              </span>
              <span className="relative w-14 text-right shrink-0 font-mono tabular-nums text-text-primary">
                {r.views.toLocaleString()}
              </span>
              <span className="relative w-14 text-right shrink-0 font-mono tabular-nums text-text-muted hidden sm:block">
                {r.visitors.toLocaleString()}
              </span>
            </BarRow>
          ))}
        </div>
      )}
    </Panel>
  );
}
