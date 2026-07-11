/**
 * LivePanel — pageviews/events from the last 5 minutes, newest first.
 * Polls every 30s but only while the tab is visible (and refreshes
 * immediately when the tab regains visibility).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import type { ApiAnalyticsLiveEntry } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Panel, PanelEmpty, RefreshButton } from './panel';

const POLL_MS = 30_000;

export function LivePanel() {
  const [entries, setEntries] = useState<ApiAnalyticsLiveEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getAnalyticsLive()
      .then(d => setEntries(d.entries))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) loadRef.current();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) loadRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const active = entries.length > 0;

  return (
    <Panel
      icon={Radio}
      title="Live now"
      iconClass={cn(active ? 'text-win animate-pulse' : 'text-text-muted')}
      right={<RefreshButton onClick={load} spinning={loading} title="Refresh live activity" />}
    >
      {entries.length === 0 ? (
        <PanelEmpty label={loading ? 'Loading…' : 'No activity in the last 5 minutes.'} />
      ) : (
        <div className="space-y-0.5 max-h-64 overflow-y-auto">
          {entries.map((e, i) => (
            <div key={`${e.ts}-${i}`} className="flex items-center gap-2 px-1.5 py-1 text-[11px] rounded hover:bg-surface-overlay/40 transition-colors">
              <span className="w-24 shrink-0 truncate">
                {e.username ? (
                  <Link
                    to={`/coach/${encodeURIComponent(e.username)}`}
                    className="text-text-secondary hover:text-text-primary hover:underline"
                  >
                    {e.username}
                  </Link>
                ) : (
                  <span className="text-text-muted/70">guest</span>
                )}
              </span>
              <span className="flex-1 min-w-0 truncate font-mono text-text-muted" title={e.route}>
                {e.route}
              </span>
              {e.event && (
                <Badge variant="outline" className="border-pink/40 text-pink bg-pink/10 text-[10px] h-4 px-1.5 font-mono shrink-0 max-w-[140px]">
                  <span className="truncate">{e.event}</span>
                </Badge>
              )}
              <span className="w-14 text-right shrink-0 font-mono tabular-nums text-text-muted" title={e.ts}>
                {formatRelativeTime(e.ts)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
