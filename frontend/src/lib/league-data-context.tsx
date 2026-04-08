import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from './api';
import type { Player, Match, MatchPokemonEntry, Trade } from './types';
import type { ApiTransaction, ApiByeWeek } from './api';
import type { PokemonType } from './pokemon';

interface LeagueData {
  players: Player[];
  standings: Player[];
  matches: Match[];
  /** Bye-week rows (one per team-week sit-out, only present for odd-team leagues). */
  byes: ApiByeWeek[];
  transactions: ApiTransaction[];
  loading: boolean;
  /** Get matches for a specific week (with pokemonKD lazy-loaded) */
  getWeekMatches: (week: number) => Match[];
  /** Get matches for a specific team */
  getTeamMatches: (teamId: string) => Match[];
  /** Bye weeks for a specific team (sorted by week asc). */
  getTeamByes: (teamId: string) => ApiByeWeek[];
  /** Get pokemon KD for a match (fetches on demand) */
  getMatchDetail: (matchId: string) => Promise<{ home: MatchPokemonEntry[]; away: MatchPokemonEntry[] } | null>;
  /** Get trades involving a specific team */
  getTeamTrades: (teamId: string) => Trade[];
  /** Refetch teams + transactions (e.g. after a roster mutation) */
  refresh: () => Promise<void>;
}

const LeagueDataContext = createContext<LeagueData | null>(null);

export function LeagueDataProvider({ leagueId, children }: { leagueId: string; children: React.ReactNode }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [byes, setByes] = useState<ApiByeWeek[]>([]);
  const [transactions, setTransactions] = useState<ApiTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Match detail cache
  const [detailCache] = useState(() => new Map<string, { home: MatchPokemonEntry[]; away: MatchPokemonEntry[] }>());

  const loadAll = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const [apiTeams, apiSchedule, apiTx] = await Promise.all([
        api.getTeams(leagueId),
        api.getSchedule(leagueId),
        api.getTransactions(leagueId),
      ]);
      const apiMatches = apiSchedule.matches;

      const convertedPlayers = apiTeams.map(t => ({
        id: t.id,
        name: t.name,
        teamName: t.teamName,
        teamAbbrev: t.teamAbbrev,
        teamColor: t.teamColor,
        userId: t.userId,
        record: t.record,
        roster: t.roster.map(r => ({
          name: r.name,
          types: r.types as PokemonType[],
          tier: r.tier,
          isTeraCaptain: r.isTeraCaptain,
          teraTypes: r.teraTypes as PokemonType[] | undefined,
          stats: r.stats || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          abilities: r.abilities,
          seasonStats: r.seasonStats,
          isShiny: r.isShiny,
        })),
      }));

      const convertedMatches: Match[] = apiMatches.map(m => ({
        id: m.id,
        week: m.week,
        homePlayer: m.homePlayer,
        awayPlayer: m.awayPlayer,
        homeScore: m.homeScore ?? undefined,
        awayScore: m.awayScore ?? undefined,
        replayUrl: m.replayUrl ?? undefined,
        phase: m.phase as 'regular' | 'playoffs',
        playoffRound: m.playoffRound,
        homeSeed: m.homeSeed,
        awaySeed: m.awaySeed,
      }));

      setPlayers(convertedPlayers);
      setMatches(convertedMatches);
      setByes(apiSchedule.byes ?? []);
      setTransactions(apiTx);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    detailCache.clear();
    loadAll(true).catch(() => setLoading(false));
  }, [leagueId, loadAll, detailCache]);

  const refresh = useCallback(async () => {
    detailCache.clear();
    await loadAll(false);
  }, [loadAll, detailCache]);

  const standings = [...players].sort((a, b) => {
    if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
    return b.record.differential - a.record.differential;
  });

  const getWeekMatches = (week: number) =>
    matches.filter(m => m.week === week);

  const getTeamMatches = (teamId: string) =>
    matches
      .filter(m => m.homePlayer === teamId || m.awayPlayer === teamId)
      .sort((a, b) => a.week - b.week);

  const getTeamByes = (teamId: string) =>
    byes
      .filter(b => b.teamId === teamId)
      .sort((a, b) => a.week - b.week);

  const getMatchDetail = async (matchId: string) => {
    if (detailCache.has(matchId)) return detailCache.get(matchId)!;
    try {
      const d = await api.getMatchPokemon(matchId);
      const converted = {
        home: d.home.map(p => ({
          name: p.name,
          kills: p.kills,
          deaths: p.deaths,
          teraUsed: p.teraUsed,
          teraType: (p.teraType || undefined) as PokemonType | undefined,
        })),
        away: d.away.map(p => ({
          name: p.name,
          kills: p.kills,
          deaths: p.deaths,
          teraUsed: p.teraUsed,
          teraType: (p.teraType || undefined) as PokemonType | undefined,
        })),
      };
      detailCache.set(matchId, converted);
      return converted;
    } catch {
      return null;
    }
  };

  const getTeamTrades = (teamId: string): Trade[] => {
    return transactions
      .filter(t => t.type === 'fa' || t.type === 'trade')
      .filter(t => t.teamId === teamId || t.otherTeamId === teamId)
      .map((t) => ({
        id: `t${t.id}`,
        week: t.week,
        status: 'accepted' as const,
        proposer: t.teamId,
        recipient: t.otherTeamId || 'pool',
        offering: t.pokemonOut ? [t.pokemonOut] : [],
        requesting: t.pokemonIn ? [t.pokemonIn] : [],
        proposedAt: '',
        resolvedAt: '',
      }));
  };

  return (
    <LeagueDataContext.Provider value={{
      players,
      standings,
      matches,
      byes,
      transactions,
      loading,
      getWeekMatches,
      getTeamMatches,
      getTeamByes,
      getMatchDetail,
      getTeamTrades,
      refresh,
    }}>
      {children}
    </LeagueDataContext.Provider>
  );
}

export function useLeagueData(): LeagueData {
  const ctx = useContext(LeagueDataContext);
  if (!ctx) throw new Error('useLeagueData must be used within a LeagueDataProvider');
  return ctx;
}
