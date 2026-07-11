/**
 * Usage — dev-only first-party analytics dashboard reading
 * /api/admin/analytics/*. Composition root only: owns the summary fetch +
 * window state and hands slices to the sibling panels (Observability-folder
 * pattern). Coach activity and Live now own their fetches (different
 * endpoints / polling cadence).
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { ApiAnalyticsSummary } from '@/lib/api';
import { StatTiles } from './stat-tiles';
import { TimelinePanel, type AnalyticsWindow } from './timeline-panel';
import { TopRoutesPanel } from './top-routes-panel';
import { CoachesPanel } from './coaches-panel';
import { EventsPanel } from './events-panel';
import { LivePanel } from './live-panel';
import { BreakdownPanel } from './breakdown-panel';

export function AdminAnalytics() {
  const [days, setDays] = useState<AnalyticsWindow>(30);
  const [summary, setSummary] = useState<ApiAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getAnalyticsSummary(days)
      .then(setSummary)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <StatTiles tiles={summary?.tiles ?? null} loading={loading} />

      <TimelinePanel
        timeline={summary?.timeline ?? []}
        days={days}
        onDaysChange={setDays}
        loading={loading}
        onRefresh={load}
      />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <TopRoutesPanel routes={summary?.topRoutes ?? []} loading={loading} />
        <CoachesPanel />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <EventsPanel events={summary?.events ?? []} loading={loading} />
        <LivePanel />
      </div>

      <BreakdownPanel
        devices={summary?.devices ?? []}
        referrers={summary?.referrers ?? []}
        loading={loading}
      />
    </div>
  );
}
