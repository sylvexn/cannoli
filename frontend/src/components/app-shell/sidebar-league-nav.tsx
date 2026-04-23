import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Trophy, BarChart3, Calendar, ArrowLeftRight,
  LayoutDashboard, ChevronDown, UserPlus,
} from 'lucide-react';
import { PHASE_COLORS } from '@/lib/constants';
import type { useAppData } from '@/lib/app-data-context';

type League = ReturnType<typeof useAppData>['leagues'][number];

export const leaguePages = [
  { path: '', label: 'Standings', icon: Trophy },
  { path: '/draft', label: 'Draft Board', icon: LayoutDashboard },
  { path: '/schedule', label: 'Schedule', icon: Calendar },
  { path: '/stats', label: 'Pokemon Stats', icon: BarChart3 },
  { path: '/trades', label: 'Trade Block', icon: ArrowLeftRight },
  { path: '/free-agents', label: 'Free Agents', icon: UserPlus },
];

interface SidebarLeagueNavProps {
  leagues: League[];
  openLeagueId: string | null;
  onToggle: (id: string) => void;
  pendingByLeague: Record<string, number>;
}

export function SidebarLeagueNav({ leagues, openLeagueId, onToggle, pendingByLeague }: SidebarLeagueNavProps) {
  return (
    <>
      {leagues.map(league => {
        const isOpen = openLeagueId === league.id;

        return (
          <div key={league.id}>
            {/* League header — accordion toggle */}
            <button
              onClick={() => onToggle(league.id)}
              className="gem-wrapper w-full flex items-center gap-1.5 py-1.5 px-1 transition-all duration-150"
            >
              <div className={`league-banner league-banner-${league.id} flex-1 min-w-0`}>
                <span className="league-banner-text text-white truncate">
                  {league.name.replace(' League', '')}
                </span>
              </div>
              <span className={cn(
                'text-[9px] px-1 py-0.5 rounded font-bold uppercase shrink-0',
                PHASE_COLORS[league.season.phase],
              )}>
                {league.season.phase === 'regular'
                  ? `W${league.season.currentWeek}`
                  : league.season.phase.slice(0, 3)}
              </span>
              <ChevronDown
                size={14}
                className={cn(
                  'text-text-muted transition-transform duration-200 shrink-0',
                  isOpen && 'rotate-180',
                )}
              />
            </button>

            {/* Collapsible sub-pages */}
            <div className={cn(
              'grid transition-all duration-200 ease-out',
              isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
            )}>
              <div className="overflow-hidden">
                <div className="pl-4 space-y-0.5 py-1">
                  {leaguePages.map(({ path, label, icon: Icon }) => {
                    const to = `/league/${league.id}${path}`;
                    const tradeBadge = path === '/trades' ? (pendingByLeague[league.id] ?? 0) : 0;
                    return (
                      <NavLink viewTransition
                        key={path}
                        to={to}
                        end={path === ''}
                        className={({ isActive }) => cn(
                          'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors',
                          isActive
                            ? 'text-text-primary font-medium'
                            : 'text-text-muted hover:bg-surface-overlay/60 hover:text-text-secondary',
                        )}
                        style={({ isActive }) => isActive ? {
                          backgroundColor: `${league.color}15`,
                          color: league.color,
                        } : undefined}
                      >
                        <Icon size={14} />
                        {label}
                        {tradeBadge > 0 && (
                          <span
                            title={`${tradeBadge} pending trade proposal${tradeBadge === 1 ? '' : 's'}`}
                            className="ml-auto inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-purple-400/20 text-purple-400 text-[9px] font-bold tabular-nums"
                          >
                            {tradeBadge}
                          </span>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
