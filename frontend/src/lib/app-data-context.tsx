import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';
import type { League, LeagueSeason } from './types';

interface AppData {
  leagues: League[];
  loading: boolean;
}

const AppDataContext = createContext<AppData>({ leagues: [], loading: true });

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLeagues().then(apiLeagues => {
      setLeagues(apiLeagues.map(a => {
        const season: LeagueSeason = a.season ? {
          id: a.season.id,
          seasonNumber: a.season.seasonNumber,
          phase: a.season.phase,
          currentWeek: a.season.currentWeek,
          totalWeeks: a.season.totalWeeks,
        } : {
          id: 'unknown',
          seasonNumber: 0,
          phase: 'offseason',
          currentWeek: 0,
          totalWeeks: 0,
        };
        return {
          id: a.id,
          name: a.name,
          color: a.color,
          season,
          players: [],
          hasData: true,
        };
      }));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <AppDataContext.Provider value={{ leagues, loading }}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppData {
  return useContext(AppDataContext);
}
