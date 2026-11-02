import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import { useState, useEffect, useMemo } from 'react';
import { CommandPalette } from './command-palette';
import { MatchBanner } from './match-banner';
import { FeedbackDialog } from './feedback-dialog';
import { useFeedbackNotifications } from '@/lib/use-feedback-notifications';
import { useLocalStorageState } from '@/lib/use-local-storage-state';
import { PageErrorBoundary } from './page-error-boundary';
import { SimBanner } from './sim-banner';
import { AnnouncementBanners } from './announcement-banners';
import { useGemScope } from '@/lib/use-gem-scope';
import { TopBar } from './app-shell/top-bar';
import { MobileDrawer } from './app-shell/mobile-drawer';
import { leagueNavItems } from './app-shell/nav-links';
import { useProfileLinks, type MyTeam } from './app-shell/profile-menu';
import type { LiveMatch } from './app-shell/live-indicator';

// Routes that need full-width layout (no max-w constraint). The trailing
// slash on '/replay/' targets the full-bleed replay watch page (/replay/:id)
// while leaving the scrollable '/replays' gallery on the normal layout.
const WIDE_ROUTES = ['/draft', '/matchup', '/draft-center', '/showdown', '/replay/'];

export function AppShell() {
  const { pathname } = useLocation();
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

  // My teams (one per league) and pending trades addressed to me
  const [myTeams, setMyTeams] = useState<MyTeam[]>([]);
  const [pendingByLeague, setPendingByLeague] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!user || leagues.length === 0) {
      // Only clear if we currently have stale data (avoids the lint rule about
      // synchronous setState that fires unconditionally on every effect run).
      setMyTeams(prev => prev.length === 0 ? prev : []);
      setPendingByLeague(prev => Object.keys(prev).length === 0 ? prev : {});
      return;
    }
    let cancelled = false;
    api.getMyTeams().then(({ teams, pendingByLeague: byLeague }) => {
      if (cancelled) return;
      // only leagues the shell knows about, in league order
      const found = leagues.flatMap(l => {
        const t = teams.find(x => x.leagueId === l.id);
        return t ? [t] : [];
      });
      setMyTeams(found);
      const pending: Record<string, number> = {};
      for (const f of found) pending[f.leagueId] = byLeague[f.leagueId] ?? 0;
      setPendingByLeague(pending);
    }).catch(() => { /* keep previous */ });
    return () => { cancelled = true; };
  }, [user, leagues]);

  // Live match polling
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);

  useEffect(() => {
    async function checkLive() {
      try {
        const live = await api.getLiveMatches();
        setLiveMatches(live.map(m => ({ ...m, homePlayer: m.homePlayer ?? '', awayPlayer: m.awayPlayer ?? '' })));
      } catch { /* ignore */ }
    }
    if (leagues.length > 0) checkLive();
    const interval = setInterval(checkLive, 30000);
    return () => clearInterval(interval);
  }, [leagues]);

  // Active league: URL → persisted → the user's own team's league → first league.
  // On global routes the persisted value keeps the bar contextually colored.
  const urlLeagueId = pathname.match(/^\/league\/([^/]+)/)?.[1] ?? null;
  const [persistedActiveLeagueId, setPersistedActiveLeagueId] = useLocalStorageState<string | null>(
    'cannoli:activeLeagueId',
    null,
  );

  useEffect(() => {
    if (urlLeagueId && urlLeagueId !== persistedActiveLeagueId) {
      setPersistedActiveLeagueId(urlLeagueId);
    }
  }, [urlLeagueId, persistedActiveLeagueId, setPersistedActiveLeagueId]);

  const activeLeagueId = urlLeagueId ?? persistedActiveLeagueId ?? myTeams[0]?.leagueId ?? leagues[0]?.id ?? null;
  useGemScope(activeLeagueId);
  // A stale persisted id (archived league) falls through to the next candidate.
  const activeLeague = useMemo(
    () => leagues.find(l => l.id === activeLeagueId)
      ?? leagues.find(l => l.id === myTeams[0]?.leagueId)
      ?? leagues[0]
      ?? null,
    [activeLeagueId, leagues, myTeams],
  );

  const leagueItems = useMemo(
    () => activeLeague ? leagueNavItems(activeLeague.id, pendingByLeague[activeLeague.id] ?? 0) : [],
    [activeLeague, pendingByLeague],
  );
  const profileLinks = useProfileLinks(user, isAdmin, myTeams, activeLeague?.id ?? null);

  // Mobile drawer (<1024px); auto-closes on navigation.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Force the password change globally, not per-route. Enforcement used to rely
  // on the user clicking into a ProtectedRoute — but on mobile the nav links are
  // in an off-canvas drawer, so a flagged user lands on the unguarded home
  // route, never trips the guard, and gets stuck while every write silently
  // 403s. Gate the whole shell instead.
  // (/change-password renders outside AppShell, so this can't loop.)
  if (user?.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return (
    <div className="flex flex-col h-dvh overflow-hidden">
      {/* Site-wide simulator banner — only renders on mock.cannoli.live */}
      <SimBanner />
      {/* Announcement banners — fetched from /api/banners */}
      <AnnouncementBanners />
      <TopBar
        leagues={leagues}
        activeLeague={activeLeague}
        leagueItems={leagueItems}
        liveMatches={liveMatches}
        user={user}
        profileLinks={profileLinks}
        onLogout={logout}
        onOpenSearch={() => setCmdOpen(true)}
        onOpenDrawer={() => setDrawerOpen(true)}
      />
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        leagueItems={leagueItems}
        user={user}
        profileLinks={profileLinks}
        onLogout={logout}
      />

      {/* Main content.
          Non-wide routes use a fluid cap: 1280px floor (preserves the
          comfortable column on smaller monitors), grows with viewport up to
          1600px (so a 1920×1080 screen leaves only ~80px of margin per side
          instead of ~320px), and never exceeds that ceiling on 1440p+ where
          the original 1280 column already reads well. */}
      <main className={cn('flex-1 min-h-0 bg-surface', isWide ? 'overflow-hidden' : 'overflow-y-auto')}>
        <div className={cn(
          isWide ? 'p-4 h-full overflow-hidden flex flex-col' : 'max-w-[clamp(1280px,80vw,1600px)] mx-auto p-6',
        )}>
          <div className={isWide ? 'flex-1 min-h-0' : ''}>
            <PageErrorBoundary resetKey={pathname}>
              <Outlet />
            </PageErrorBoundary>
          </div>
        </div>
      </main>

      {/* Single mounted feedback dialog; opened via the feedback bus. */}
      {user && <FeedbackDialog hideTrigger />}
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      <MatchBanner />
    </div>
  );
}
