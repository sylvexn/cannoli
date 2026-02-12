import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';
import type { Player, Match, MatchPokemonEntry, Trade } from './types';
import type { ApiTransaction } from './api';
import type { PokemonType } from './pokemon';

interface LeagueData {
  players: Player[];
  standings: Player[];
  matches: Match[];
  transactions: ApiTransaction[];
  loading: boolean;
  /** Get matches for a specific week (with pokemonKD lazy-loaded) */
  getWeekMatches: (week: number) => Match[];
  /** Get matches for a specific team */
  getTeamMatches: (teamId: string) => Match[];
  /** Get pokemon KD for a match (fetches on demand) */
  getMatchDetail: (matchId: string) => Promise<{ home: MatchPokemonEntry[]; away: MatchPokemonEntry[] } | null>;
  /** Get trades involving a specific team */
  getTeamTrades: (teamId: string) => Trade[];
}

const LeagueDataContext = createContext<LeagueData | null>(null);

export function LeagueDataProvider({ leagueId, children }: { leagueId: string; children: React.ReactNode }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [transactions, setTransactions] = useState<ApiTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Match detail cache
  const [detailCache] = useState(() => new Map<string, { home: MatchPokemonEntry[]; away: MatchPokemonEntry[] }>());

  useEffect(() => {
    setLoading(true);
    detailCache.clear();

    Promise.all([
      api.getTeams(leagueId),
      api.getSchedule(leagueId),
      api.getTransactions(leagueId),
    ]).then(([apiTeams, apiMatches, apiTx]) => {
      const convertedPlayers = apiTeams.map(t => ({
        id: t.id,
        name: t.name,
        teamName: t.teamName,
        teamAbbrev: t.teamAbbrev,
        teamColor: t.teamColor,
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
      }));

      setPlayers(convertedPlayers);
      setMatches(convertedMatches);
      setTransactions(apiTx);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [leagueId]);

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
      transactions,
      loading,
      getWeekMatches,
      getTeamMatches,
      getMatchDetail,
      getTeamTrades,
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
