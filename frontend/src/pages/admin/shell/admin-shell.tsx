/**
 * Standalone admin area: own header, rail and scroll column, outside the site
 * AppShell (no league nav, gem tint, banners or match toast). The content
 * column is the scroll container, so AdminSection's sticky toolbar pins to it.
 */
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAdminQueues, type AdminOutletContext } from '@/lib/api-admin-dashboard';
import { SimBanner } from '@/components/sim-banner';
import { CommandPalette } from '@/components/command-palette';
import { PageErrorBoundary } from '@/components/page-error-boundary';
import { AdminHeader } from './admin-header';
import { AdminRail } from './admin-rail';
import { visibleNavGroups } from './admin-nav';

export function AdminShell() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const isDev = user?.role === 'dev';
  const { data: queues, loaded } = useAdminQueues();
  const [mode, setMode] = useState<'live' | 'mock' | null>(null);
  const [unreadErrors, setUnreadErrors] = useState(0);
  const [cmdOpen, setCmdOpen] = useState(false);

  // Probe /api/health once so admins on mock.cannoli.live see they aren't on the live DB.
  useEffect(() => {
    api.getHealth().then(h => setMode(h.mode)).catch(() => setMode(null));
  }, []);

  // Dev-only: poll new/unseen error groups for the Observability nav badge. Best-effort.
  useEffect(() => {
    if (!isDev) return;
    let alive = true;
    const tick = () => api.getObservabilityUnread()
      .then(r => { if (alive) setUnreadErrors(r.unread); })
      .catch(() => {});
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [isDev]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  if (user?.mustChangePassword) return <Navigate to="/change-password" replace />;

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface">
      <SimBanner />
      <AdminHeader mode={mode} onOpenSearch={() => setCmdOpen(true)} />
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        <AdminRail groups={visibleNavGroups(mode, isDev)} queues={queues} unreadErrors={unreadErrors} />
        <main className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6">
          <PageErrorBoundary resetKey={pathname}>
            {/* Padding lives inside the scroller: sticky offsets measure from its content box. */}
            <div className="pt-4 pb-12">
              <Outlet context={{ queues, loaded } satisfies AdminOutletContext} />
            </div>
          </PageErrorBoundary>
        </main>
      </div>
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
