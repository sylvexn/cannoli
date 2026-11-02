import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Trophy, Calendar, LayoutDashboard, ArrowLeftRight, BarChart3,
  Users, Swords, ClipboardList, ListTree, Gamepad2, Film, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Extra path prefixes that also light this link up. */
  also?: string[];
  badge?: number;
  /** Hidden for logged-out users (the route is behind login). */
  authOnly?: boolean;
}

export function leagueNavItems(leagueId: string, pendingTrades: number): NavItem[] {
  const b = `/league/${leagueId}`;
  return [
    { to: b, label: 'Overview', icon: Trophy, end: true },
    { to: `${b}/schedule`, label: 'Schedule', icon: Calendar },
    { to: `${b}/teams`, label: 'Teams', icon: Users },
    { to: `${b}/draft`, label: 'Draft', icon: LayoutDashboard },
    { to: `${b}/market`, label: 'Market', icon: ArrowLeftRight, badge: pendingTrades },
    { to: `${b}/stats`, label: 'Stats', icon: BarChart3 },
  ];
}

export const TOOL_NAV: NavItem[] = [
  { to: '/matchup', label: 'Matchup Center', icon: Swords },
  { to: '/draft-center', label: 'Draft Center', icon: ClipboardList },
  { to: '/tiers', label: 'Pokédex', icon: ListTree, also: ['/speed-tiers', '/pokemon/'] },
  { to: '/replays', label: 'Replays', icon: Film, also: ['/replay/'] },
  { to: '/showdown', label: 'Play & Watch', icon: Gamepad2, authOnly: true },
];

/** Tool links visible to this viewer (guests don't get login-gated ones). */
export const toolNav = (authed: boolean) => TOOL_NAV.filter(i => authed || !i.authOnly);

export const Badge = ({ n, title }: { n: number; title: string }) => (
  <span
    title={title}
    className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-400/20 px-1 text-[10px] font-bold tabular-nums text-purple-400"
  >
    {n}
  </span>
);

/** One nav link. `bar` = top-bar pill, `drawer` = full-width drawer row. */
export function NavItemLink({ item, variant, onNavigate }: {
  item: NavItem; variant: 'bar' | 'drawer'; onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const Icon = item.icon;
  const alsoOn = !!item.also?.some(p => pathname.startsWith(p));
  return (
    <NavLink
      viewTransition
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      // NavLink sets aria-current only for its own match; mirror the `also` case.
      {...(alsoOn ? { 'aria-current': 'page' as const } : {})}
      className={({ isActive }) => cn(
        'flex items-center gap-2 rounded-md font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-gem/60',
        variant === 'bar' ? 'shrink-0 px-2.5 py-1.5 text-[13.5px]' : 'px-3 py-2 text-sm',
        isActive || alsoOn
          ? 'bg-surface-overlay text-text-primary shadow-[inset_0_0_0_1px_var(--color-border-default)]'
          : 'text-text-secondary hover:bg-surface-overlay/60 hover:text-text-primary',
      )}
    >
      {variant === 'drawer' && <Icon size={16} className="shrink-0" />}
      {item.label}
      {!!item.badge && <Badge n={item.badge} title={`${item.badge} pending trade proposal${item.badge === 1 ? '' : 's'}`} />}
    </NavLink>
  );
}
