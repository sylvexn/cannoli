import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/app-shell';
import { StandingsPage } from '@/pages/standings';
import { TeamProfilePage } from '@/pages/team-profile';
import { DraftBoardPage } from '@/pages/draft-board';
import { SchedulePage } from '@/pages/schedule';
import { StatsPage } from '@/pages/stats';

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
      <TooltipProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<StandingsPage />} />
            <Route path="draft" element={<DraftBoardPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="matchup" element={<Placeholder title="Matchup Center" />} />
            <Route path="teams" element={<Placeholder title="Teams" />} />
            <Route path="teams/:id" element={<TeamProfilePage />} />
            <Route path="trades" element={<Placeholder title="Trade Block" />} />
            <Route path="admin" element={<Placeholder title="Admin Panel" />} />
          </Route>
        </Routes>
      </TooltipProvider>
    </BrowserRouter>
  );
}
