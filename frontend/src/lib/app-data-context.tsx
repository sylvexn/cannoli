import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { api } from './api';
import { DEFAULT_RULESET } from '@cannoli/rules';
import type { League, LeagueSeason } from './types';
import { normalizeRuleset } from './league-ruleset';

interface AppData {
  leagues: League[];
  loading: boolean;
  refreshLeagues: () => void;
}

const AppDataContext = createContext<AppData>({ leagues: [], loading: true, refreshLeagues: () => {} });

export function mapLeagues(apiLeagues: Awaited<ReturnType<typeof api.getLeagues>>): League[] {
  return apiLeagues.map(a => {
    const season: LeagueSeason = a.season ? {
      id: a.season.id,
      seasonNumber: a.season.seasonNumber,
      phase: a.season.phase,
      currentWeek: a.season.currentWeek,
      totalWeeks: a.season.totalWeeks,
      pointCap: a.season.pointCap ?? DEFAULT_RULESET.pointCap,
      teraCaptainSlots: a.season.teraCaptainSlots ?? DEFAULT_RULESET.teraCaptainSlots,
      tradeDeadlineWeek: a.season.tradeDeadlineWeek ?? 7,
      rosterSize: a.season.rosterSize ?? DEFAULT_RULESET.rosterSize,
      minRosterSize: a.season.minRosterSize ?? null,
      maxRosterSize: a.season.maxRosterSize ?? null,
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
      pointCap: DEFAULT_RULESET.pointCap,
      teraCaptainSlots: DEFAULT_RULESET.teraCaptainSlots,
      tradeDeadlineWeek: 7,
      rosterSize: DEFAULT_RULESET.rosterSize,
      minRosterSize: null,
      maxRosterSize: null,
    };
    const costFormat = (a.costFormat as import('@/data/tier-list').CostFormat) ?? 'natdexplus';
    // `ruleset` rides on the league object (read via getLeagueRuleset); the API
    // payload carries it once the backend ships it, else it derives from legacy fields.
    const ruleset = normalizeRuleset((a as { ruleset?: unknown }).ruleset, { costFormat, season });
    return {
      ruleset,
      id: a.id,
      name: a.name,
      color: a.color,
      draftDate: a.draftDate,
      timezone: a.timezone ?? 'America/New_York',
      playoffTeamCount: a.playoffTeamCount ?? 6,
      costFormat,
      season,
      resultsRevealedThrough: a.resultsRevealedThrough ?? null,
      players: [],
      playerCount: a.playerCount ?? 0,
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
