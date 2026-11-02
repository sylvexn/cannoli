import { useParams, Outlet, Link, useMatch } from 'react-router-dom';
import { LeagueStripe, leagueSubline } from '@/components/league-name';
import { gemHex } from '@/lib/use-gem-scope';
import { LeagueProvider } from '@/lib/league-context';
import { LeagueDataProvider } from '@/lib/league-data-context';
import { useAppData } from '@/lib/app-data-context';
import { Home, Archive, SearchX } from 'lucide-react';

export function LeagueLayout() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { leagues, loading } = useAppData();
  const league = leagues.find(l => l.id === leagueId);
  // Team pages carry their own slab header; everything else opens on the league banner.
  const onTeamPage = useMatch('/league/:leagueId/teams/:id');

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

  return (
    <LeagueProvider league={league}>
      <LeagueDataProvider leagueId={league.id}>
        <div className="flex flex-col h-full gap-4">
          {!onTeamPage && (
            <header className="shrink-0 pt-1">
              <h1 className="sr-only">{league.name}</h1>
              <LeagueStripe name={league.name} color={gemHex(league.id)} size={34} />
              <p className="mt-2 text-sm text-text-secondary">{leagueSubline(league.season)}</p>
            </header>
          )}
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
