import {
  Users, ArrowLeftRight, ScrollText, Swords,
  CalendarCog, List, Settings, Shield,
  Trophy, UserPlus, Award, Bot, FlaskConical, Activity, Gauge,
  UsersRound, Megaphone, BarChart3, Newspaper,
  LayoutDashboard, Inbox, Sparkles, Terminal,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  /** URL slug under /admin/. */
  slug: string;
  label: string;
  icon: LucideIcon;
  /** When true, NavLink uses `end` so deep sub-routes don't collide. */
  matchEnd?: boolean;
  /** Tera Requests shares the Free Agents path; `lane` tells them apart. */
  lane?: 'tera';
  /** When true, only the `dev` role sees this tab (admins don't). */
  devOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
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
      { slug: 'rulesets', label: 'Rulesets',         icon: ScrollText },
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

/** The Simulator tab is mock-deployment only, appended to the Dev group. */
export const SIM_NAV_ITEM: NavItem = { slug: 'sim', label: 'Simulator', icon: FlaskConical };

/** Groups visible to this viewer: mock-only Simulator added, dev-only tabs dropped for non-dev staff. */
export function visibleNavGroups(mode: 'live' | 'mock' | null, isDev: boolean): NavGroup[] {
  return (mode === 'mock'
    ? NAV_GROUPS.map(g => g.label === 'Dev' ? { ...g, items: [...g.items, SIM_NAV_ITEM] } : g)
    : NAV_GROUPS
  ).map(g => ({ ...g, items: g.items.filter(i => isDev || !i.devOnly) }))
    .filter(g => g.items.length > 0);
}
