import type { ApiPinSuggestion, ApiSeasonPin, ApiTeam } from '@/lib/api';

/** One award the admin wants to exist: a team (and a match, for per-match pins). */
export interface SheetRow {
  teamId: string;
  matchId?: string;
  pokemon?: string;
  nickname?: string;
  note?: string;
  /** Derived stats echoed back to the server (kills, scoreLine, ...). */
  stats?: Record<string, unknown>;
}

export interface SheetTeam {
  id: string;
  leagueId: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  owner: ApiTeam['owner'] | null;
  roster: string[];
}

export interface SheetLeague {
  id: string;
  name: string;
  color: string;
  teams: SheetTeam[];
}

export const rowKey = (teamId: string, matchId?: string | null) => `${teamId}|${matchId ?? ''}`;

/** Server-computed stat keys worth round-tripping from a saved pin. */
const STAT_KEYS = [
  'kills', 'wins', 'losses', 'diff', 'streak', 'seriesScore', 'runnerUpTeamId', 'scoreLine',
  'sweeps', 'week', 'phase', 'cost', 'ratio', 'winnerRank', 'loserRank', 'loserTeamId',
];

function pickStats(meta: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of STAT_KEYS) if (meta[k] != null) out[k] = meta[k];
  return Object.keys(out).length ? out : undefined;
}

export function rowFromPin(p: ApiSeasonPin): SheetRow {
  const m = p.metadata ?? {};
  return {
    teamId: p.teamId ?? '',
    matchId: p.matchId ?? undefined,
    pokemon: typeof m.pokemon === 'string' ? m.pokemon : undefined,
    nickname: typeof m.nickname === 'string' ? m.nickname : undefined,
    note: typeof m.note === 'string' ? m.note : undefined,
    stats: pickStats(m),
  };
}

export function rowFromSuggestion(s: ApiPinSuggestion): SheetRow {
  return {
    teamId: s.teamId, matchId: s.matchId, pokemon: s.pokemon,
    stats: pickStats(s.metadata),
  };
}

export const sameRow = (a: SheetRow, b: SheetRow) =>
  (a.pokemon ?? '') === (b.pokemon ?? '') && (a.nickname ?? '') === (b.nickname ?? '')
  && (a.note ?? '') === (b.note ?? '');
