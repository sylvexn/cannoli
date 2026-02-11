import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Trophy, Swords, BarChart3, Calendar, ArrowLeftRight,
  Shield, LayoutDashboard, ChevronDown, Globe,
  Settings, LogOut,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth-context';
import { leagues } from '@/mocks/leagues';
import { useState, useEffect, useMemo } from 'react';
import { NeonLogo } from './neon-logo';

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
  { path: '/trades', label: 'Trade Block', icon: ArrowLeftRight },
];

// Routes that need full-width layout (no max-w constraint)
const WIDE_ROUTES = ['/draft', '/matchup'];

export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();
  const isWide = WIDE_ROUTES.some(r => pathname.includes(r));

  // Track active league for color theming
  const activeLeagueId = pathname.match(/^\/league\/([^/]+)/)?.[1] ?? null;
  const activeLeagueColor = useMemo(
    () => leagues.find(l => l.id === activeLeagueId)?.color,
    [activeLeagueId],
  );

  // Track which league accordion is open — auto-open based on current route
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
        <div className="px-3 pt-3 pb-3 border-b border-border-default">
          <NeonLogo color={activeLeagueColor} className="w-full h-auto" />
          <div className="flex items-center justify-center gap-2 mt-1">
            <span className="inline-flex items-center rounded border border-neon/40 bg-surface-base px-2 py-0.5 text-[10px] font-mono text-neon leading-tight transition-all duration-200 hover:bg-neon/10 hover:border-neon/70 hover:shadow-[0_0_8px_rgba(34,211,238,0.3)] cursor-default">
              S10
            </span>
            <span className="w-px h-3 bg-border-default" />
            <span className="inline-flex items-center rounded border border-pink/40 bg-surface-base px-2 py-0.5 text-[10px] font-mono text-pink leading-tight transition-all duration-200 hover:bg-pink/10 hover:border-pink/70 hover:shadow-[0_0_8px_rgba(232,121,249,0.3)] cursor-default">
              alpha
            </span>
          </div>
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

            return (
              <div key={league.id}>
                {/* League header — accordion toggle */}
                <button
                  onClick={() => toggleLeague(league.id)}
                  className="gem-wrapper w-full flex items-center gap-1.5 py-1.5 px-1 transition-all duration-150"
                >
                  <div className={`league-banner league-banner-${league.id} flex-1 min-w-0`}>
                    <span className="league-banner-text text-white truncate">
                      {league.name.replace(' League', '')}
                    </span>
                  </div>
                  <span className={cn(
                    'text-[9px] px-1 py-0.5 rounded font-bold uppercase shrink-0',
                    phaseColors[league.season.phase],
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

          {isAdmin && (
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
          )}
        </nav>

        {/* Footer — user dropdown */}
        <div className="p-3 border-t border-border-default">
          <DropdownMenu>
            <DropdownMenuTrigger className="w-full flex items-center gap-2 rounded-md px-1 py-1 -mx-1 hover:bg-surface-overlay transition-colors cursor-pointer outline-none">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                isAdmin ? 'bg-neon/20 text-neon' : 'bg-surface-overlay text-text-secondary',
              )}>
                {user?.username.charAt(0).toUpperCase()}
              </div>
              <div className="text-xs text-left min-w-0">
                <div className="text-text-primary font-medium truncate">{user?.username}</div>
                <div className="text-text-muted">{user?.role}</div>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={8}>
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings size={14} />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { logout(); navigate('/login'); }}>
                <LogOut size={14} />
                Log Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
