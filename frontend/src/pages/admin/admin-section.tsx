/**
 * Standardized header + container for admin sub-route pages. Renders the
 * tab's icon, monospace title, optional sub-tab strip (used by Pins), and
 * wraps the body in a card-like surface to match the prior single-page look.
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
    <section className="rounded-lg border border-border-default bg-surface-raised/30 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-border-subtle">
        <Icon size={15} className="text-text-muted shrink-0" />
        <h2 className="text-sm font-mono font-bold tracking-tight uppercase text-text-primary">
          {title}
        </h2>
        {subTabs && subTabs.length > 0 && (
          <nav className="ml-3 flex items-center gap-0.5 rounded-md border border-border-default p-0.5 bg-surface-base">
            {subTabs.map(t => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) => cn(
                  'px-2.5 py-0.5 text-[11px] font-medium rounded transition-colors',
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
      <div className="px-4 py-4">
        {children}
      </div>
    </section>
  );
}
