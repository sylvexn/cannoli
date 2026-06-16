import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Swords, Gamepad2,
  Archive, Film, ScrollText, ListTree, Home, Gauge,
  PanelLeftClose, PanelLeftOpen, Menu, X,
} from 'lucide-react';
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
import { CommandPalette } from './command-palette';
import { MatchBanner } from './match-banner';
import { useFeedbackNotifications } from '@/lib/use-feedback-notifications';
import { useLocalStorageState } from '@/lib/use-local-storage-state';
import { useMediaQuery } from '@/lib/use-media-query';
import { SidebarLeagueNav } from './app-shell/sidebar-league-nav';
import { SidebarNavItem } from './app-shell/sidebar-nav-item';
import { SidebarFooter } from './app-shell/sidebar-footer';
import { PageErrorBoundary } from './page-error-boundary';
import { SimBanner } from './sim-banner';

// Routes that need full-width layout (no max-w constraint)
const WIDE_ROUTES = ['/draft', '/matchup', '/showdown'];

export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();
  const { leagues } = useAppData();
  const isWide = WIDE_ROUTES.some(r => pathname.includes(r));

  // Check for resolved feedback notifications
  useFeedbackNotifications();

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

  // My-team map: leagueId → { teamId, teamAbbrev } and pending trades to me
  const [myTeams, setMyTeams] = useState<{ leagueId: string; teamId: string; teamAbbrev: string; teamName: string }[]>([]);
  const [pendingTradeCount, setPendingTradeCount] = useState(0);
  const [pendingByLeague, setPendingByLeague] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!user || leagues.length === 0) {
      // Only clear if we currently have stale data (avoids the lint rule about
      // synchronous setState that fires unconditionally on every effect run).
      setMyTeams(prev => prev.length === 0 ? prev : []);
      setPendingTradeCount(prev => prev === 0 ? prev : 0);
      return;
    }
    let cancelled = false;
    (async () => {
      const teamLists = await Promise.all(leagues.map(l => api.getTeams(l.id).catch(() => [])));
      if (cancelled) return;
      const found: typeof myTeams = [];
      const myTeamIds = new Set<string>();
      for (let i = 0; i < leagues.length; i++) {
        const league = leagues[i];
        if (!league) continue;
        const teams = teamLists[i] ?? [];
        const team = teams.find(t => t.userId != null && String(t.userId) === user.id);
        if (team) {
          found.push({ leagueId: league.id, teamId: team.id, teamAbbrev: team.teamAbbrev, teamName: team.teamName });
          myTeamIds.add(team.id);
        }
      }
      setMyTeams(found);

      // Pending trades — only fetch trade lists for leagues where the user has a team
      const tradeLists = await Promise.all(
        found.map(t => api.getTrades(t.leagueId).catch(() => [])),
      );
      if (cancelled) return;
      const byLeague: Record<string, number> = {};
      let total = 0;
      for (let i = 0; i < found.length; i++) {
        const f = found[i]!;
        const trades = tradeLists[i] ?? [];
        const count = trades.filter(tr =>
          myTeamIds.has(tr.recipientId) && (tr.status === 'pending' || tr.status === 'awaiting_admin'),
        ).length;
        byLeague[f.leagueId] = count;
        total += count;
      }
      setPendingByLeague(byLeague);
      setPendingTradeCount(total);
    })();
    return () => { cancelled = true; };
  }, [user, leagues]);

  // Live match polling
  const [liveMatches, setLiveMatches] = useState<{ id: string; leagueId: string; homePlayer: string; awayPlayer: string; week: number }[]>([]);

  useEffect(() => {
    async function checkLive() {
      try {
        const allMatches: typeof liveMatches = [];
        for (const league of leagues) {
          const schedule = await api.getSchedule(league.id);
          const live = schedule.matches.filter(m => m.status === 'in_progress' && (m.phase === 'regular' || m.phase === 'playoffs'));
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

  // Track active league for color theming. When on a /league/:id route, that's
  // the source of truth and we persist it. On global routes, we fall back to
  // the most recently-visited league so the sidebar logo + breadcrumbs remain
  // contextually colored instead of resetting to the default.
  const urlLeagueId = pathname.match(/^\/league\/([^/]+)/)?.[1] ?? null;

  // Persist URL league via shared hook (also keeps tabs in sync via storage events).
  const [persistedActiveLeagueId, setPersistedActiveLeagueId] = useLocalStorageState<string | null>(
    'cannoli:activeLeagueId',
    null,
  );

  useEffect(() => {
    if (urlLeagueId && urlLeagueId !== persistedActiveLeagueId) {
      setPersistedActiveLeagueId(urlLeagueId);
    }
  }, [urlLeagueId, persistedActiveLeagueId, setPersistedActiveLeagueId]);

  const activeLeagueId = urlLeagueId ?? persistedActiveLeagueId;
  const activeLeague = useMemo(
    () => leagues.find(l => l.id === activeLeagueId) ?? null,
    [activeLeagueId, leagues],
  );

  // Backend mode (mock = season simulator) — drives the sidebar season badge.
  const [mode, setMode] = useState<'live' | 'mock' | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.getHealth()
      .then(h => { if (!cancelled) setMode(h.mode); })
      .catch(() => { if (!cancelled) setMode(null); });
    return () => { cancelled = true; };
  }, []);

  // Sidebar season badge: prefer the active league's season; else, if every
  // league shares one season number, show that; else fall back to a SIM chip
  // in mock mode (or nothing on live).
  const seasonBadge = useMemo(() => {
    const activeNum = activeLeague?.season?.seasonNumber;
    if (activeNum) return { label: `S${activeNum}`, sim: false };
    const nums = new Set(
      leagues.map(l => l.season?.seasonNumber).filter((n): n is number => !!n),
    );
    if (nums.size === 1) return { label: `S${[...nums][0]}`, sim: false };
    if (mode === 'mock') return { label: 'SIM', sim: true };
    return null;
  }, [activeLeague, leagues, mode]);

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

  // Sidebar layout mode. At >=1024px the sidebar is docked and the user can
  // collapse it to an icon rail (persisted). Below that it becomes an
  // off-canvas drawer toggled by a hamburger, auto-closing on navigation.
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [collapsed, setCollapsed] = useLocalStorageState('cannoli:sidebarCollapsed', false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const collapsedRail = isDesktop && collapsed;

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Site-wide simulator banner — only renders on mock.cannoli.live */}
      <SimBanner />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Mobile hamburger — only when the sidebar is an off-canvas drawer */}
      {!isDesktop && !drawerOpen && (
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          className="fixed top-3 left-3 z-30 flex items-center justify-center h-9 w-9 rounded-md bg-surface-raised border border-border-default text-text-secondary hover:text-text-primary shadow-lg"
        >
          <Menu size={18} />
        </button>
      )}

      {/* Backdrop behind the open drawer */}
      {!isDesktop && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'bg-surface-raised border-r border-border-default flex flex-col z-50',
        isDesktop
          ? cn('flex-shrink-0 transition-[width] duration-200 ease-out', collapsedRail ? 'w-[60px]' : 'w-56')
          : cn('fixed inset-y-0 left-0 w-60 transition-transform duration-200 ease-out',
              drawerOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'),
      )}>
        {/* Logo */}
        <div className={cn('border-b border-border-default', collapsedRail ? 'px-2 py-3' : 'px-3 pt-3 pb-3')}>
          {collapsedRail ? (
            <img src="/favicon.svg" alt="cannoli" className="h-8 w-8 mx-auto" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <NeonLogo className="w-full h-auto" />
                {!isDesktop && (
                  <button
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Close navigation"
                    className="shrink-0 text-text-muted hover:text-text-primary p-1 -mr-1"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-center gap-2 mt-1">
            {seasonBadge && (
              <>
                <span className="inline-flex items-center rounded-full border border-loss/40 bg-surface-base px-2 py-0.5 text-[10px] font-mono text-loss leading-tight transition-all duration-200 hover:bg-loss/10 hover:border-loss/70 hover:shadow-[0_0_8px_rgba(239,68,68,0.3)] cursor-default">
                  {seasonBadge.label}
                </span>
                <span className="w-px h-3 bg-border-default" />
              </>
            )}
            <Tooltip>
              <TooltipTrigger
                render={(props) => (
                  <a
                    {...props}
                    href="https://github.com/sylvexn/cannoli"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded-full border border-pink/40 bg-surface-base px-2 py-0.5 text-[10px] font-mono text-pink leading-tight transition-all duration-200 hover:bg-pink/10 hover:border-pink/70 hover:shadow-[0_0_8px_rgba(232,121,249,0.3)] cursor-pointer"
                  >
                    alpha
                  </a>
                )}
              />
              <TooltipContent>
                <span className="font-mono text-[10px]">{__COMMIT_HASH__}</span>
              </TooltipContent>
            </Tooltip>
              </div>
            </>
          )}
        </div>

        {/* Live match indicator */}
        {liveMatches.length > 0 && (
          collapsedRail ? (
            <div className="px-2 pt-2 pb-1 flex justify-center">
              <button
                onClick={() => { if (liveMatches.length === 1) navigate(`/league/${liveMatches[0].leagueId}/schedule`); }}
                title={`${liveMatches.length} live match${liveMatches.length > 1 ? 'es' : ''}`}
                className="relative flex h-9 w-9 items-center justify-center rounded-md bg-loss/10 border border-loss/20 hover:bg-loss/15 transition-colors"
              >
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-loss opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-loss" />
                </span>
              </button>
            </div>
          ) : (
          <div className="px-3 pt-2 pb-1">
            <Tooltip>
              <TooltipTrigger>
                <button
                  onClick={() => {
                    if (liveMatches.length === 1) {
                      navigate(`/league/${liveMatches[0].leagueId}/schedule`);
                    }
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-1 px-3 rounded-full bg-loss/10 border border-loss/20 hover:bg-loss/15 transition-colors cursor-pointer"
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
          )
        )}

        {/* Nav. Home + global pages use SidebarNavItem (icon+label, or an
            icon-only rail when collapsed); the league sections render their
            own accordion / flyout. */}
        <nav className="flex-1 py-2 px-2 space-y-1 overflow-y-auto">
          <SidebarNavItem to="/" end icon={Home} label="Home" collapsed={collapsedRail} />

          <SidebarLeagueNav
            leagues={leagues}
            openLeagueId={openLeagueId}
            onToggle={toggleLeague}
            pendingByLeague={pendingByLeague}
            collapsed={collapsedRail}
          />

          <div className="h-px bg-border-subtle mx-2 my-1" />

          <SidebarNavItem to="/matchup" icon={Swords} label="Matchup Center" collapsed={collapsedRail} />
          <SidebarNavItem to="/showdown" icon={Gamepad2} label="Showdown" activeClass="bg-orange-400/10 text-orange-400" collapsed={collapsedRail} />
          <SidebarNavItem to="/replays" icon={Film} label="Replays" collapsed={collapsedRail} />
          <SidebarNavItem to="/archive" icon={Archive} label="Season Archive" activeClass="bg-purple-400/10 text-purple-400" collapsed={collapsedRail} />

          <div className="h-px bg-border-subtle mx-2 my-1" />

          <SidebarNavItem to="/tiers" icon={ListTree} label="Tier List" collapsed={collapsedRail} />
          <SidebarNavItem to="/speed-tiers" icon={Gauge} label="Speed Tiers" activeClass="bg-cyan-300/10 text-cyan-300" collapsed={collapsedRail} />
          <SidebarNavItem to="/rules" icon={ScrollText} label="Rules" activeClass="bg-pink/10 text-pink" collapsed={collapsedRail} />
        </nav>

        {/* Collapse toggle — docked mode only (the drawer has its own close). */}
        {isDesktop && (
          <button
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex items-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors border-t border-border-default',
              collapsedRail ? 'justify-center py-2.5' : 'gap-2 px-4 py-2 text-xs',
            )}
          >
            {collapsed
              ? <PanelLeftOpen size={16} className="shrink-0" />
              : <><PanelLeftClose size={16} className="shrink-0" /><span>Collapse</span></>}
          </button>
        )}

        {/* Footer — My Team + user dropdown (or login for guests) */}
        <SidebarFooter
          user={user}
          isAdmin={isAdmin}
          myTeams={myTeams}
          leagues={leagues}
          pendingTradeCount={pendingTradeCount}
          onOpenCommand={() => setCmdOpen(true)}
          onLogout={logout}
          collapsed={collapsedRail}
        />
      </aside>

      {/* Main content.
          Non-wide routes use a fluid cap: 1280px floor (preserves the
          comfortable column on smaller monitors), grows with viewport up to
          1600px (so a 1920×1080 screen leaves only ~80px of margin per side
          instead of ~320px), and never exceeds that ceiling on 1440p+ where
          the original 1280 column already reads well. */}
      <main className={cn('flex-1 bg-surface', isWide ? 'overflow-hidden' : 'overflow-y-auto')}>
        <div className={cn(
          isWide ? 'p-4 h-full overflow-hidden flex flex-col' : 'max-w-[clamp(1280px,80vw,1600px)] mx-auto p-6',
          !isDesktop && 'pt-14',
        )}>
          {/* Show a return-to-league pill on global routes if we know which
              league the user was last in. Skip on Home where it would just
              be noise (the home page already surfaces league chips). */}
          {!urlLeagueId && activeLeague && pathname !== '/' && (
            <div className="mb-3 flex items-center gap-2 text-xs">
              <span className="text-text-muted">Last visited:</span>
              <NavLink
                to={`/league/${activeLeague.id}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border hover:bg-surface-overlay/40 transition-colors"
                style={{
                  borderColor: `${activeLeague.color}40`,
                  color: activeLeague.color,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: activeLeague.color }} />
                Return to {activeLeague.name}
              </NavLink>
            </div>
          )}
          {/* On wide (full-bleed) routes the container is a flex column: the
              optional "Last visited" pill above takes its natural height and
              this wrapper fills the rest, so an h-full page (e.g. Showdown)
              sizes to the remaining space instead of overflowing past the
              viewport and clipping its own bottom bar. */}
          <div className={isWide ? 'flex-1 min-h-0' : ''}>
            <PageErrorBoundary resetKey={pathname}>
              <Outlet />
            </PageErrorBoundary>
          </div>
        </div>
      </main>

      </div>
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      <MatchBanner />
    </div>
  );
}
