import { useParams, Navigate, Outlet, Link, useLocation } from 'react-router-dom';
import { getLeague } from '@/mocks/leagues';
import { LeagueProvider } from '@/lib/league-context';
import { ChevronRight } from 'lucide-react';

const routeLabels: Record<string, string> = {
  '': 'Standings',
  'draft': 'Draft Board',
  'schedule': 'Schedule',
  'stats': 'Pokemon Stats',
  'teams': 'Teams',
  'trades': 'Trade Block',
};

export function LeagueLayout() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const league = leagueId ? getLeague(leagueId) : undefined;
  const { pathname } = useLocation();

  if (!league) return <Navigate to="/" replace />;

  // Derive current page label from URL
  const segments = pathname.split('/').filter(Boolean);
  // /league/sapphire/schedule → segments = ['league', 'sapphire', 'schedule']
  const pageSegment = segments[2] ?? '';
  const pageLabel = routeLabels[pageSegment] ?? pageSegment;

  return (
    <LeagueProvider league={league}>
      <div className="space-y-4">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 text-xs text-text-muted">
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

        {/* Page content */}
        {league.hasData ? (
          <Outlet />
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-text-muted gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: league.color }}
            />
            <span className="text-lg font-heading">{league.name}</span>
            <span className="text-sm">Season data coming soon</span>
          </div>
        )}
      </div>
    </LeagueProvider>
  );
}
