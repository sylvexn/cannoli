import { useState } from 'react';
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
  const [activeId, setActiveId] = useState('users');
  const activeItem = ALL_ITEMS.find(i => i.id === activeId) ?? ALL_ITEMS[0];
  const ActiveComponent = activeItem.component;

  return (
    <div className="flex gap-0 min-h-[calc(100vh-8rem)]">
      {/* Sidebar */}
      <nav className="w-[180px] shrink-0 border-r border-border-default pr-1 pt-1 space-y-4">
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
                    onClick={() => setActiveId(item.id)}
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

      {/* Content */}
      <div className="flex-1 min-w-0 pl-6 pt-1">
        <div className="mb-4">
          <h1 className="text-xl font-mono font-bold tracking-tight uppercase">
            <span className="text-loss">Admin</span>
            <span className="text-text-primary ml-1">{activeItem.label}</span>
          </h1>
        </div>
        <ActiveComponent />
      </div>
    </div>
  );
}
