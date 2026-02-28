import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Trophy, Swords, BarChart3, Calendar, ArrowLeftRight,
  Shield, LayoutDashboard, ChevronDown, Globe, Gamepad2,
  Settings, LogOut, User, Archive, LogIn, Film,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import { useState, useEffect, useMemo } from 'react';
import { NeonLogo } from './neon-logo';
import { FeedbackDialog } from './feedback-dialog';
import { CommandPalette } from './command-palette';
import { MatchBanner } from './match-banner';
import { Search } from 'lucide-react';

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
const WIDE_ROUTES = ['/draft', '/matchup', '/showdown'];

export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();
  const { leagues } = useAppData();
  const isWide = WIDE_ROUTES.some(r => pathname.includes(r));

  // Command palette
  const [cmdOpen, setCmdOpen] = useState(false);
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  // Live match polling
  const [liveMatches, setLiveMatches] = useState<{ id: string; leagueId: string; homePlayer: string; awayPlayer: string; week: number }[]>([]);

  useEffect(() => {
    async function checkLive() {
      try {
        const allMatches: typeof liveMatches = [];
        for (const league of leagues) {
          const schedule = await api.getSchedule(league.id);
          const live = schedule.filter(m => m.status === 'in_progress' && (m.phase === 'regular' || m.phase === 'playoffs'));
          for (const m of live) {
            allMatches.push({ id: m.id, leagueId: league.id, homePlayer: m.homePlayer, awayPlayer: m.awayPlayer, week: m.week });
          }
        }
        setLiveMatches(allMatches);
      } catch { /* ignore */ }
    }
    if (leagues.length > 0) checkLive();
    const interval = setInterval(checkLive, 30000);
    return () => clearInterval(interval);
  }, [leagues]);

  // Track active league for color theming
  const activeLeagueId = pathname.match(/^\/league\/([^/]+)/)?.[1] ?? null;
  const activeLeagueColor = useMemo(
    () => leagues.find(l => l.id === activeLeagueId)?.color,
    [activeLeagueId, leagues],
  );

  // Track which league accordion is open — only one at a time
  const [openLeagueId, setOpenLeagueId] = useState<string | null>(activeLeagueId);

  // Auto-open the league accordion when navigating into a league
  useEffect(() => {
    if (activeLeagueId) {
      setOpenLeagueId(activeLeagueId);
    }
  }, [activeLeagueId]);

  function toggleLeague(id: string) {
    setOpenLeagueId(prev => prev === id ? null : id);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-surface-raised border-r border-border-default flex flex-col">
        {/* Logo */}
        <div className="px-3 pt-3 pb-3 border-b border-border-default">
          <NeonLogo color={activeLeagueColor} className="w-full h-auto" />
          <div className="flex items-center justify-center gap-2 mt-1">
            <span className="inline-flex items-center rounded border border-loss/40 bg-surface-base px-2 py-0.5 text-[10px] font-mono text-loss leading-tight transition-all duration-200 hover:bg-loss/10 hover:border-loss/70 hover:shadow-[0_0_8px_rgba(239,68,68,0.3)] cursor-default">
              S10
            </span>
            <span className="w-px h-3 bg-border-default" />
            <a
              href="https://github.com/sylvexn/cannoli"
              target="_blank"
              rel="noopener noreferrer"
              className="group/alpha inline-flex items-center rounded border border-pink/40 bg-surface-base px-2 py-0.5 text-[10px] font-mono text-pink leading-tight transition-all duration-200 hover:bg-pink/10 hover:border-pink/70 hover:shadow-[0_0_8px_rgba(232,121,249,0.3)] cursor-pointer"
            >
              <span className="group-hover/alpha:hidden">alpha</span>
              <span className="hidden group-hover/alpha:inline">{__COMMIT_HASH__}</span>
            </a>
          </div>
        </div>

        {/* Live match indicator */}
        {liveMatches.length > 0 && (
          <div className="px-3 pt-2 pb-1">
            <Tooltip>
              <TooltipTrigger>
                <button
                  onClick={() => {
                    if (liveMatches.length === 1) {
                      navigate(`/league/${liveMatches[0].leagueId}/schedule`);
                    }
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-1 px-2 rounded-md bg-loss/10 border border-loss/20 hover:bg-loss/15 transition-colors cursor-pointer"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-loss opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-loss" />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-loss">
                    Live{liveMatches.length > 1 ? ` (${liveMatches.length})` : ''}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="bg-surface-overlay border-border-default">
                <div className="space-y-1">
                  {liveMatches.map(m => {
                    const league = leagues.find(l => l.id === m.leagueId);
                    return (
                      <button
                        key={m.id}
                        onClick={() => navigate(`/league/${m.leagueId}/schedule`)}
                        className="flex items-center gap-2 text-xs hover:text-neon transition-colors w-full"
                      >
                        <span className="font-bold" style={{ color: league?.color }}>{league?.name.replace(' League', '')}</span>
                        <span className="text-text-muted">W{m.week}</span>
                        <span className="text-text-primary">{m.homePlayer} vs {m.awayPlayer}</span>
                      </button>
                    );
                  })}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

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
            const isOpen = openLeagueId === league.id;

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

          <NavLink
            to="/showdown"
            className={({ isActive }) => cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-orange-400/10 text-orange-400'
                : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
            )}
          >
            <Gamepad2 size={16} />
            Showdown
          </NavLink>

          <NavLink
            to="/replays"
            className={({ isActive }) => cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-neon/10 text-neon'
                : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
            )}
          >
            <Film size={16} />
            Replays
          </NavLink>

          <NavLink
            to="/archive"
            className={({ isActive }) => cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-purple-400/10 text-purple-400'
                : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
            )}
          >
            <Archive size={16} />
            Season Archive
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

        {/* Footer — My Team + user dropdown (or login for guests) */}
        <div className="p-3 border-t border-border-default space-y-2">
          {user && (
            /* My Team shortcut — greyed until user↔team mapping exists */
            <button
              disabled
              className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-text-muted/40 cursor-not-allowed"
              title="Team assignment not configured yet"
            >
              <User size={14} />
              <span>My Team</span>
            </button>
          )}

          <button
            onClick={() => setCmdOpen(true)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-text-muted hover:bg-surface-overlay hover:text-text-secondary transition-colors"
          >
            <Search size={14} />
            <span>Search</span>
            <kbd className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-text-muted">
              Ctrl+K
            </kbd>
          </button>

          {user && <FeedbackDialog />}

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="w-full flex items-center gap-2 rounded-md px-1 py-1 -mx-1 hover:bg-surface-overlay transition-colors cursor-pointer outline-none">
                <div className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                  isAdmin ? 'bg-neon/20 text-neon' : 'bg-surface-overlay text-text-secondary',
                )}>
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <div className="text-xs text-left min-w-0">
                  <div className="text-text-primary font-medium truncate">{user.username}</div>
                  <div className="text-text-muted">{user.role}</div>
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
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium text-neon hover:bg-neon/10 transition-colors"
            >
              <LogIn size={14} />
              Log In
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className={cn('flex-1 bg-surface', isWide ? 'overflow-hidden' : 'overflow-y-auto')}>
        <div className={isWide ? 'p-4 h-full overflow-hidden' : 'max-w-7xl mx-auto p-6'}>
          <Outlet />
        </div>
      </main>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      <MatchBanner />
    </div>
  );
}
