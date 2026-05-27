import { useState, useEffect } from 'react';
import { api } from './api';
import type { ApiLeague, ApiTeam, ApiMatch, ApiMatchPokemon, ApiTransaction } from './api';
import type { League, Player, Match, MatchPokemonEntry, LeagueSeason, RosterPokemon } from './types';
import type { PokemonType } from './pokemon';

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useLeagues() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLeagues().then(apiLeagues => {
      setLeagues(apiLeagues.map(toLeague));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return { leagues, loading };
}

export function useLeagueTeams(leagueId: string) {
  const [teams, setTeams] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getTeams(leagueId).then(apiTeams => {
      setTeams(apiTeams.map(toPlayer));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [leagueId]);

  return { teams, loading };
}

export function useLeagueSchedule(leagueId: string) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getSchedule(leagueId).then(({ matches: apiMatches }) => {
      setMatches(apiMatches.map(toMatch));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [leagueId]);

  return { matches, loading };
}

export function useMatchPokemon(matchId: string | null) {
  const [data, setData] = useState<{ home: MatchPokemonEntry[]; away: MatchPokemonEntry[] } | null>(null);

  useEffect(() => {
    if (!matchId) { setData(null); return; }
    api.getMatchPokemon(matchId).then(d => {
      setData({
        home: d.home.map(toMatchPokemonEntry),
        away: d.away.map(toMatchPokemonEntry),
      });
    });
  }, [matchId]);

  return data;
}

export function useLeagueTransactions(leagueId: string) {
  const [transactions, setTransactions] = useState<ApiTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getTransactions(leagueId).then(tx => {
      setTransactions(tx);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [leagueId]);

  return { transactions, loading };
}

// ─── Converters (API → frontend types) ───────────────────────────────────────

function toLeague(a: ApiLeague): League {
  const season: LeagueSeason = a.season ? {
    id: a.season.id,
    seasonNumber: a.season.seasonNumber,
    phase: a.season.phase,
    currentWeek: a.season.currentWeek,
    totalWeeks: a.season.totalWeeks,
    pointCap: a.season.pointCap ?? 110,
    teraCaptainSlots: a.season.teraCaptainSlots ?? 2,
    tradeDeadlineWeek: a.season.tradeDeadlineWeek ?? 7,
    forfeitPolicy: a.season.forfeitPolicy,
    paused: a.season.paused,
  } : {
    id: 'unknown',
    seasonNumber: 0,
    phase: 'offseason',
    currentWeek: 0,
    totalWeeks: 0,
    pointCap: 110,
    teraCaptainSlots: 2,
    tradeDeadlineWeek: 7,
  };

  return {
    id: a.id,
    name: a.name,
    color: a.color,
    season,
    players: [], // Will be loaded separately via useLeagueTeams
    hasData: true,
    // WIP: ApiLeague does not yet expose playoffTeamCount; default to 0 to satisfy League type
    playoffTeamCount: 0,
  };
}

function toPlayer(a: ApiTeam): Player {
  return {
    id: a.id,
    name: a.name,
    teamName: a.teamName,
    teamAbbrev: a.teamAbbrev,
    teamColor: a.teamColor,
    userId: a.userId,
    record: a.record,
    roster: a.roster.map(toRosterPokemon),
  };
}

function toRosterPokemon(a: ApiTeam['roster'][0]): RosterPokemon {
  return {
    name: a.name,
    types: a.types as PokemonType[],
    tier: a.tier,
    isTeraCaptain: a.isTeraCaptain,
    teraTypes: a.teraTypes as PokemonType[] | undefined,
    stats: a.stats || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    abilities: a.abilities,
    seasonStats: a.seasonStats,
  };
}

function toMatch(a: ApiMatch): Match {
  return {
    id: a.id,
    week: a.week,
    homePlayer: a.homePlayer,
    awayPlayer: a.awayPlayer,
    homeScore: a.homeScore ?? undefined,
    awayScore: a.awayScore ?? undefined,
    replayUrl: a.replayUrl ?? undefined,
  };
}

function toMatchPokemonEntry(a: ApiMatchPokemon): MatchPokemonEntry {
  return {
    name: a.name,
    kills: a.kills,
    deaths: a.deaths,
    teraUsed: a.teraUsed,
    teraType: a.teraType as PokemonType | undefined,
  };
}
