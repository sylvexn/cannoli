/**
 * Pure helpers for scripts/rederive-match-pokemon.ts (kept DB-free so they're unit-testable).
 */
import { resolveRosterPokemonName } from './pokedex';

export interface DiffRow {
  teamId: string;
  pokemonName: string;
  kills: number;
  deaths: number;
  teraUsed: boolean;
  teraType: string | null;
}

/**
 * Name to store for a re-parsed mon. The names ALREADY stored for this match+team
 * win over the team's current roster: the roster is "now", the stored rows are
 * "then" (a dropped/traded/replaced mon, a Mega that was swapped for its base
 * form) and must not be rewritten to whatever the team holds today.
 */
export function resolveStoredName(storedNames: string[], rosterNames: string[], species: string): string {
  const stored = resolveRosterPokemonName(storedNames, species);
  if (storedNames.includes(stored)) return stored;
  return resolveRosterPokemonName(rosterNames, species);
}

/**
 * True when a human overrode this match's result, so the replay_log must not
 * overwrite it: a force-result that rewrote K/D, any overwrite of a recorded
 * result, or a forfeit (forfeit K/D is synthetic by design).
 */
export function isHandCorrected(
  match: { id: string; forfeitedBy: string | null },
  logs: { type: string; metadata: string | null }[],
): boolean {
  if (match.forfeitedBy) return true;
  for (const l of logs) {
    let meta: any;
    try { meta = l.metadata ? JSON.parse(l.metadata) : null; } catch { continue; }
    if (meta?.matchId !== match.id) continue;
    if (l.type === 'match_result_overwritten') return true;
    if (l.type === 'match_force_result' && (meta.pokemonRewritten || meta.teamsReassigned)) return true;
  }
  return false;
}

export function diffRows(oldRows: DiffRow[], newRows: DiffRow[]): { lines: string[]; killDelta: number; changed: boolean } {
  const key = (r: DiffRow) => `${r.teamId}|${r.pokemonName}`;
  const oldBy = new Map(oldRows.map(r => [key(r), r]));
  const newBy = new Map(newRows.map(r => [key(r), r]));
  const lines: string[] = [];
  for (const [k, n] of newBy) {
    const o = oldBy.get(k);
    if (!o) lines.push(`   + ${n.pokemonName.padEnd(16)} K=${n.kills} D=${n.deaths}  (new)`);
    else if (o.kills !== n.kills || o.deaths !== n.deaths || o.teraUsed !== n.teraUsed || (o.teraType ?? null) !== (n.teraType ?? null)) {
      lines.push(`   ~ ${n.pokemonName.padEnd(16)} K=${o.kills}→${n.kills} D=${o.deaths}→${n.deaths}`);
    }
  }
  for (const [k, o] of oldBy) {
    if (!newBy.has(k)) lines.push(`   - ${o.pokemonName.padEnd(16)} K=${o.kills} D=${o.deaths}  (removed)`);
  }
  const sum = (rs: DiffRow[]) => rs.reduce((n, r) => n + r.kills, 0);
  return { lines, killDelta: sum(newRows) - sum(oldRows), changed: lines.length > 0 };
}
