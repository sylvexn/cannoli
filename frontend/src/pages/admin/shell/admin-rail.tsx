import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { badgeFor, type AdminQueues } from '@/lib/api-admin-dashboard';
import type { NavGroup, NavItem } from './admin-nav';

interface RailProps {
  groups: NavGroup[];
  queues: AdminQueues | null;
  unreadErrors: number;
}

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
          ? cn('bg-surface-overlay text-text-primary font-medium', !compact && 'shadow-[inset_2px_0_0_var(--color-loss)]')
          : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
      )}
    >
      {({ isActive }) => (
        <>
          <Icon size={compact ? 12 : 14} className={cn('shrink-0', isActiveFor(isActive) && 'text-loss')} />
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

export function AdminRail({ groups, queues, unreadErrors }: RailProps) {
  const { search } = useLocation();
  return (
    <>
      {/* Below lg: horizontal scrollable strip; group boundaries become thin separators. */}
      <nav aria-label="Admin sections" className="lg:hidden shrink-0 flex items-center gap-1 overflow-x-auto px-3 py-2 border-b border-border-subtle">
        {groups.map((group, gi) => (
          <div key={group.label} className="flex items-center gap-1 shrink-0">
            {gi > 0 && <span className="w-px h-4 bg-border-default mx-1.5 shrink-0" />}
            {group.items.map(item => (
              <AdminNavLink key={item.slug} item={item} compact search={search} queues={queues} unreadErrors={unreadErrors} />
            ))}
          </div>
        ))}
      </nav>

      {/* lg and up: fixed 200px rail, scrolls on its own if the list outgrows the viewport. */}
      <nav aria-label="Admin sections" className="hidden lg:block w-[200px] shrink-0 overflow-y-auto border-r border-border-subtle px-2 py-3 space-y-4">
        {groups.map(group => (
          <div key={group.label}>
            <div className="px-3 mb-1 text-[11px] text-text-muted">{group.label}</div>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <AdminNavLink key={item.slug} item={item} search={search} queues={queues} unreadErrors={unreadErrors} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  );
}
