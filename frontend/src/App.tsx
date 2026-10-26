import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { lazyWithReload } from '@/lib/lazy-with-reload';
import { usePageviewBeacon } from '@/lib/analytics';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/lib/auth-context';
import { AppDataProvider } from '@/lib/app-data-context';
import { PokemonSideCardProvider } from '@/components/pokemon-side-card-context';
import { Toaster } from '@/components/ui/sonner';
import { ProtectedRoute } from '@/components/protected-route';
import { AppShell } from '@/components/app-shell';
import { PageErrorBoundary } from '@/components/page-error-boundary';
import { LeagueLayout } from '@/components/league-layout';
import { PageLoadingSpinner } from '@/components/skeletons';
import { LoginPage } from '@/pages/login';
import { ChangePasswordPage } from '@/pages/change-password';
import { HomePage } from '@/pages/home';
import { RulesPage } from '@/pages/rules';
import { PatchNotesPage } from '@/pages/patch-notes';
import { AdminTicketsRoute } from '@/pages/admin/tickets';
import { AdminPatchNotesRoute } from '@/pages/admin/patch-notes';
import { TierListPage } from '@/pages/tier-list';
import { BadgesPage } from '@/pages/badges';
import { StandingsPage } from '@/pages/standings';
import { TeamProfilePage } from '@/pages/team-profile';
import { SchedulePage } from '@/pages/schedule';
import { MarketLayout } from '@/pages/market';
import { TradeDeskPage } from '@/pages/market/trade-desk';
import { FreeAgentsPage } from '@/pages/free-agents';
import { UserSettingsPage } from '@/pages/settings';
import { AdminPage } from '@/pages/admin';
import { SettingsConsole } from '@/pages/admin/console';
import { AdminDashboard } from '@/pages/admin/dashboard';
import { AdminRulesetsRoute } from '@/pages/admin/rulesets/route';
import {
  AdminUsersRoute, AdminTeamsRoute, AdminMembershipRoute, AdminLeaguesRoute, AdminSeasonRoute,
  AdminMatchesRoute, AdminTradesRoute, AdminFreeAgentsRoute, AdminMoveCategoriesRoute, AdminActivityRoute,
  AdminApiLogsRoute, AdminBotRoute, AdminPinsRoute,
  AdminPinsLegacyRedirect, AdminSimRoute, AdminObservabilityRoute, AdminUsageRoute,
  AdminAnnouncementsRoute,
  } from '@/pages/admin/admin-routes';
import { ArchiveLayout } from '@/pages/archive/layout';
import { ArchiveHubPage } from '@/pages/archive/hub';
import { ArchiveSeasonPage } from '@/pages/archive/season';
import { ArchiveLeaguePage } from '@/pages/archive/league';
import { ArchiveTeamPage } from '@/pages/archive/team';
import { ReplaysPage } from '@/pages/replays';
import { ReplayWatchPage } from '@/pages/replay-watch';
import { StreamPage } from '@/pages/replays/stream';
import { PokemonDetailPage } from '@/pages/pokemon-detail';
import { ShowdownPage } from '@/pages/showdown';
import { CoachProfilePage } from '@/pages/coach-profile';
import { CoachTeamsIndexPage } from '@/pages/coach-profile/teams-index';
import { NotFoundPage } from '@/pages/not-found';

// Lazy-loaded heavy routes
const AdminPlayoffs = lazyWithReload(() => import("./pages/admin/playoffs").then(m => ({ default: m.AdminPlayoffs })));
const DraftBoardPage = lazyWithReload(() => import('./pages/draft-board').then(m => ({ default: m.DraftBoardPage })));
const DraftPracticePage = lazyWithReload(() => import('./pages/draft-board').then(m => ({ default: m.DraftPracticePage })));
const DraftCenterLayout = lazyWithReload(() => import('./pages/draft-center').then(m => ({ default: m.DraftCenterLayout })));
const DraftCenterHome = lazyWithReload(() => import('./pages/draft-center').then(m => ({ default: m.DraftCenterHome })));
const DraftCenterEditor = lazyWithReload(() => import('./pages/draft-center').then(m => ({ default: m.TeamEditorPage })));
const DraftCenterPast = lazyWithReload(() => import('./pages/draft-center').then(m => ({ default: m.PastTeamPage })));
const DraftCenterShared = lazyWithReload(() => import('./pages/draft-center').then(m => ({ default: m.SharedTeamPage })));
const MatchupCenterPage = lazyWithReload(() => import('./pages/matchup-center').then(m => ({ default: m.MatchupCenterPage })));
const StatsPage = lazyWithReload(() => import('./pages/stats').then(m => ({ default: m.StatsPage })));
const SpeedTiersPage = lazyWithReload(() => import('./pages/speed-tiers').then(m => ({ default: m.SpeedTiersPage })));

