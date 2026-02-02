import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/lib/auth-context';
import { ProtectedRoute } from '@/components/protected-route';
import { AppShell } from '@/components/app-shell';
import { LeagueLayout } from '@/components/league-layout';
import { LoginPage } from '@/pages/login';
import { ChangePasswordPage } from '@/pages/change-password';
import { LeagueOverviewPage } from '@/pages/league-overview';
import { StandingsPage } from '@/pages/standings';
import { TeamProfilePage } from '@/pages/team-profile';
import { DraftBoardPage } from '@/pages/draft-board';
import { SchedulePage } from '@/pages/schedule';
import { StatsPage } from '@/pages/stats';
import { TradeBlockPage } from '@/pages/trade-block';
import { UserSettingsPage } from '@/pages/settings';
import { AdminPage } from '@/pages/admin';

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-64 text-text-muted">
      <span className="text-lg">{title} — coming soon</span>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TooltipProvider>
          <Routes>
            {/* Public routes — no sidebar */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />

            {/* Protected routes — inside AppShell */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route index element={<LeagueOverviewPage />} />

                <Route path="league/:leagueId" element={<LeagueLayout />}>
                  <Route index element={<StandingsPage />} />
                  <Route path="draft" element={<DraftBoardPage />} />
                  <Route path="schedule" element={<SchedulePage />} />
                  <Route path="stats" element={<StatsPage />} />
                  <Route path="teams/:id" element={<TeamProfilePage />} />
                  <Route path="trades" element={<TradeBlockPage />} />
                </Route>

                <Route path="matchup" element={<Placeholder title="Matchup Center" />} />
                <Route path="settings" element={<UserSettingsPage />} />

                <Route element={<ProtectedRoute requireAdmin />}>
                  <Route path="admin" element={<AdminPage />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </TooltipProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
