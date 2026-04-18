import { useState, useEffect, useMemo } from 'react';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { preloadSprites } from '@/components/pokemon-sprite';
import { WeekSelector } from './week-selector';
import { MatchCard } from './match-card';
import { PlayoffBracket } from './playoff-bracket';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { MatchCardSkeleton } from '@/components/skeletons';
import { Calendar, Trophy } from 'lucide-react';
import { AvailabilityPanel } from './availability-panel';

type ScheduleView = 'regular' | 'playoffs';

export function SchedulePage() {
  const league = useLeague();
  const { players, matches, byes, getWeekMatches, loading } = useLeagueData();
  const season = league.season;

  const hasPlayoffs = useMemo(
    () => matches.some(m => m.phase === 'playoffs'),
    [matches],
  );

  const [view, setView] = useState<ScheduleView>('regular');
  const [selectedWeek, setSelectedWeek] = useState(season?.currentWeek ?? 1);

  useEffect(() => {
    if (season?.currentWeek) setSelectedWeek(season.currentWeek);
  }, [season?.currentWeek]);

  // Auto-select playoffs view if season is in playoffs phase
  useEffect(() => {
    if (season?.phase === 'playoffs' && hasPlayoffs) {
      setView('playoffs');
    }
  }, [season?.phase, hasPlayoffs]);

  const playerMap = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);

  // Only show regular season matches in week view
  const weekMatches = useMemo(
    () => getWeekMatches(selectedWeek).filter(m => m.phase !== 'playoffs'),
    [getWeekMatches, selectedWeek],
  );

  /** Teams sitting out the selected week (only populated for odd-team leagues). */
  const weekByes = useMemo(
    () => byes
      .filter(b => b.week === selectedWeek)
      .map(b => playerMap.get(b.teamId))
      .filter((p): p is NonNullable<typeof p> => !!p),
    [byes, selectedWeek, playerMap],
  );

  useEffect(() => {
    const names = weekMatches.flatMap(m => {
      const home = playerMap.get(m.homePlayer);
      const away = playerMap.get(m.awayPlayer);
      return [...(home?.roster ?? []), ...(away?.roster ?? [])].map(p => p.name);
    });
    preloadSprites(names);
  }, [weekMatches, playerMap]);

  if (loading || !season) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-7 w-52 bg-surface-overlay/50 mb-2" />
          <Skeleton className="h-4 w-40 bg-surface-overlay/50" />
        </div>
        <Skeleton className="h-9 w-full bg-surface-overlay/50 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <MatchCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const isCompleted = selectedWeek <= season.currentWeek;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span className="text-pink">Schedule</span>
            <span className="text-text-primary ml-1">&amp; Results</span>
          </h1>
          <p className="text-sm text-text-muted">
            Season {season.seasonNumber} &middot; {season.totalWeeks} weeks
            {view === 'regular' && isCompleted && selectedWeek === season.currentWeek && ' — most recent'}
            {view === 'regular' && season.weekDates?.[String(selectedWeek)] && (
              <span className="ml-1">&middot; Week of {new Date(season.weekDates[String(selectedWeek)] + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</span>
            )}
          </p>
          {league.draftDate && season.phase === 'draft' && (
            <p className="text-xs text-pink font-medium mt-0.5">
              Draft: {new Date(league.draftDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              {' at '}
              {new Date(league.draftDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
        </div>

        {/* View toggle */}
        {hasPlayoffs && (
          <div className="flex rounded-lg border border-border-default overflow-hidden">
            <button
              onClick={() => setView('regular')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                view === 'regular'
                  ? 'bg-surface-overlay text-text-primary'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
              )}
            >
              <Calendar size={13} />
              Regular Season
            </button>
            <button
              onClick={() => setView('playoffs')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                view === 'playoffs'
                  ? 'bg-pink/10 text-pink'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
              )}
            >
              <Trophy size={13} />
              Playoffs
            </button>
          </div>
        )}
      </div>

      {view === 'regular' ? (
        <>
          <WeekSelector
            totalWeeks={season.totalWeeks}
            currentWeek={season.currentWeek}
            selectedWeek={selectedWeek}
            onSelectWeek={setSelectedWeek}
            weekDates={season.weekDates}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {weekMatches.map(match => {
              const home = playerMap.get(match.homePlayer);
              const away = playerMap.get(match.awayPlayer);
              if (!home || !away) return null;
              return <MatchCard key={match.id} match={match} homePlayer={home} awayPlayer={away} />;
            })}
          </div>

          {weekByes.length > 0 && (
            <div className="rounded-md border border-dashed border-border-subtle px-3 py-2 flex items-center gap-3 text-xs">
              <span className="font-mono uppercase tracking-widest text-text-muted/70">Bye</span>
              <div className="flex flex-wrap items-center gap-2">
                {weekByes.map(team => (
                  <span key={team.id} className="inline-flex items-center gap-1.5 text-text-secondary">
                    <span className="font-medium">{team.teamAbbrev}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <AvailabilityPanel selectedWeek={selectedWeek} />
        </>
      ) : (
        <PlayoffBracket />
      )}
    </div>
  );
}
