/**
 * CoachesPanel — per-coach activity over the last 7 days (fixed window,
 * matching the read API's default). Usernames link to coach profiles like
 * everywhere else in the app.
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import type { ApiAnalyticsCoach } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { Panel, PanelEmpty, RefreshButton } from './panel';

export function CoachesPanel() {
  const [coaches, setCoaches] = useState<ApiAnalyticsCoach[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getAnalyticsCoaches(7)
      .then(d => setCoaches(d.coaches))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const right = (
    <>
      <Badge variant="outline" className="border-text-muted/30 text-text-muted bg-transparent text-[10px] h-4 px-1.5 font-mono">
        7d
      </Badge>
      <RefreshButton onClick={load} spinning={loading} title="Refresh coach activity" />
    </>
  );

  return (
    <Panel icon={UsersRound} title="Coach activity" right={right}>
      {coaches.length === 0 ? (
        <PanelEmpty label={loading ? 'Loading…' : 'No signed-in activity in the last 7 days.'} />
      ) : (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 px-1.5 text-[10px] uppercase tracking-wide text-text-muted">
            <span className="flex-1 min-w-0">Coach</span>
            <span className="flex-1 min-w-0 hidden md:block">Top route</span>
            <span className="w-12 text-right shrink-0">Views</span>
            <span className="w-16 text-right shrink-0 hidden sm:block">Seen</span>
          </div>
          {coaches.map(c => (
            <div key={String(c.userId)} className="flex items-center gap-2 px-1.5 py-1 text-[11px] rounded hover:bg-surface-overlay/40 transition-colors">
              <span className="flex-1 min-w-0 truncate">
                <Link
                  to={`/coach/${encodeURIComponent(c.username)}`}
                  className="text-text-secondary hover:text-text-primary hover:underline"
                >
                  {c.username}
                </Link>
              </span>
              <span className="flex-1 min-w-0 truncate font-mono text-text-muted hidden md:block" title={c.topRoute}>
                {c.topRoute}
              </span>
              <span className="w-12 text-right shrink-0 font-mono tabular-nums text-text-primary">
                {c.views.toLocaleString()}
              </span>
              <span
                className="w-16 text-right shrink-0 font-mono tabular-nums text-text-muted hidden sm:block"
                title={c.lastSeenAt}
              >
                {formatRelativeTime(c.lastSeenAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
