// Playoff bracket approval flow client (backend routes/admin/playoffs.ts).
import { fetchJson, mutateJson } from './api';

export type PlayoffStatus = 'none' | 'draft' | 'published';

export interface PlayoffWarning { level: 'warn' | 'info'; text: string }

export interface PlayoffStandingRow {
  teamId: string; rank: number; teamName: string; abbrev: string; color: string;
  coachName: string; hasCoach: boolean; wins: number; losses: number; differential: number;
  tiebreaker: { rule: 'h2h' | 'diff' | 'kills' | 'id'; value: number | string } | null;
}

export interface PlayoffDraftView {
  leagueId: string; leagueName: string; phase: string; status: PlayoffStatus;
  topN: number; bracketSizes: number[];
  /** Full team order; the first `topN` make the bracket. */
  seedOrder: string[];
  standings: PlayoffStandingRow[];
  warnings: PlayoffWarning[];
  matchCount: number; locked: boolean; legacyBracket: boolean;
  publishedAt: string | null; updatedAt: string | null;
}

export interface PlayoffOverviewRow {
  leagueId: string; leagueName: string; phase: string; status: PlayoffStatus; topN: number;
  matchCount: number; locked: boolean; legacyBracket: boolean; updatedAt: string | null;
}

export const playoffsApi = {
  overview: () => fetchJson<{ leagues: PlayoffOverviewRow[] }>('/api/admin/playoffs/overview'),
  pending: () => fetchJson<{ drafts: { leagueId: string; leagueName: string; updatedAt: string | null; topN: number }[] }>(
    '/api/admin/playoffs/drafts/pending'),
  getDraft: (leagueId: string) => fetchJson<PlayoffDraftView>(`/api/admin/leagues/${leagueId}/playoffs/draft`),
  saveDraft: (leagueId: string, body: { topN: number; seedOrder: string[] }) =>
    mutateJson<PlayoffDraftView>('PUT', `/api/admin/leagues/${leagueId}/playoffs/draft`, body),
  discardDraft: (leagueId: string) =>
    mutateJson<{ success: boolean }>('DELETE', `/api/admin/leagues/${leagueId}/playoffs/draft`),
  publish: (leagueId: string) =>
    mutateJson<{ success: boolean; matchCount: number; notified: number }>('POST', `/api/admin/leagues/${leagueId}/playoffs/publish`, {}),
  unpublish: (leagueId: string) =>
    mutateJson<{ success: boolean; removedNotifications: number }>('POST', `/api/admin/leagues/${leagueId}/playoffs/unpublish`, {}),
};

/** Round-1 seed pairings for a bracket size (mirrors backend buildPlayoffMatchups). */
export function roundOnePairs(topN: number): [number, number][] {
  return topN === 8 ? [[1, 8], [4, 5], [2, 7], [3, 6]]
    : topN === 6 ? [[3, 6], [4, 5]] : topN === 4 ? [[1, 4], [2, 3]] : [[1, 2]];
}
