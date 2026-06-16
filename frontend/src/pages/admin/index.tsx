/**
 * Admin panel layout.
 *
 * Sub-routed: each tab is its own route under /admin/<slug>. The bare /admin
 * lands on the People → Users tab (existing default). The Pins tab is a
 * single page now (was Definitions / Award; redesigned into one season-
 * scoped grid with per-card metadata-aware award dialogs). Legacy
 * `/admin/pins/{definitions,award}` URLs redirect to `/admin/pins`.
 *
 * Sidebar persists across all sub-routes; the right pane is a single Outlet
 * that renders the active tab. Replaces the prior single-page scrollable
 * stack which had grown to 13 sections with per-section maxHeight overrides.
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Badge } from '@/components/ui/badge';
import {
  Users, Globe, ArrowLeftRight, ScrollText, Swords,
  CalendarCog, List, Settings, Shield, MessageSquare,
  Trophy, UserPlus, Award, Bot, Layers, FlaskConical, Activity, Gauge,
  UsersRound,
} from 'lucide-react';

interface NavItem {
  /** URL slug under /admin/. */
  slug: string;
  label: string;
  icon: typeof Users;
  /** When true, NavLink uses `end` so deep sub-routes don't collide. */
  matchEnd?: boolean;
  /** When true, only the `dev` role sees this tab (admins don't). */
  devOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'People',
    items: [
      { slug: 'users',     label: 'Users',       icon: Users },
      { slug: 'teams',     label: 'Teams',       icon: Shield },
    ],
  },
  {
    label: 'League',
    items: [
      { slug: 'membership',  label: 'Membership',   icon: UsersRound },
      { slug: 'leagues',     label: 'Leagues',      icon: Globe },
      { slug: 'season',      label: 'Season',       icon: CalendarCog },
      { slug: 'matches',     label: 'Matches',      icon: Trophy },
      { slug: 'trades',      label: 'Trades',       icon: ArrowLeftRight },
      { slug: 'free-agents', label: 'Free Agents',  icon: UserPlus },
    ],
  },
  {
    label: 'Config',
    items: [
      { slug: 'tiers',     label: 'Tier List',       icon: List },
      { slug: 'templates', label: 'Templates',       icon: Layers },
      { slug: 'moves',     label: 'Move Categories', icon: Swords },
      { slug: 'pins',      label: 'Pins',            icon: Award },
      { slug: 'settings',  label: 'Settings',        icon: Settings },
    ],
  },
  {
    label: 'System',
    items: [
      { slug: 'activity', label: 'Activity Log', icon: ScrollText },
      { slug: 'observability', label: 'Observability', icon: Gauge, devOnly: true },
      { slug: 'api-logs', label: 'API Logs',     icon: Activity, devOnly: true },
      { slug: 'bot',      label: 'PS Bot',       icon: Bot },
      { slug: 'feedback', label: 'Feedback',     icon: MessageSquare, devOnly: true },
    ],
  },
];

/**
 * The Simulator tab is mock-deployment only — appended to the System group
 * when the /api/health probe reports `mode === 'mock'`.
 */
const SIM_NAV_ITEM: NavItem = { slug: 'sim', label: 'Simulator', icon: FlaskConical };

export function AdminPage() {
  const [mode, setMode] = useState<'live' | 'mock' | null>(null);
  const [unreadErrors, setUnreadErrors] = useState(0);
  const { user } = useAuth();
  const isDev = user?.role === 'dev';

  // Probe /api/health once on mount so admins on mock.cannoli.live get a
  // visible reminder they aren't pointing at the live DB.
  useEffect(() => {
    api.getHealth().then(h => setMode(h.mode)).catch(() => setMode(null));
  }, []);

  // Dev-only: poll the count of new/unseen error groups so the Observability
  // nav item carries a live unread badge — a passive "something just broke"
  // signal even without the Discord push. Best-effort.
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

  // Append the mock-only Simulator tab to the System group when the backend
  // reports mock mode, then drop any dev-only tabs (API Logs, Feedback) for
  // non-dev staff. Route-level guards back this up server-side.
  const navGroups: NavGroup[] = (mode === 'mock'
    ? NAV_GROUPS.map(g =>
        g.label === 'System' ? { ...g, items: [...g.items, SIM_NAV_ITEM] } : g,
      )
    : NAV_GROUPS
  ).map(g => ({ ...g, items: g.items.filter(i => isDev || !i.devOnly) }));

  return (
    <div className="flex gap-0">
      {/* Sidebar nav — sticky */}
      <nav className="w-[180px] shrink-0 border-r border-border-default pr-1 pt-1 space-y-4 sticky top-4 self-start">
        <div className="pb-1">
          <h1 className="px-3 text-lg font-mono font-bold tracking-tight uppercase flex items-center gap-2">
            <span className="text-loss">Admin</span>
            {mode && (
              <Badge
                variant="outline"
                className={cn(
                  'text-[9px] font-mono uppercase tracking-wider px-1.5 py-0 h-4',
                  mode === 'live'
                    ? 'border-win/40 text-win bg-win/10'
                    : 'border-draw/40 text-draw bg-draw/10',
                )}
                title={mode === 'live' ? 'Pointing at live DB' : 'Pointing at mock DB (mock.cannoli.live)'}
              >
                {mode}
              </Badge>
            )}
          </h1>
          <p className="px-3 text-[10px] text-text-muted">Site management</p>
        </div>
        {navGroups.map(group => (
          <div key={group.label}>
            <div className="px-3 mb-1 text-[9px] font-mono font-bold uppercase tracking-[0.15em] text-text-muted/50">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map(item => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.slug}
                    to={item.slug}
                    end={item.matchEnd}
                    className={({ isActive }) => cn(
                      'w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors',
                      isActive
                        ? 'bg-surface-overlay text-text-primary font-medium'
                        : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={14} className={isActive ? 'text-neon' : ''} />
                        {item.label}
                        {item.slug === 'observability' && unreadErrors > 0 && (
                          <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-loss/20 text-loss text-[10px] font-mono font-bold tabular-nums">
                            {unreadErrors > 99 ? '99+' : unreadErrors}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Active tab — single content pane */}
      <div className="flex-1 min-w-0 pl-6 pt-1 pb-12">
        <Outlet />
      </div>
    </div>
  );
}
