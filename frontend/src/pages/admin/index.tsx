import { useRef, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AdminUsers } from './admin-users';
import { AdminLeagues } from './admin-leagues';
import { AdminTrades } from './admin-trades';
import { AdminActivityLog } from './admin-activity-log';
import { AdminMoveCategories } from './admin-move-categories';
import { AdminSeason } from './admin-season';
import { AdminTierList } from './admin-tier-list';
import { AdminSiteSettings } from './admin-site-settings';
import { AdminTeams } from './admin-teams';
import { AdminFeedback } from './admin-feedback';
import { AdminMatches } from './admin-matches';
import { AdminFreeAgents } from './admin-free-agents';
import { AdminPins } from './admin-pins';
import {
  Users, Globe, ArrowLeftRight, ScrollText, Swords,
  CalendarCog, List, Settings, Shield, MessageSquare,
  Trophy, ChevronDown, ChevronsUpDown, ChevronsDownUp,
  UserPlus, Award,
} from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: typeof Users;
  component: React.ComponentType;
  /** Max height for the content area — tall sections get internal scroll */
  maxH?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'People',
    items: [
      { id: 'users', label: 'Users', icon: Users, component: AdminUsers, maxH: 'max-h-[40vh]' },
      { id: 'teams', label: 'Teams', icon: Shield, component: AdminTeams },
    ],
  },
  {
    label: 'League',
    items: [
      { id: 'leagues', label: 'Leagues', icon: Globe, component: AdminLeagues },
      { id: 'season', label: 'Season', icon: CalendarCog, component: AdminSeason },
      { id: 'matches', label: 'Matches', icon: Trophy, component: AdminMatches, maxH: 'max-h-[60vh]' },
      { id: 'trades', label: 'Trades', icon: ArrowLeftRight, component: AdminTrades, maxH: 'max-h-[50vh]' },
      { id: 'free-agents', label: 'Free Agents', icon: UserPlus, component: AdminFreeAgents, maxH: 'max-h-[60vh]' },
    ],
  },
  {
    label: 'Config',
    items: [
      { id: 'tiers', label: 'Tier List', icon: List, component: AdminTierList, maxH: 'max-h-[60vh]' },
      { id: 'moves', label: 'Move Categories', icon: Swords, component: AdminMoveCategories },
      { id: 'pins', label: 'Pins', icon: Award, component: AdminPins, maxH: 'max-h-[70vh]' },
      { id: 'settings', label: 'Settings', icon: Settings, component: AdminSiteSettings },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'activity', label: 'Activity Log', icon: ScrollText, component: AdminActivityLog, maxH: 'max-h-[50vh]' },
      { id: 'feedback', label: 'Feedback', icon: MessageSquare, component: AdminFeedback },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap(g => g.items);

export function AdminPage() {
  const [searchParams] = useSearchParams();
  const [activeId, setActiveId] = useState('users');
  // All collapsed except first
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(ALL_ITEMS.slice(1).map(i => i.id))
  );
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const isScrollingRef = useRef(false);

  // Deep-link from URL ?tab=xxx on mount
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && ALL_ITEMS.some(i => i.id === tab)) {
      setActiveId(tab);
      requestAnimationFrame(() => {
        sectionRefs.current[tab]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, []);

  // Track which section is visible
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrollingRef.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('data-section-id');
            if (id) setActiveId(id);
          }
        }
      },
      { rootMargin: '-5% 0px -85% 0px', threshold: 0 },
    );

    for (const item of ALL_ITEMS) {
      const el = sectionRefs.current[item.id];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  const scrollTo = useCallback((id: string) => {
    setActiveId(id);
    // Expand if collapsed
    setCollapsed(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    isScrollingRef.current = true;
    requestAnimationFrame(() => {
      sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    setTimeout(() => { isScrollingRef.current = false; }, 800);
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="flex gap-0">
      {/* Sidebar nav — sticky */}
      <nav className="w-[180px] shrink-0 border-r border-border-default pr-1 pt-1 space-y-4 sticky top-4 self-start">
        <div className="pb-1">
          <h1 className="px-3 text-lg font-mono font-bold tracking-tight uppercase">
            <span className="text-loss">Admin</span>
          </h1>
          <p className="px-3 text-[10px] text-text-muted">Site management</p>
        </div>
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <div className="px-3 mb-1 text-[9px] font-mono font-bold uppercase tracking-[0.15em] text-text-muted/50">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map(item => {
                const Icon = item.icon;
                const isActive = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    onClick={() => scrollTo(item.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors',
                      isActive
                        ? 'bg-surface-overlay text-text-primary font-medium'
                        : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
                    )}
                  >
                    <Icon size={14} className={isActive ? 'text-neon' : ''} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Expand / Collapse all */}
        <div className="flex items-center gap-1 px-2 pt-2 border-t border-border-subtle">
          <button
            onClick={() => setCollapsed(new Set())}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40 transition-colors"
          >
            <ChevronsUpDown size={12} />
            Expand
          </button>
          <button
            onClick={() => setCollapsed(new Set(ALL_ITEMS.map(i => i.id)))}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40 transition-colors"
          >
            <ChevronsDownUp size={12} />
            Collapse
          </button>
        </div>
      </nav>

      {/* All sections — single scrollable column */}
      <div className="flex-1 min-w-0 pl-6 pt-1 space-y-6 pb-[50vh]">
        {ALL_ITEMS.map(item => {
          const Component = item.component;
          const Icon = item.icon;
          const isCollapsed = collapsed.has(item.id);

          return (
            <section
              key={item.id}
              ref={el => { sectionRefs.current[item.id] = el; }}
              data-section-id={item.id}
              className="rounded-lg border border-border-default bg-surface-raised/30 overflow-hidden"
            >
              {/* Collapsible header */}
              <button
                onClick={() => toggleCollapse(item.id)}
                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-surface-overlay/20 transition-colors"
              >
                <Icon size={15} className="text-text-muted shrink-0" />
                <h2 className="text-sm font-mono font-bold tracking-tight uppercase text-text-primary">
                  {item.label}
                </h2>
                <ChevronDown
                  size={14}
                  className={cn(
                    'ml-auto text-text-muted transition-transform duration-200',
                    isCollapsed && '-rotate-90',
                  )}
                />
              </button>

              {/* Content */}
              {!isCollapsed && (
                <div className={cn(
                  'px-4 pb-4 pt-1',
                  item.maxH && `${item.maxH} overflow-y-auto`,
                )}>
                  <Component />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
