import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { api } from './api';
import type { League, LeagueSeason } from './types';

interface AppData {
  leagues: League[];
  loading: boolean;
  refreshLeagues: () => void;
}

const AppDataContext = createContext<AppData>({ leagues: [], loading: true, refreshLeagues: () => {} });

function mapLeagues(apiLeagues: Awaited<ReturnType<typeof api.getLeagues>>): League[] {
  return apiLeagues.map(a => {
    const season: LeagueSeason = a.season ? {
      id: a.season.id,
      seasonNumber: a.season.seasonNumber,
      phase: a.season.phase,
      currentWeek: a.season.currentWeek,
      totalWeeks: a.season.totalWeeks,
      pointCap: a.season.pointCap ?? 110,
      teraCaptainSlots: a.season.teraCaptainSlots ?? 2,
      tradeDeadlineWeek: a.season.tradeDeadlineWeek ?? 7,
      rosterSize: a.season.rosterSize ?? 10,
      forfeitPolicy: a.season.forfeitPolicy,
      paused: a.season.paused,
      archived: a.season.archived,
      weekDates: a.season.weekDates,
      weekDatesAutoFilled: a.season.weekDatesAutoFilled,
    } : {
      id: 'unknown',
      seasonNumber: 0,
      phase: 'offseason',
      currentWeek: 0,
      totalWeeks: 0,
      pointCap: 110,
      teraCaptainSlots: 2,
      tradeDeadlineWeek: 7,
      rosterSize: 10,
    };
    return {
      id: a.id,
      name: a.name,
      color: a.color,
      draftDate: a.draftDate,
      playoffTeamCount: a.playoffTeamCount ?? 6,
      season,
      players: [],
      hasData: true,
    };
  });
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshLeagues = useCallback(() => {
    api.getLeagues().then(apiLeagues => {
      setLeagues(mapLeagues(apiLeagues));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.getLeagues().then(apiLeagues => {
      setLeagues(mapLeagues(apiLeagues));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const value = useMemo<AppData>(() => ({ leagues, loading, refreshLeagues }), [leagues, loading, refreshLeagues]);

  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppData {
  return useContext(AppDataContext);
}
