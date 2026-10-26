import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface SidebarNavItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  /** Icon-only rail mode — hides the label, centers the icon, shows it on hover via title. */
  collapsed: boolean;
  end?: boolean;
  /** Active-state classes (bg tint + text color). Defaults to neon. */
  activeClass?: string;
  /** Unread count; renders a pill (expanded) or dot (rail) when > 0. */
  badge?: number;
}

const INACTIVE = 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary';

/**
 * A single top-level sidebar link. Renders a full icon+label row when
 * expanded, or a centered icon (label via native title) in the collapsed
 * rail. Extracted so the ~8 near-identical nav entries share one source of
 * truth for sizing, active styling, and collapse behavior.
 */
export function SidebarNavItem({
  to, icon: Icon, label, collapsed, end,
  activeClass = 'bg-neon/10 text-neon',
  badge = 0,
}: SidebarNavItemProps) {
  return (
    <NavLink
      viewTransition
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) => cn(
        'flex items-center rounded-md text-sm font-medium transition-colors',
        collapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-2.5 px-3 py-2',
        isActive ? activeClass : INACTIVE,
      )}
    >
      <span className="relative inline-flex shrink-0">
        <Icon size={16} />
        {collapsed && badge > 0 && (
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-neon ring-2 ring-surface-raised" />
        )}
      </span>
      {!collapsed && <span className="min-w-0 truncate">{label}</span>}
      {!collapsed && badge > 0 && (
        <span className="ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-neon/20 px-1 text-[9px] font-bold tabular-nums text-neon">
          {badge}
        </span>
      )}
    </NavLink>
  );
}
