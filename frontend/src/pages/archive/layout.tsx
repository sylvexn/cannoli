import { Outlet, Link, useParams, useLocation } from 'react-router-dom';
import { ChevronRight, Archive as ArchiveIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * Shared layout for /archive/* routes. Renders the breadcrumb chain
 * (Archive → Season → League → Team) and a "Read-only" badge that
 * reminds the user every nested view is historical and immutable.
 *
 * Crumbs are derived from the current URL params; we don't fetch any
 * extra data here — each child page is responsible for pulling and
 * rendering its own season/league/team labels. The layout's job is
 * structural framing only.
 */
export function ArchiveLayout() {
  const params = useParams<{ seasonId?: string; leagueId?: string; teamId?: string }>();
  const { pathname } = useLocation();

  const crumbs: { label: string; to: string | null }[] = [{ label: 'Archive', to: '/archive' }];
  if (params.seasonId) {
    crumbs.push({
      label: `Season ${params.seasonId}`,
      to: `/archive/${params.seasonId}`,
    });
  }
  if (params.leagueId) {
    const leagueLabel = params.leagueId.charAt(0).toUpperCase() + params.leagueId.slice(1);
    crumbs.push({
      label: leagueLabel,
      to: `/archive/${params.seasonId}/${params.leagueId}`,
    });
  }
  if (params.teamId) {
    crumbs.push({ label: params.teamId, to: null });
  }
  // Last crumb is the current page — drop the link.
  if (crumbs.length > 0) crumbs[crumbs.length - 1] = { ...crumbs[crumbs.length - 1], to: null };

  // Show the read-only badge everywhere except the all-seasons hub page.
  const isHub = pathname === '/archive' || pathname === '/archive/';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3 shrink-0">
        <nav className="flex items-center gap-1 text-xs text-text-muted overflow-hidden">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight size={12} className="text-text-muted/60" />}
              {c.to ? (
                <Link to={c.to} className="hover:text-text-primary transition-colors truncate">
                  {c.label}
                </Link>
              ) : (
                <span className="text-text-primary truncate">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
        {!isHub && (
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wider border-border-default text-text-muted shrink-0"
          >
            <ArchiveIcon size={10} className="mr-1" />
            Read-only
          </Badge>
        )}
      </header>
      <Outlet />
    </div>
  );
}
