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
import {
  Users, Globe, ArrowLeftRight, ScrollText, Swords,
  CalendarCog, List, Settings, Shield, MessageSquare,
  Trophy,
} from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: typeof Users;
  component: React.ComponentType;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'People',
    items: [
      { id: 'users', label: 'Users', icon: Users, component: AdminUsers },
      { id: 'teams', label: 'Teams', icon: Shield, component: AdminTeams },
    ],
  },
  {
    label: 'League',
    items: [
      { id: 'leagues', label: 'Leagues', icon: Globe, component: AdminLeagues },
      { id: 'season', label: 'Season', icon: CalendarCog, component: AdminSeason },
      { id: 'matches', label: 'Matches', icon: Trophy, component: AdminMatches },
      { id: 'trades', label: 'Trades', icon: ArrowLeftRight, component: AdminTrades },
    ],
  },
  {
    label: 'Config',
    items: [
      { id: 'tiers', label: 'Tier List', icon: List, component: AdminTierList },
      { id: 'moves', label: 'Move Categories', icon: Swords, component: AdminMoveCategories },
      { id: 'settings', label: 'Settings', icon: Settings, component: AdminSiteSettings },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'activity', label: 'Activity Log', icon: ScrollText, component: AdminActivityLog },
      { id: 'feedback', label: 'Feedback', icon: MessageSquare, component: AdminFeedback },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap(g => g.items);

export function AdminPage() {
  const [searchParams] = useSearchParams();
  const [activeId, setActiveId] = useState('users');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const isScrollingRef = useRef(false);

  // Deep-link from URL ?tab=xxx on mount
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && ALL_ITEMS.some(i => i.id === tab)) {
      setActiveId(tab);
      // Defer scroll to after render
      requestAnimationFrame(() => {
        sectionRefs.current[tab]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, []);

  // Track which section is visible via IntersectionObserver
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
    isScrollingRef.current = true;
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Re-enable observer after scroll settles
    setTimeout(() => { isScrollingRef.current = false; }, 800);
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
      </nav>

      {/* All sections — single scrollable column */}
      <div className="flex-1 min-w-0 pl-6 pt-1 space-y-14 pb-[50vh]">
        {ALL_ITEMS.map(item => {
          const Component = item.component;
          const Icon = item.icon;
          return (
            <section
              key={item.id}
              ref={el => { sectionRefs.current[item.id] = el; }}
              data-section-id={item.id}
            >
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border-subtle">
                <Icon size={16} className="text-text-muted" />
                <h2 className="text-base font-mono font-bold tracking-tight uppercase text-text-primary">
                  {item.label}
                </h2>
              </div>
              <Component />
            </section>
          );
        })}
      </div>
    </div>
  );
}
