import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Trophy, Swords, Users, BarChart3, Calendar, ArrowLeftRight,
  Shield, LayoutDashboard, ChevronDown, Globe,
} from 'lucide-react';
import { leagues } from '@/mocks/leagues';
import { useState, useEffect } from 'react';

const phaseColors: Record<string, string> = {
  draft: 'text-draw bg-draw/10',
  regular: 'text-neon bg-neon/10',
  playoffs: 'text-pink bg-pink/10',
  offseason: 'text-text-muted bg-surface-overlay',
};

const leaguePages = [
  { path: '', label: 'Standings', icon: Trophy },
  { path: '/draft', label: 'Draft Board', icon: LayoutDashboard },
  { path: '/schedule', label: 'Schedule', icon: Calendar },
  { path: '/stats', label: 'Pokemon Stats', icon: BarChart3 },
  { path: '/teams', label: 'Teams', icon: Users },
  { path: '/trades', label: 'Trade Block', icon: ArrowLeftRight },
];

// Routes that need full-width layout (no max-w constraint)
const WIDE_ROUTES = ['/draft'];

export function AppShell() {
  const { pathname } = useLocation();
  const isWide = WIDE_ROUTES.some(r => pathname.includes(r));

  // Track which league accordion is open — auto-open based on current route
  const activeLeagueId = pathname.match(/^\/league\/([^/]+)/)?.[1] ?? null;
  const [openLeagues, setOpenLeagues] = useState<Set<string>>(
    activeLeagueId ? new Set([activeLeagueId]) : new Set(),
  );

  // Auto-open the league accordion when navigating into a league
  useEffect(() => {
    if (activeLeagueId && !openLeagues.has(activeLeagueId)) {
      setOpenLeagues(prev => new Set([...prev, activeLeagueId]));
    }
  }, [activeLeagueId]);

  function toggleLeague(id: string) {
    setOpenLeagues(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-surface-raised border-r border-border-default flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-border-default">
          <h1 className="text-lg font-heading font-bold text-neon tracking-tighter">cannoli</h1>
          <p className="text-[10px] text-text-muted mt-0.5">Season 10</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 px-2 space-y-1 overflow-y-auto">
          {/* League Overview */}
          <NavLink
            to="/"
            end
            className={({ isActive }) => cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-neon/10 text-neon'
                : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
            )}
          >
            <Globe size={16} />
            League Overview
          </NavLink>

          {/* League sections */}
          {leagues.map(league => {
            const isOpen = openLeagues.has(league.id);
            const isActiveLeague = activeLeagueId === league.id;

            return (
              <div key={league.id}>
                {/* League header — accordion toggle */}
                <button
                  onClick={() => toggleLeague(league.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150',
                    isActiveLeague
                      ? 'text-text-primary'
                      : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
                  )}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: league.color }}
                  />
                  <span className="flex-1 text-left truncate text-xs font-semibold uppercase tracking-wider">
                    {league.name.replace(' League', '')}
                  </span>
                  <span className={cn(
                    'text-[9px] px-1 py-0.5 rounded font-bold uppercase',
                    phaseColors[league.season.phase],
                  )}>
                    {league.season.phase === 'regular'
                      ? `W${league.season.currentWeek}`
                      : league.season.phase.slice(0, 3)}
                  </span>
                  <ChevronDown
                    size={14}
                    className={cn(
                      'text-text-muted transition-transform duration-200',
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
                        return (
                          <NavLink
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
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Separator */}
          <div className="h-px bg-border-subtle mx-2 my-1" />

          {/* League-independent pages */}
          <NavLink
            to="/matchup"
            className={({ isActive }) => cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-neon/10 text-neon'
                : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
            )}
          >
            <Swords size={16} />
            Matchup Center
          </NavLink>

          <NavLink
            to="/admin"
            className={({ isActive }) => cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-neon/10 text-neon'
                : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
            )}
          >
            <Shield size={16} />
            Admin
          </NavLink>
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-border-default">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-neon/20 flex items-center justify-center text-neon text-xs font-bold">
              A
            </div>
            <div className="text-xs">
              <div className="text-text-primary font-medium">Admin</div>
              <div className="text-text-muted">admin</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-surface">
        <div className={isWide ? 'p-4 h-full' : 'max-w-7xl mx-auto p-6'}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
