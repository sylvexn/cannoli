/**
 * HealthPanel — shows backend health checks, uptime, and version.
 * Each check renders as a status pill. Auto-refreshes every 15s.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { ApiObservabilityHealth, ApiHealthCheck } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Activity } from 'lucide-react';

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs > 0 ? `${days}d ${remHrs}h` : `${days}d`;
}

function statusIcon(status: ApiHealthCheck['status']) {
  if (status === 'ok') return <CheckCircle2 size={13} className="text-win shrink-0" />;
  if (status === 'degraded') return <AlertTriangle size={13} className="text-draw shrink-0" />;
  return <XCircle size={13} className="text-loss shrink-0" />;
}

function statusClasses(status: ApiHealthCheck['status']): string {
  if (status === 'ok') return 'border-win/40 text-win bg-win/10';
  if (status === 'degraded') return 'border-draw/40 text-draw bg-draw/10';
  return 'border-loss/40 text-loss bg-loss/10';
}

interface CheckPillProps {
  check: ApiHealthCheck;
}

function CheckPill({ check }: CheckPillProps) {
  const lastOkLabel = check.lastOkAt
    ? formatRelativeTime(check.lastOkAt)
    : null;

  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
      statusClasses(check.status),
    )}>
      {statusIcon(check.status)}
      <span className="font-medium">{check.name}</span>
      {check.latencyMs != null && (
        <span className="font-mono tabular-nums text-[10px] opacity-70">
          {check.latencyMs}ms
        </span>
      )}
      {check.detail && (
        <span className="text-[10px] opacity-60 truncate max-w-[140px]" title={check.detail}>
          {check.detail}
        </span>
      )}
      {check.status !== 'ok' && lastOkLabel && (
        <span className="ml-auto text-[10px] opacity-60 shrink-0">
          ok {lastOkLabel}
        </span>
      )}
    </div>
  );
}

export function HealthPanel() {
  const [data, setData] = useState<ApiObservabilityHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getObservabilityHealth()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 15s
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const id = setInterval(() => loadRef.current(), 15_000);
    return () => clearInterval(id);
  }, []);

  const checks = data?.checks ?? [];
  const allOk = checks.length > 0 && checks.every(c => c.status === 'ok');
  const anyDown = checks.some(c => c.status === 'down');

  const overallClass = anyDown
    ? 'text-loss'
    : allOk
    ? 'text-win'
    : 'text-draw';

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={13} className={overallClass} />
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">Health</span>
          {data && (
            <>
              <span className="text-text-muted text-xs ml-auto font-mono">
                uptime {formatUptime(data.uptimeSeconds)}
              </span>
              <Badge variant="outline" className="border-neon/40 text-neon bg-neon/10 font-mono text-[10px] px-1.5 h-5">
                {data.version}
              </Badge>
            </>
          )}
          <Button
            variant="ghost" size="sm"
            onClick={load}
            className="h-6 w-6 p-0 text-text-muted hover:text-text-primary ml-1"
            title="Refresh health"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>

        {checks.length === 0 ? (
          <p className="text-xs text-text-muted py-1 text-center">
            {loading ? 'Checking…' : 'No health checks configured.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {checks.map(check => (
              <CheckPill key={check.name} check={check} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
