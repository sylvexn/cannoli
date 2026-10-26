/**
 * Admin panel layout.
 *
 * Sub-routed: each tab is its own route under /admin/<slug>. The bare /admin
 * lands on the Dashboard. The Pins tab is a
 * single page now (was Definitions / Award; redesigned into one season-
 * scoped grid with per-card metadata-aware award dialogs). Legacy
 * `/admin/pins/{definitions,award}` URLs redirect to `/admin/pins`.
 *
 * Sidebar persists across all sub-routes; the right pane is a single Outlet
 * that renders the active tab. Replaces the prior single-page scrollable
 * stack which had grown to 13 sections with per-section maxHeight overrides.
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Badge } from '@/components/ui/badge';
import {
  Users, ArrowLeftRight, ScrollText, Swords,
  CalendarCog, List, Settings, Shield,
  Trophy, UserPlus, Award, Bot, FlaskConical, Activity, Gauge,
  UsersRound, Megaphone, BarChart3, Newspaper,
  LayoutDashboard, Inbox, Sparkles, Terminal,
} from 'lucide-react';
import { useAdminQueues, badgeFor, type AdminQueues, type AdminOutletContext } from '@/lib/api-admin-dashboard';

interface NavItem {
  /** URL slug under /admin/. */
  slug: string;
  label: string;
  icon: typeof Users;
  /** When true, NavLink uses `end` so deep sub-routes don't collide. */
  matchEnd?: boolean;
  /** Tera Requests shares the Free Agents path; `lane` tells them apart. */
  lane?: 'tera';
  /** When true, only the `dev` role sees this tab (admins don't). */
  devOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { slug: '/admin', label: 'Dashboard', icon: LayoutDashboard, matchEnd: true },
    ],
  },
  {
    label: 'Inbox',
    items: [
      { slug: 'tickets',     label: 'Tickets',            icon: Inbox },
      { slug: 'trades',      label: 'Trades',             icon: ArrowLeftRight },
      { slug: 'free-agents', label: 'Free Agents',        icon: UserPlus },
      { slug: 'free-agents?lane=tera', label: 'Tera Requests', icon: Sparkles, lane: 'tera' },
      { slug: 'playoffs',    label: 'Playoff Approvals',  icon: Trophy },
    ],
  },
  {
    label: 'League Ops',
    items: [
      { slug: 'season',     label: 'Seasons & Leagues', icon: CalendarCog },
      { slug: 'matches',    label: 'Matches',           icon: Swords },
      { slug: 'teams',      label: 'Teams',             icon: Shield },
      { slug: 'membership', label: 'Membership',        icon: UsersRound },
      { slug: 'pins',       label: 'Pins & Awards',     icon: Award },
    ],
  },
  {
    label: 'People & Content',
    items: [
      { slug: 'users',         label: 'Users',         icon: Users },
      { slug: 'announcements', label: 'Announcements', icon: Megaphone },
      { slug: 'activity',      label: 'Activity Log',  icon: ScrollText },
      { slug: 'patch-notes',   label: 'Patch Notes',   icon: Newspaper },
    ],
  },
  {
    label: 'Settings',
    items: [
      { slug: 'console', label: 'Settings Console', icon: Settings },
      { slug: 'rulesets', label: 'Rulesets',         icon: Shield },
      { slug: 'moves',   label: 'Move Categories',  icon: List },
    ],
  },
  {
    label: 'Dev',
    items: [
      { slug: 'dev',           label: 'Dev Console',   icon: Terminal, devOnly: true },
      { slug: 'observability', label: 'Observability', icon: Gauge, devOnly: true },
      { slug: 'usage',         label: 'Usage',         icon: BarChart3, devOnly: true },
      { slug: 'api-logs',      label: 'API Logs',      icon: Activity, devOnly: true },
      { slug: 'bot',           label: 'PS Bot',        icon: Bot, devOnly: true },
    ],
  },
];

/**
 * The Simulator tab is mock-deployment only — appended to the System group
 * when the /api/health probe reports `mode === 'mock'`.
 */
const SIM_NAV_ITEM: NavItem = { slug: 'sim', label: 'Simulator', icon: FlaskConical };

