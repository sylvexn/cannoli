/**
 * Guest storage for Draft Center teams. Every localStorage touch is wrapped:
 * private windows, blocked site data and quota errors must degrade to "no
 * saved teams", never throw into render.
 */
import type { DcTeam, DcTeamInput } from './types';

const KEY = 'cannoli.draftCenter.teams.v1';
const PROMPT_KEY = 'cannoli.draftCenter.importPrompted';

export function readLocalTeams(): DcTeam[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is DcTeam =>
      !!t && typeof t === 'object' && typeof (t as DcTeam).id === 'string' && Array.isArray((t as DcTeam).roster));
  } catch {
    return [];
  }
}

/** Returns false when the write failed (quota / blocked) so the UI can say so. */
export function writeLocalTeams(teams: DcTeam[]): boolean {
  try {
    if (teams.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(teams));
    return true;
  } catch {
    return false;
  }
}

export function newLocalTeam(input: DcTeamInput): DcTeam {
  const now = new Date().toISOString();
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `local-${crypto.randomUUID()}`
    : `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { ...input, id, shareToken: null, createdAt: now, updatedAt: now };
}

export const isLocalId = (id: string): boolean => id.startsWith('local-');

/** Session-scoped "already asked about importing" flag (so declining isn't nagged). */
export function importPrompted(): boolean {
  try { return sessionStorage.getItem(PROMPT_KEY) === '1'; } catch { return false; }
}
export function markImportPrompted(): void {
  try { sessionStorage.setItem(PROMPT_KEY, '1'); } catch { /* ignore */ }
}
