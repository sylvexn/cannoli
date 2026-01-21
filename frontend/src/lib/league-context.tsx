import { createContext, useContext } from 'react';
import type { League } from './types';

const LeagueContext = createContext<League | null>(null);

export function LeagueProvider({ league, children }: { league: League; children: React.ReactNode }) {
  return <LeagueContext.Provider value={league}>{children}</LeagueContext.Provider>;
}

export function useLeague(): League {
  const league = useContext(LeagueContext);
  if (!league) throw new Error('useLeague must be used within a LeagueProvider');
  return league;
}

export function useLeagueOptional(): League | null {
  return useContext(LeagueContext);
}
