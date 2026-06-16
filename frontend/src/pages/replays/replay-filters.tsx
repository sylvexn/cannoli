import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { League } from '@/lib/types';
import type { TimeFilter } from './replay-types';
import { TIME_FILTERS } from './replay-types';

export type SeasonOption = { seasonNumber: number; archived: boolean };

interface ReplayFiltersProps {
  timeFilter: TimeFilter;
  onTimeFilterChange: (f: TimeFilter) => void;
  search: string;
  onSearchChange: (s: string) => void;
  /** Leagues to show as league chips — already scoped to the selected season
   *  by the parent (empty when "All seasons" is active). */
  leagues: League[];
  leagueFilter: Set<string>;
  onToggleLeagueFilter: (id: string) => void;
  hasUser: boolean;
  /** Available seasons (desc). The season row is hidden when there's only one. */
  seasons: SeasonOption[];
  seasonFilter: number | 'all';
  onSeasonChange: (s: number | 'all') => void;
}

/**
 * Season chips, time filter chips, free-text search, and league chips. Pure
 * presentational — all state lives in the parent.
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
  seasons,
  seasonFilter,
  onSeasonChange,
}: ReplayFiltersProps) {
  return (
    <>
      {seasons.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted/70 mr-0.5">Season</span>
          <SeasonChip label="All" active={seasonFilter === 'all'} onClick={() => onSeasonChange('all')} />
          {seasons.map(s => (
            <SeasonChip
              key={s.seasonNumber}
              label={`S${s.seasonNumber}`}
              active={seasonFilter === s.seasonNumber}
              onClick={() => onSeasonChange(s.seasonNumber)}
            />
          ))}
        </div>
      )}

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

function SeasonChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors cursor-pointer',
        active
          ? 'border-purple-400/50 bg-purple-400/10 text-purple-300'
          : 'border-border-default text-text-muted hover:text-text-secondary',
      )}
    >
      {label}
    </button>
  );
}
