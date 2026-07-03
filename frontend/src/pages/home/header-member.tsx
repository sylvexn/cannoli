import { Link } from 'react-router-dom';
import { Compass, ChevronRight } from 'lucide-react';
import { PHASE_COLORS, leagueGem } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { League } from '@/lib/types';

/**
 * Member-no-team header — logged-in user who doesn't manage any team in any
 * active league. Compact row (not a hero). The /me version is a tall card
 * with a giant 'Browse leagues' button; this version sits in the same
 * footprint as the guest header so the page rhythm stays consistent.
 */
export function HeaderMember({
  username, leagues,
}: {
  username: string;
  leagues: League[];
}) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-raised px-4 py-3 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text-primary">
          Welcome back, <span className="text-neon">{username}</span>.
        </div>
        <p className="text-xs text-text-muted">
          Not on a team yet. You can still scout, browse rosters, and follow along.
        </p>
      </div>

      <Link
        to="/matchup"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary bg-surface-overlay/60 hover:bg-surface-overlay hover:text-text-primary transition-colors"
      >
        <Compass size={12} />
        Scout matchup
      </Link>

      {leagues.length > 0 && (
        <div className="basis-full flex flex-wrap items-center gap-1.5 pt-2 border-t border-border-subtle">
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted shrink-0">
            Active
          </span>
          {leagues.map(league => (
            <Link
              key={league.id}
              to={`/league/${league.id}`}
              className="gem-wrapper group inline-flex items-center gap-1.5 transition-all"
            >
              <div className={`league-banner league-banner-${leagueGem(league.id)}`}>
                <span className="league-banner-text text-white">
                  {league.name.replace(' League', '')}
                </span>
              </div>
              <span className={cn(
                'text-[9px] px-1 py-0.5 rounded font-bold uppercase shrink-0',
                PHASE_COLORS[league.season.phase],
              )}>
                {league.season.phase === 'regular'
                  ? `W${league.season.currentWeek}`
                  : league.season.phase.slice(0, 3)}
              </span>
              <ChevronRight
                size={11}
                className="text-text-muted/60 group-hover:text-text-muted transition-colors shrink-0"
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