/** Forwards the old /league/:id/trades and /free-agents paths to the Market hub tabs. */
function MarketRedirect({ tab }: { tab: 'trades' | 'free-agents' }) {
  const { leagueId } = useParams();
  return <Navigate to={`/league/${leagueId}/market/${tab}`} replace />;
}

/** SPA pageview beacon — renders nothing; must sit inside BrowserRouter. */
function AnalyticsBeacon() {
  usePageviewBeacon();
  return null;
}
import { DevConsolePage } from '@/pages/admin/dev-console';

export default function App() {
  return (
    <BrowserRouter>
      <AnalyticsBeacon />
      <AuthProvider>
        <AppDataProvider>
        <TooltipProvider>
          <PokemonSideCardProvider>
          <Routes>
            {/* Public routes — no sidebar. Wrapped in their own error
                boundary: they render outside the AppShell <Outlet>, so a crash
                here would otherwise blank the whole app. */}
            <Route path="/login" element={<PageErrorBoundary><LoginPage /></PageErrorBoundary>} />
            <Route path="/change-password" element={<PageErrorBoundary><ChangePasswordPage /></PageErrorBoundary>} />

            {/* Theater-mode broadcast cockpit — admin only, outside the AppShell. */}
            <Route element={<ProtectedRoute requireAdmin />}>
              <Route path="/replays/stream/:week" element={<PageErrorBoundary><StreamPage /></PageErrorBoundary>} />
            </Route>

            {/* App shell (works for both guests and authenticated users) */}
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />

              {/* Legacy /me deep links — keep working by redirecting to the
                  new unified home (same route renders the personalized
                  shape automatically when the user has a team). */}
              <Route path="me" element={<Navigate to="/" replace />} />

              <Route path="league/:leagueId" element={<LeagueLayout />}>
                <Route index element={<StandingsPage />} />
                <Route path="schedule" element={<SchedulePage />} />
                <Route path="stats" element={<Suspense fallback={<PageLoadingSpinner />}><StatsPage /></Suspense>} />
                <Route path="teams/:id" element={<TeamProfilePage />} />

                {/* Protected league routes */}
                <Route element={<ProtectedRoute />}>
                  <Route path="draft" element={<Suspense fallback={<PageLoadingSpinner />}><DraftBoardPage /></Suspense>} />
                  <Route path="draft/practice" element={<Suspense fallback={<PageLoadingSpinner />}><DraftPracticePage /></Suspense>} />
                  {/* Market hub — Trade Block + Free Agents under one shell */}
                  <Route path="market" element={<MarketLayout />}>
                    <Route index element={<Navigate to="trades" replace />} />
                    <Route path="trades" element={<TradeDeskPage />} />
                    <Route path="free-agents" element={<FreeAgentsPage />} />
                  </Route>
                  {/* Back-compat redirects from the old standalone paths */}
                  <Route path="trades" element={<MarketRedirect tab="trades" />} />
                  <Route path="free-agents" element={<MarketRedirect tab="free-agents" />} />
                </Route>
              </Route>

              <Route path="pokemon/:name" element={<PokemonDetailPage />} />
              <Route path="coach/:username" element={<CoachProfilePage />} />
              <Route path="coach/:username/teams" element={<CoachTeamsIndexPage />} />
              <Route path="matchup" element={<Suspense fallback={<PageLoadingSpinner />}><MatchupCenterPage /></Suspense>} />
              <Route path="draft-center" element={<Suspense fallback={<PageLoadingSpinner />}><DraftCenterLayout /></Suspense>}>
                <Route index element={<Suspense fallback={<PageLoadingSpinner />}><DraftCenterHome /></Suspense>} />
                <Route path="team/:id" element={<Suspense fallback={<PageLoadingSpinner />}><DraftCenterEditor /></Suspense>} />
                <Route path="past/:leagueId/:teamId" element={<Suspense fallback={<PageLoadingSpinner />}><DraftCenterPast /></Suspense>} />
                <Route path="s/:token" element={<Suspense fallback={<PageLoadingSpinner />}><DraftCenterShared /></Suspense>} />
              </Route>
              <Route path="replays" element={<ReplaysPage />} />
              <Route path="replay/:matchId" element={<ReplayWatchPage />} />
              <Route path="archive" element={<ArchiveLayout />}>
                <Route index element={<ArchiveHubPage />} />
                <Route path=":seasonId" element={<ArchiveSeasonPage />} />
                <Route path=":seasonId/:leagueId" element={<ArchiveLeaguePage />} />
                <Route path=":seasonId/:leagueId/:teamId" element={<ArchiveTeamPage />} />
              </Route>
              <Route path="rules" element={<RulesPage />} />
              <Route path="patch-notes" element={<PatchNotesPage />} />
              <Route path="tiers" element={<TierListPage />} />
              <Route path="badges" element={<BadgesPage />} />
              <Route path="speed-tiers" element={<Suspense fallback={<PageLoadingSpinner />}><SpeedTiersPage /></Suspense>} />

              {/* Protected global routes */}
              <Route element={<ProtectedRoute />}>
                <Route path="showdown" element={<ShowdownPage />} />
                <Route path="settings" element={<UserSettingsPage />} />
                <Route element={<ProtectedRoute requireAdmin />}>
                  <Route path="admin" element={<AdminPage />}>
                    <Route index element={<AdminDashboard />} />
                    <Route path="users" element={<AdminUsersRoute />} />
                    <Route path="teams" element={<AdminTeamsRoute />} />
                    <Route path="membership" element={<AdminMembershipRoute />} />
                    <Route path="leagues" element={<AdminLeaguesRoute />} />
                    <Route path="season" element={<AdminSeasonRoute />} />
                    <Route path="matches" element={<AdminMatchesRoute />} />
                    <Route path="trades" element={<AdminTradesRoute />} />
                    <Route path="free-agents" element={<AdminFreeAgentsRoute />} />
                    <Route path="console" element={<SettingsConsole />} />
                    <Route path="rulesets" element={<AdminRulesetsRoute />} />
                    <Route path="rulesets/:id" element={<AdminRulesetsRoute />} />
                    <Route path="tiers" element={<Navigate to="/admin/console#tiers" replace />} />
                    <Route path="templates" element={<Navigate to="/admin/console#templates" replace />} />
                    <Route path="moves" element={<AdminMoveCategoriesRoute />} />
                    <Route path="pins" element={<AdminPinsRoute />} />
                    <Route path="pins/definitions" element={<AdminPinsLegacyRedirect />} />
                    <Route path="pins/award" element={<AdminPinsLegacyRedirect />} />
                    <Route path="announcements" element={<AdminAnnouncementsRoute />} />
                    <Route path="rules" element={<Navigate to="/admin/console#rules" replace />} />
                    <Route path="patch-notes" element={<AdminPatchNotesRoute />} />
                    <Route path="playoffs" element={<Suspense fallback={null}><AdminPlayoffs /></Suspense>} />
                    <Route path="settings" element={<Navigate to="/admin/console#general" replace />} />
                    <Route path="activity" element={<AdminActivityRoute />} />
                    <Route path="api-logs" element={<AdminApiLogsRoute />} />
                    <Route path="observability" element={<AdminObservabilityRoute />} />
                    <Route path="dev" element={<DevConsolePage />} />
                    <Route path="usage" element={<AdminUsageRoute />} />
                    <Route path="bot" element={<AdminBotRoute />} />
                    <Route path="feedback" element={<Navigate to="/admin/tickets" replace />} />
                    <Route path="tickets" element={<AdminTicketsRoute />} />
                    <Route path="tickets/:id" element={<AdminTicketsRoute />} />
                    {/* Mock-mode only — AdminSimRoute redirects to /admin on live */}
                    <Route path="sim" element={<AdminSimRoute />} />
                  </Route>
                </Route>
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
          </PokemonSideCardProvider>
        </TooltipProvider>
        <Toaster position="bottom-right" />
        </AppDataProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
