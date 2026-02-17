import { createContext, useContext, useState, useEffect, useCallback } from 'react';
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
      tradeDeadlineWeek: a.season.tradeDeadlineWeek ?? 7,
    } : {
      id: 'unknown',
      seasonNumber: 0,
      phase: 'offseason',
      currentWeek: 0,
      totalWeeks: 0,
      tradeDeadlineWeek: 7,
    };
    return {
      id: a.id,
      name: a.name,
      color: a.color,
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

  return (
    <AppDataContext.Provider value={{ leagues, loading, refreshLeagues }}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppData {
  return useContext(AppDataContext);
}
