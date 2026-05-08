/**
 * Shared types for the league archive deep-dive. The /api/archive/leagues/
 * :id/full endpoint hands these back; each tab consumes a slice.
 */

export interface FullLeagueData {
  league: {
    id: string;
    name: string;
    color: string;
    seasonId: number;
    seasonNumber: number | null;
    archived: boolean;
    phase: string;
    rosterSize: number;
    playoffTeamCount: number;
  };
  teams: TeamRow[];
  schedule: ScheduleMatch[];
  draft: DraftPick[];
  transactions: TransactionRow[];
  leaderboards: {
    aggregates: LeaderboardAggregate[];
    peaks: PeakRow[];
  };
}

export interface TeamRow {
  id: string;
  coachName: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  userId: number | null;
  rank: number;
  /** Final placement (1 = Champion, 2 = Runner-up, 3 = Semifinalist, 5 =
   *  Quarterfinalist, 9+ = Regular Season). NULL until the league wraps. */
  finishPosition: number | null;
  /** Pre-formatted label paired with finishPosition (e.g. "Champion",
   *  "Runner-up", "Semifinalist", "Quarterfinalist", "Regular Season"). */
  finishLabel: string | null;
  roster: RosterMon[];
  record: {
    wins: number;
    losses: number;
    differential: number;
    kills: number;
    deaths: number;
  };
  tiebreaker: { rule: string; value: number | string } | null;
}

export interface RosterMon {
  name: string;
  nickname: string | null;
  tier: number;
  types: string[];
  isTeraCaptain: boolean;
  teraTypes: string[];
  isShiny: boolean;
  acquiredVia: string;
  acquiredWeek: number | null;
}

export interface ScheduleMatch {
  id: string;
  week: number;
  phase: 'regular' | 'playoffs';
  playoffRound: 'qf' | 'sf' | 'f' | null;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  homeSeed: number | null;
  awaySeed: number | null;
  status: string;
  replayUrl: string | null;
  forfeitedBy: 'home' | 'away' | 'both' | null;
}

export interface DraftPick {
  pickNumber: number;
  teamId: string;
  pokemonName: string;
  tier: number;
}

export interface TransactionRow {
  id: number;
  leagueId: string;
  week: number;
  type: 'fa' | 'trade' | 'tera_change';
  teamId: string;
  otherTeamId: string | null;
  pokemonOut: string | null;
  pointsOut: number | null;
  pokemonIn: string | null;
  pointsIn: number | null;
  teraPokemon: string | null;
}

export interface LeaderboardAggregate {
  pokemonName: string;
  teamId: string;
  kills: number;
  deaths: number;
  gp: number;
  teraUsed: number;
  kdRatio: number;
}

export interface PeakRow {
  pokemonName: string;
  teamId: string;
  matchId: string;
  week: number;
  phase: string;
  kills: number;
}

export interface SeasonAward {
  pinId: number;
  pinDefId: string;
  userId: number;
  username: string;
  displayName: string | null;
  defName: string;
  defDescription: string;
  defIconName: string;
  defColor: string;
  defCategory: string;
  defIsAuto: boolean;
  metadata: any;
  awardedAt: string | null;
  awardedBy: number | null;
}
