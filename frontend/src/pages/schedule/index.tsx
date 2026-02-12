import { useState, useEffect, useMemo } from 'react';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { preloadSprites } from '@/components/pokemon-sprite';
import { WeekSelector } from './week-selector';
import { MatchCard } from './match-card';

export function SchedulePage() {
  const league = useLeague();
  const { players, getWeekMatches, loading } = useLeagueData();
  const season = league.season;

  const [selectedWeek, setSelectedWeek] = useState(season?.currentWeek ?? 1);

  useEffect(() => {
    if (season?.currentWeek) setSelectedWeek(season.currentWeek);
  }, [season?.currentWeek]);

  const playerMap = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);
  const weekMatches = useMemo(() => getWeekMatches(selectedWeek), [getWeekMatches, selectedWeek]);

  useEffect(() => {
    const names = weekMatches.flatMap(m => {
      const home = playerMap.get(m.homePlayer);
      const away = playerMap.get(m.awayPlayer);
      return [...(home?.roster ?? []), ...(away?.roster ?? [])].map(p => p.name);
    });
    preloadSprites(names);
  }, [weekMatches, playerMap]);

  if (loading || !season) {
    return <div className="text-text-muted">Loading schedule...</div>;
  }

  const isCompleted = selectedWeek <= season.currentWeek;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-pink">Schedule</span>
          <span className="text-text-primary ml-1">&amp; Results</span>
        </h1>
        <p className="text-sm text-text-muted">
          Season {season.seasonNumber} &middot; {season.totalWeeks} weeks
          {isCompleted && selectedWeek === season.currentWeek && ' — most recent'}
        </p>
      </div>

      <WeekSelector
        totalWeeks={season.totalWeeks}
        currentWeek={season.currentWeek}
        selectedWeek={selectedWeek}
        onSelectWeek={setSelectedWeek}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {weekMatches.map(match => {
          const home = playerMap.get(match.homePlayer);
          const away = playerMap.get(match.awayPlayer);
          if (!home || !away) return null;
          return <MatchCard key={match.id} match={match} homePlayer={home} awayPlayer={away} />;
        })}
      </div>
    </div>
  );
}
