import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { League } from '@/lib/types';
import type { TimeFilter } from './replay-types';
import { TIME_FILTERS } from './replay-types';

interface ReplayFiltersProps {
  timeFilter: TimeFilter;
  onTimeFilterChange: (f: TimeFilter) => void;
  search: string;
  onSearchChange: (s: string) => void;
  leagues: League[];
  leagueFilter: Set<string>;
  onToggleLeagueFilter: (id: string) => void;
  hasUser: boolean;
}

/**
 * Time filter chips, free-text search, and league chips. Pure presentational —
 * all state lives in the parent.
 */
export function ReplayFilters({
  timeFilter,
  onTimeFilterChange,
  search,
  onSearchChange,
  leagues,
  leagueFilter,
  onToggleLeagueFilter,
  hasUser,
}: ReplayFiltersProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {TIME_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => onTimeFilterChange(f.id)}
            disabled={f.id === 'my-matches' && !hasUser}
            className={cn(
              'text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
              timeFilter === f.id
                ? 'border-neon/40 bg-neon/10 text-neon'
                : 'border-border-default text-text-muted hover:text-text-secondary',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search teams, players..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-md bg-surface-raised border border-border-default text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-neon/50"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {leagues.map(league => {
            const active = leagueFilter.has(league.id);
            return (
              <button
                key={league.id}
                onClick={() => onToggleLeagueFilter(league.id)}
                className={cn(
                  'text-[10px] font-bold px-2 py-1 rounded-full border transition-colors cursor-pointer',
                  active
                    ? 'border-transparent'
                    : 'border-border-default text-text-muted hover:text-text-secondary',
                )}
                style={active ? {
                  color: league.color,
                  backgroundColor: `${league.color}20`,
                  borderColor: `${league.color}40`,
                } : undefined}
              >
                {league.name.replace(' League', '')}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