/** Tera Requests and Free Agents share a path; the `lane` query tells them apart. */
function AdminNavLink({ item, compact, search, queues, unreadErrors }: {
  item: NavItem; compact?: boolean; search: string; queues: AdminQueues | null; unreadErrors: number;
}) {
  const Icon = item.icon;
  const onTeraLane = new URLSearchParams(search).get('lane') === 'tera';
  const isActiveFor = (isActive: boolean) =>
    isActive && (!item.slug.startsWith('free-agents') || (item.lane === 'tera') === onTeraLane);
  const n = item.slug === 'observability' ? unreadErrors : badgeFor(item.slug, queues);
  return (
    <NavLink
      to={item.slug}
      end={item.matchEnd}
      className={({ isActive }) => cn(
        'flex items-center transition-colors',
        compact ? 'gap-1.5 px-2.5 py-1 rounded-md text-[11px] whitespace-nowrap shrink-0'
                : 'w-full gap-2.5 px-3 py-1.5 rounded-md text-[13px]',
        isActiveFor(isActive)
          ? 'bg-surface-overlay text-text-primary font-medium'
          : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
      )}
    >
      {({ isActive }) => (
        <>
          <Icon size={compact ? 12 : 14} className={cn('shrink-0', isActiveFor(isActive) && 'text-neon')} />
          <span className="min-w-0 truncate">{item.label}</span>
          {n > 0 && (
            <span className={cn(
              'inline-flex items-center justify-center rounded-full font-mono font-bold tabular-nums shrink-0',
              compact ? 'min-w-[16px] h-[16px] px-1 text-[9px]' : 'ml-auto min-w-[18px] h-[18px] px-1 text-[10px]',
              item.lane === 'tera' ? 'bg-pink/20 text-pink' : item.slug === 'observability' ? 'bg-loss/20 text-loss' : 'bg-draw/20 text-draw',
            )}>
              {n > 99 ? '99+' : n}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export function AdminPage() {
  const [mode, setMode] = useState<'live' | 'mock' | null>(null);
  const [unreadErrors, setUnreadErrors] = useState(0);
  const { user } = useAuth();
  const isDev = user?.role === 'dev';
  const { search } = useLocation();
  const { data: queues, loaded } = useAdminQueues();

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
  // reports mock mode, then drop any dev-only tabs (Observability, API Logs,
  // PS Bot) for non-dev staff. Route-level guards back this up server-side.
  const navGroups: NavGroup[] = (mode === 'mock'
    ? NAV_GROUPS.map(g =>
        g.label === 'Dev' ? { ...g, items: [...g.items, SIM_NAV_ITEM] } : g,
      )
    : NAV_GROUPS
  ).map(g => ({ ...g, items: g.items.filter(i => isDev || !i.devOnly) }))
    .filter(g => g.items.length > 0);

  const header = (
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
  );

  return (
    <div className="flex flex-col lg:flex-row gap-0">
      {/* Below lg: header + a horizontal, scrollable tab strip replaces the
          vertical sidebar. Group boundaries become thin separators. */}
      <div className="lg:hidden pb-2 mb-2 border-b border-border-default">
        {header}
        <nav className="flex items-center gap-1 overflow-x-auto pt-2 px-3">
          {navGroups.map((group, gi) => (
            <div key={group.label} className="flex items-center gap-1 shrink-0">
              {gi > 0 && <span className="w-px h-4 bg-border-default mx-1.5 shrink-0" />}
              {group.items.map(item => (
                <AdminNavLink key={item.slug} item={item} compact search={search} queues={queues} unreadErrors={unreadErrors} />
              ))}
            </div>
          ))}
        </nav>
      </div>

      {/* Sidebar nav: sticky, lg and up */}
      <nav className="hidden lg:block w-[180px] shrink-0 border-r border-border-default pr-1 pt-1 space-y-4 sticky top-4 self-start">
        {header}
        {navGroups.map(group => (
          <div key={group.label}>
            <div className="px-3 mb-1 text-[9px] font-mono font-bold uppercase tracking-[0.15em] text-text-muted/50">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <AdminNavLink key={item.slug} item={item} search={search} queues={queues} unreadErrors={unreadErrors} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Active tab — single content pane */}
      <div className="flex-1 min-w-0 pt-1 pb-12 lg:pl-6">
        <Outlet context={{ queues, loaded } satisfies AdminOutletContext} />
      </div>
    </div>
  );
}
