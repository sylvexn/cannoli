import { useState, useEffect, useMemo } from 'react';
import { players } from '@/mocks/players';
import { currentSeason, getWeekMatches } from '@/mocks/season';
import { preloadSprites } from '@/components/pokemon-sprite';
import { WeekSelector } from './week-selector';
import { MatchCard } from './match-card';

const playerMap = new Map(players.map(p => [p.id, p]));

export function SchedulePage() {
  const [selectedWeek, setSelectedWeek] = useState(currentSeason.currentWeek);
  const weekMatches = useMemo(() => getWeekMatches(selectedWeek), [selectedWeek]);

  useEffect(() => {
    const names = weekMatches.flatMap(m => {
      const home = playerMap.get(m.homePlayer);
      const away = playerMap.get(m.awayPlayer);
      return [...(home?.roster ?? []), ...(away?.roster ?? [])].map(p => p.name);
    });
    preloadSprites(names);
  }, [weekMatches]);

  const isCompleted = selectedWeek <= currentSeason.currentWeek;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-text-primary">Schedule & Results</h1>
        <p className="text-sm text-text-muted">
          Season {currentSeason.seasonNumber} &middot; {currentSeason.totalWeeks} weeks
          {isCompleted && selectedWeek === currentSeason.currentWeek && ' — most recent'}
        </p>
      </div>

      <WeekSelector
        totalWeeks={currentSeason.totalWeeks}
        currentWeek={currentSeason.currentWeek}
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
