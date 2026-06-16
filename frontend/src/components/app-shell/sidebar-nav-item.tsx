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
      <Icon size={16} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}
