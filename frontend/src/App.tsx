import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import { TierListPage } from '@/pages/tier-list';
import { StandingsPage } from '@/pages/standings';
import { TeamProfilePage } from '@/pages/team-profile';
import { SchedulePage } from '@/pages/schedule';
import { TradeBlockPage } from '@/pages/trade-block';
import { FreeAgentsPage } from '@/pages/free-agents';
import { UserSettingsPage } from '@/pages/settings';
import { AdminPage } from '@/pages/admin';
import {
  AdminUsersRoute, AdminTeamsRoute, AdminLeaguesRoute, AdminSeasonRoute,
  AdminMatchesRoute, AdminTradesRoute, AdminFreeAgentsRoute, AdminTierListRoute,
  AdminTemplatesRoute,
  AdminMoveCategoriesRoute, AdminSiteSettingsRoute, AdminActivityRoute,
  AdminApiLogsRoute, AdminFeedbackRoute, AdminBotRoute, AdminPinsRoute,
  AdminPinsLegacyRedirect, AdminSimRoute,
} from '@/pages/admin/admin-routes';
import { ArchiveLayout } from '@/pages/archive/layout';
import { ArchiveHubPage } from '@/pages/archive/hub';
import { ArchiveSeasonPage } from '@/pages/archive/season';
import { ArchiveLeaguePage } from '@/pages/archive/league';
import { ArchiveTeamPage } from '@/pages/archive/team';
import { ReplaysPage } from '@/pages/replays';
import { StreamPage } from '@/pages/replays/stream';
import { PokemonDetailPage } from '@/pages/pokemon-detail';
import { ShowdownPage } from '@/pages/showdown';
import { CoachProfilePage } from '@/pages/coach-profile';
import { CoachTeamsIndexPage } from '@/pages/coach-profile/teams-index';

// Lazy-loaded heavy routes
const DraftBoardPage = lazy(() => import('./pages/draft-board').then(m => ({ default: m.DraftBoardPage })));
const DraftPracticePage = lazy(() => import('./pages/draft-board').then(m => ({ default: m.DraftPracticePage })));
const MatchupCenterPage = lazy(() => import('./pages/matchup-center').then(m => ({ default: m.MatchupCenterPage })));
const StatsPage = lazy(() => import('./pages/stats').then(m => ({ default: m.StatsPage })));
const SpeedTiersPage = lazy(() => import('./pages/speed-tiers').then(m => ({ default: m.SpeedTiersPage })));

export default function App() {
  return (
    <BrowserRouter>
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
                  <Route path="trades" element={<TradeBlockPage />} />
                  <Route path="free-agents" element={<FreeAgentsPage />} />
                </Route>
              </Route>

              <Route path="pokemon/:name" element={<PokemonDetailPage />} />
              <Route path="coach/:username" element={<CoachProfilePage />} />
              <Route path="coach/:username/teams" element={<CoachTeamsIndexPage />} />
              <Route path="showdown" element={<ShowdownPage />} />
              <Route path="replays" element={<ReplaysPage />} />
              <Route path="archive" element={<ArchiveLayout />}>
                <Route index element={<ArchiveHubPage />} />
                <Route path=":seasonId" element={<ArchiveSeasonPage />} />
                <Route path=":seasonId/:leagueId" element={<ArchiveLeaguePage />} />
                <Route path=":seasonId/:leagueId/:teamId" element={<ArchiveTeamPage />} />
              </Route>
              <Route path="rules" element={<RulesPage />} />
              <Route path="tiers" element={<TierListPage />} />
              <Route path="speed-tiers" element={<Suspense fallback={<PageLoadingSpinner />}><SpeedTiersPage /></Suspense>} />

              {/* Protected global routes */}
              <Route element={<ProtectedRoute />}>
                <Route path="matchup" element={<Suspense fallback={<PageLoadingSpinner />}><MatchupCenterPage /></Suspense>} />
                <Route path="settings" element={<UserSettingsPage />} />
                <Route element={<ProtectedRoute requireAdmin />}>
                  <Route path="admin" element={<AdminPage />}>
                    <Route index element={<AdminUsersRoute />} />
                    <Route path="users" element={<AdminUsersRoute />} />
                    <Route path="teams" element={<AdminTeamsRoute />} />
                    <Route path="leagues" element={<AdminLeaguesRoute />} />
                    <Route path="season" element={<AdminSeasonRoute />} />
                    <Route path="matches" element={<AdminMatchesRoute />} />
                    <Route path="trades" element={<AdminTradesRoute />} />
                    <Route path="free-agents" element={<AdminFreeAgentsRoute />} />
                    <Route path="tiers" element={<AdminTierListRoute />} />
                    <Route path="templates" element={<AdminTemplatesRoute />} />
                    <Route path="moves" element={<AdminMoveCategoriesRoute />} />
                    <Route path="pins" element={<AdminPinsRoute />} />
                    <Route path="pins/definitions" element={<AdminPinsLegacyRedirect />} />
                    <Route path="pins/award" element={<AdminPinsLegacyRedirect />} />
                    <Route path="settings" element={<AdminSiteSettingsRoute />} />
                    <Route path="activity" element={<AdminActivityRoute />} />
                    <Route path="api-logs" element={<AdminApiLogsRoute />} />
                    <Route path="bot" element={<AdminBotRoute />} />
                    <Route path="feedback" element={<AdminFeedbackRoute />} />
                    {/* Mock-mode only — AdminSimRoute redirects to /admin on live */}
                    <Route path="sim" element={<AdminSimRoute />} />
                  </Route>
                </Route>
              </Route>
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
