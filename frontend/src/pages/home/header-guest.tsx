import { Link } from 'react-router-dom';
import { LogIn, ChevronRight } from 'lucide-react';
import { PHASE_COLORS, leagueGem } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { League } from '@/lib/types';

/**
 * Guest header — minimal welcome row + login CTA + active leagues. Single row,
 * no full-bleed marketing hero. The community feed below is what guests are
 * actually here for — this is just enough orientation to get them in.
 */
export function HeaderGuest({ leagues }: { leagues: League[] }) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-raised px-4 py-3 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text-primary">
          Welcome to <span className="text-neon">Cannoli</span>.
        </div>
        <p className="text-xs text-text-muted">
          Pokemon draft tournament leagues. Browse below or log in to manage your team.
        </p>
      </div>

      <Link
        to="/login"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-neon bg-neon/10 hover:bg-neon/20 transition-colors"
      >
        <LogIn size={12} />
        Log In
      </Link>

      {leagues.length > 0 && (
        <div className="basis-full flex flex-wrap items-center gap-1.5 pt-2 border-t border-border-subtle/50">
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
