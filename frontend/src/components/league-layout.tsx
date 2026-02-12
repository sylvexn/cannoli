import { useParams, Navigate, Outlet, Link, useLocation } from 'react-router-dom';
import { LeagueProvider } from '@/lib/league-context';
import { LeagueDataProvider } from '@/lib/league-data-context';
import { useAppData } from '@/lib/app-data-context';
import { ChevronRight } from 'lucide-react';

const routeLabels: Record<string, string> = {
  '': 'Standings',
  'draft': 'Draft Board',
  'schedule': 'Schedule',
  'stats': 'Pokemon Stats',
  'teams': 'Team Profile',
  'trades': 'Trade Block',
};

export function LeagueLayout() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { leagues, loading } = useAppData();
  const league = leagues.find(l => l.id === leagueId);
  const { pathname } = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted">
        Loading...
      </div>
    );
  }

  if (!league) return <Navigate to="/" replace />;

  // Derive current page label from URL
  const segments = pathname.split('/').filter(Boolean);
  const pageSegment = segments[2] ?? '';
  const pageLabel = routeLabels[pageSegment] ?? pageSegment;

  return (
    <LeagueProvider league={league}>
      <LeagueDataProvider leagueId={league.id}>
        <div className="flex flex-col h-full gap-4">
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-1 text-xs text-text-muted shrink-0">
            <Link to="/" className="hover:text-text-primary transition-colors">
              Overview
            </Link>
            <ChevronRight size={12} />
            <Link
              to={`/league/${league.id}`}
              className="hover:text-text-primary transition-colors"
              style={{ color: league.color }}
            >
              {league.name}
            </Link>
            {pageSegment && (
              <>
                <ChevronRight size={12} />
                <span className="text-text-secondary">{pageLabel}</span>
              </>
            )}
          </nav>

          {/* Page content — flex-1 so draft board can fill height */}
          <div className="flex-1 min-h-0">
            <Outlet />
          </div>
        </div>
      </LeagueDataProvider>
    </LeagueProvider>
  );
}
