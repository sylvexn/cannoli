/**
 * Standard heading for admin sub-route pages: a sticky toolbar (icon, display
 * title, optional sub-tab strip, right-aligned actions) over an open body. It
 * pins to the AdminShell content column, which is the scroll container.
 */
import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface AdminSectionProps {
  icon: LucideIcon;
  title: string;
  /** Optional sub-tab links (e.g. /admin/pins/definitions vs /admin/pins/award). */
  subTabs?: { to: string; label: string; end?: boolean }[];
  /** Optional right-aligned action area (buttons, badges). */
  actions?: ReactNode;
  children: ReactNode;
}

export function AdminSection({ icon: Icon, title, subTabs, actions, children }: AdminSectionProps) {
  return (
    <section>
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle bg-surface py-2">
        <Icon size={16} className="shrink-0 text-text-muted" />
        <h2 className="font-display text-[22px] font-semibold leading-none text-text-primary">
          {title}
        </h2>
        {subTabs && subTabs.length > 0 && (
          <nav className="ml-3 flex items-center gap-0.5 rounded-md border border-border-default bg-surface-raised p-0.5">
            {subTabs.map(t => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) => cn(
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-surface-overlay text-text-primary'
                    : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        )}
        {actions && <div className="ml-auto">{actions}</div>}
      </header>
      <div className="pt-3">
        {children}
      </div>
    </section>
  );
}
