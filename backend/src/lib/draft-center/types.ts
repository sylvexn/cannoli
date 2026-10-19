/**
 * Draft Center roster shape + input sanitising.
 *
 * Rosters are stored as a JSON blob on `draft_center_teams.roster`. The same
 * shape is used client-side (frontend/src/lib/draft-center/types.ts mirrors it)
 * and for guests' localStorage teams, so an "import local teams" is a straight
 * POST of what the browser already holds.
 */

export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
export type StatKey = typeof STAT_KEYS[number];
export type StatSpread = Record<StatKey, number>;

export const POKEMON_TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice',
  'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
  'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const;

export interface DcSet {
  /** Display names, max 4. */
  moves: string[];
  item: string;
  ability: string;
  nature: string;
  evs: StatSpread;
  ivs: StatSpread;
}

export interface DcMon {
  name: string;
  captain: boolean;
  /** Up to 3 tera types (only meaningful when `captain`). */
  teraTypes: string[];
  set?: DcSet;
}

export const MAX_ROSTER = 24;
export const MAX_NAME = 60;
export const MAX_TERA_TYPES = 3;
export const MAX_TEAMS_PER_USER = 100;

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

const int = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? Math.round(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

function spread(raw: unknown, hi: number, fallback: number): StatSpread {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = {} as StatSpread;
  for (const k of STAT_KEYS) out[k] = int(o[k], 0, hi, fallback);
  return out;
}

/** Coerce untrusted JSON into a bounded, well-typed roster. Never throws. */
export function sanitizeRoster(raw: unknown): DcMon[] {
  if (!Array.isArray(raw)) return [];
  const out: DcMon[] = [];
  for (const m of raw.slice(0, MAX_ROSTER)) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const name = str(r.name, MAX_NAME);
    if (!name) continue;
    const teraTypes = Array.isArray(r.teraTypes)
      ? [...new Set(r.teraTypes.filter((t): t is string => typeof t === 'string'))]
          .filter(t => (POKEMON_TYPES as readonly string[]).includes(t))
          .slice(0, MAX_TERA_TYPES)
      : [];
    const mon: DcMon = { name, captain: r.captain === true, teraTypes };
    if (r.set && typeof r.set === 'object') {
      const s = r.set as Record<string, unknown>;
      mon.set = {
        moves: Array.isArray(s.moves)
          ? s.moves.map(x => str(x, 40)).filter(Boolean).slice(0, 4)
          : [],
        item: str(s.item, 40),
        ability: str(s.ability, 40),
        nature: str(s.nature, 20),
        evs: spread(s.evs, 252, 0),
        ivs: spread(s.ivs, 31, 31),
      };
    }
    out.push(mon);
  }
  return out;
}

export function sanitizeName(raw: unknown, fallback = 'Untitled team'): string {
  return str(raw, MAX_NAME) || fallback;
}
