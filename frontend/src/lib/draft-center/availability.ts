import type { ApiTeam } from '@/lib/api';

export interface Owner { teamId: string; teamAbbrev: string; teamName: string; teamColor: string; mine: boolean }
/** Pokemon name -> owning team. Absent = free agent. */
export type OwnerMap = Map<string, Owner>;
export type AvailFilter = 'all' | 'available';

/** Index a league's rosters by Pokemon; `mine` marks teams coached by `userId`. */
export function buildOwnerMap(teams: ApiTeam[], userId?: string | null): OwnerMap {
  const out: OwnerMap = new Map();
  for (const t of teams) {
    const mine = userId != null && t.userId != null && String(t.userId) === String(userId);
    for (const p of t.roster) {
      out.set(p.name, { teamId: t.id, teamAbbrev: t.teamAbbrev, teamName: t.teamName, teamColor: t.teamColor, mine });
    }
  }
  return out;
}

/** Free agents and your own mons count as available. */
export const isAvailable = (owners: OwnerMap, name: string): boolean => {
  const o = owners.get(name);
  return !o || o.mine;
};

/** The league the user coaches in, if any (first match). */
export function defaultLeagueId(teamsByLeague: Record<string, ApiTeam[]>, userId?: string | null): string | null {
  if (userId == null) return null;
  for (const [id, teams] of Object.entries(teamsByLeague)) {
    if (teams.some(t => t.userId != null && String(t.userId) === String(userId))) return id;
  }
  return null;
}
