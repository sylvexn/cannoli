/**
 * TrendsPanel — 24h/7d error trends with a CSS bar sparkline and slowest
 * endpoints mini-table. No chart library.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { ApiObservabilityTrends } from '@/lib/api';
import { cn } from '@/lib/utils';
import { RefreshCw, TrendingUp, Clock } from 'lucide-react';
import { DualSpark } from './mini-spark';

type Window = '24h' | '7d';

function durationClass(ms: number): string {
  if (ms >= 1000) return 'text-loss';
  if (ms >= 300) return 'text-draw';
  return 'text-text-muted';
}

export function TrendsPanel() {
  const [window, setWindow] = useState<Window>('24h');
  const [data, setData] = useState<ApiObservabilityTrends | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getObservabilityTrends(window)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [window]);

  useEffect(() => { load(); }, [load]);

  const buckets = data?.buckets ?? [];
  const totalRequests = buckets.reduce((s, b) => s + b.total, 0);
  const totalErrors = buckets.reduce((s, b) => s + b.errors, 0);
  const errorRate = totalRequests > 0
    ? ((totalErrors / totalRequests) * 100).toFixed(1)
    : '0.0';
  const maxP95 = buckets.reduce((m, b) => Math.max(m, b.p95Ms), 0);
  const avgP95 = buckets.length > 0
    ? Math.round(buckets.reduce((s, b) => s + b.p95Ms, 0) / buckets.length)
    : 0;

  const slowest = data?.slowestEndpoints ?? [];

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={13} className="text-neon" />
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">Trends</span>

          {/* 24h / 7d toggle */}
          <div className="flex ml-auto rounded border border-border-default overflow-hidden">
            {(['24h', '7d'] as Window[]).map(w => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={cn(
                  'px-2.5 py-0.5 text-[11px] font-mono transition-colors',
                  window === w
                    ? 'bg-neon/20 text-neon'
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                {w}
              </button>
            ))}
          </div>

          <Button
            variant="ghost" size="sm"
            onClick={load}
            className="h-6 w-6 p-0 text-text-muted hover:text-text-primary"
            title="Refresh trends"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>

        <div className="flex items-start gap-4">
          {/* Sparkline */}
          <div className="flex-1 min-w-0">
            {buckets.length > 0 ? (
              <DualSpark
                buckets={buckets}
                height={36}
                className="w-full flex-1"
              />
            ) : (
              <div className="h-9 flex items-center text-xs text-text-muted">
                {loading ? 'Loading…' : 'No data.'}
              </div>
            )}
            <p className="text-[10px] text-text-muted mt-1">
              {window === '24h' ? 'Last 24 hours' : 'Last 7 days'}
              {' — '}
              <span className="text-text-muted/70">grey=total, red=errors</span>
            </p>
          </div>

          {/* Summary stats */}
          <div className="flex gap-4 shrink-0 text-xs">
            <div className="space-y-0.5">
              <div className="text-text-muted text-[10px] uppercase tracking-wide">Requests</div>
              <div className="font-mono tabular-nums text-text-primary">{totalRequests.toLocaleString()}</div>
            </div>
            <div className="space-y-0.5">
              <div className="text-text-muted text-[10px] uppercase tracking-wide">Err rate</div>
              <div className={cn('font-mono tabular-nums', Number(errorRate) > 5 ? 'text-loss' : Number(errorRate) > 1 ? 'text-draw' : 'text-win')}>
                {errorRate}%
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-text-muted text-[10px] uppercase tracking-wide">p95 avg</div>
              <div className={cn('font-mono tabular-nums', durationClass(avgP95))}>
                {avgP95}ms
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-text-muted text-[10px] uppercase tracking-wide">p95 peak</div>
              <div className={cn('font-mono tabular-nums', durationClass(maxP95))}>
                {maxP95}ms
              </div>
            </div>
          </div>
        </div>

        {/* Slowest endpoints */}
        {slowest.length > 0 && (
          <div className="mt-3 border-t border-border-default pt-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Clock size={11} className="text-draw" />
              <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide">Slowest endpoints</span>
            </div>
            <div className="space-y-1">
              {slowest.map(ep => (
                <div key={ep.path} className="flex items-center gap-2 text-[11px]">
                  <span className="flex-1 min-w-0 truncate font-mono text-text-secondary" title={ep.path}>
                    {ep.path}
                  </span>
                  <div className="flex gap-3 shrink-0 text-text-muted font-mono tabular-nums">
                    <span>
                      avg <span className={durationClass(ep.avgMs)}>{ep.avgMs}ms</span>
                    </span>
                    <span>
                      p95 <span className={durationClass(ep.p95Ms)}>{ep.p95Ms}ms</span>
                    </span>
                    <Badge variant="outline" className="border-text-muted/30 text-text-muted bg-transparent text-[10px] h-4 px-1.5 font-mono">
                      {ep.count}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
