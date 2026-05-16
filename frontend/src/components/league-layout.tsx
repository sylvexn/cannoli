import { useParams, Outlet, Link, useLocation } from 'react-router-dom';
import { LeagueProvider } from '@/lib/league-context';
import { LeagueDataProvider } from '@/lib/league-data-context';
import { useAppData } from '@/lib/app-data-context';
import { ChevronRight, Home, Archive, SearchX } from 'lucide-react';

const routeLabels: Record<string, string> = {
  '': 'Standings',
  'draft': 'Draft Board',
  'schedule': 'Schedule',
  'stats': 'Pokemon Stats',
  'teams': 'Team Profile',
  'trades': 'Trade Block',
  'free-agents': 'Free Agents',
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

  if (!league) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
        <SearchX size={40} className="text-text-muted" />
        <div className="space-y-1">
          <h1 className="text-lg font-mono font-bold uppercase tracking-tight text-text-primary">
            League not found
          </h1>
          <p className="text-sm text-text-muted max-w-md">
            <span className="font-mono text-text-secondary">{leagueId}</span> isn't an
            active league. Archived seasons live in the Season Archive.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface-raised px-3 py-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary hover:border-neon/40"
          >
            <Home size={13} />
            League Overview
          </Link>
          <Link
            to="/archive"
            className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface-raised px-3 py-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary hover:border-neon/40"
          >
            <Archive size={13} />
            Season Archive
          </Link>
        </div>
      </div>
    );
  }

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

          {/* Page content — flex-1 so draft board can fill height.
              overflow-hidden ensures the child sees this as its containing block. */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <Outlet />
          </div>
        </div>
      </LeagueDataProvider>
    </LeagueProvider>
  );
}
