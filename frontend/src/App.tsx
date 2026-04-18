import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/lib/auth-context';
import { AppDataProvider } from '@/lib/app-data-context';
import { PokemonSideCardProvider } from '@/components/pokemon-side-card-context';
import { Toaster } from '@/components/ui/sonner';
import { ProtectedRoute } from '@/components/protected-route';
import { AppShell } from '@/components/app-shell';
import { LeagueLayout } from '@/components/league-layout';
import { PageLoadingSpinner } from '@/components/skeletons';
import { LoginPage } from '@/pages/login';
import { ChangePasswordPage } from '@/pages/change-password';
import { LeagueOverviewPage } from '@/pages/league-overview';
import { StandingsPage } from '@/pages/standings';
import { TeamProfilePage } from '@/pages/team-profile';
import { SchedulePage } from '@/pages/schedule';
import { TradeBlockPage } from '@/pages/trade-block';
import { FreeAgentsPage } from '@/pages/free-agents';
import { UserSettingsPage } from '@/pages/settings';
import { AdminPage } from '@/pages/admin';
import { ArchivePage } from '@/pages/archive';
import { ReplaysPage } from '@/pages/replays';
import { StreamPage } from '@/pages/replays/stream';
import { PokemonDetailPage } from '@/pages/pokemon-detail';
import { ShowdownPage } from '@/pages/showdown';
import { CoachProfilePage } from '@/pages/coach-profile';

// Lazy-loaded heavy routes
const DraftBoardPage = lazy(() => import('./pages/draft-board').then(m => ({ default: m.DraftBoardPage })));
const MatchupCenterPage = lazy(() => import('./pages/matchup-center').then(m => ({ default: m.MatchupCenterPage })));
const StatsPage = lazy(() => import('./pages/stats').then(m => ({ default: m.StatsPage })));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppDataProvider>
        <TooltipProvider>
          <PokemonSideCardProvider>
          <Routes>
            {/* Public routes — no sidebar */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />

            {/* Theater-mode broadcast cockpit — admin only, outside the AppShell. */}
            <Route element={<ProtectedRoute requireAdmin />}>
              <Route path="/replays/stream/:week" element={<StreamPage />} />
            </Route>

            {/* App shell (works for both guests and authenticated users) */}
            <Route element={<AppShell />}>
              <Route index element={<LeagueOverviewPage />} />

              <Route path="league/:leagueId" element={<LeagueLayout />}>
                <Route index element={<StandingsPage />} />
                <Route path="schedule" element={<SchedulePage />} />
                <Route path="stats" element={<Suspense fallback={<PageLoadingSpinner />}><StatsPage /></Suspense>} />
                <Route path="teams/:id" element={<TeamProfilePage />} />

                {/* Protected league routes */}
                <Route element={<ProtectedRoute />}>
                  <Route path="draft" element={<Suspense fallback={<PageLoadingSpinner />}><DraftBoardPage /></Suspense>} />
                  <Route path="trades" element={<TradeBlockPage />} />
                  <Route path="free-agents" element={<FreeAgentsPage />} />
                </Route>
              </Route>

              <Route path="pokemon/:name" element={<PokemonDetailPage />} />
              <Route path="coach/:username" element={<CoachProfilePage />} />
              <Route path="showdown" element={<ShowdownPage />} />
              <Route path="replays" element={<ReplaysPage />} />
              <Route path="archive" element={<ArchivePage />} />

              {/* Protected global routes */}
              <Route element={<ProtectedRoute />}>
                <Route path="matchup" element={<Suspense fallback={<PageLoadingSpinner />}><MatchupCenterPage /></Suspense>} />
                <Route path="settings" element={<UserSettingsPage />} />
                <Route element={<ProtectedRoute requireAdmin />}>
                  <Route path="admin" element={<AdminPage />} />
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
