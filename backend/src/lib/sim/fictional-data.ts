/**
 * Fictional coach + team generators for the season simulator.
 *
 * The mock deployment is being turned into a fully fictional SIMULATOR, so all
 * generated names must read as invented and must NOT collide with real S9/S10
 * coaches. Everything is built from curated word banks + a MockRng — no new npm
 * dependencies, no name-faker library.
 *
 * The word banks are sized so ~40 teams and ~40 coaches can each draw a unique
 * name; {@link UniqueNamer} dedups within a run and appends a numeric suffix
 * only as a last-resort overflow guard.
 */
import type { MockRng } from './mock-rng';

// ── Coach name banks ───────────────────────────────────────────────────────
// First names skew toward handle-like / gamer-tag style so they read clearly
// as fictional alongside the invented surnames.
const COACH_FIRST = [
  'Quill', 'Vesper', 'Cassian', 'Mireille', 'Orin', 'Thessaly', 'Bram',
  'Lysander', 'Wrenna', 'Dorian', 'Sable', 'Calixto', 'Fenwick', 'Isolde',
  'Garrick', 'Perrin', 'Soraya', 'Tobias', 'Elowen', 'Marcus', 'Nadia',
  'Octavia', 'Reuben', 'Sylas', 'Tamsin', 'Ulric', 'Verena', 'Wystan',
  'Xander', 'Yara', 'Zephyr', 'Amara', 'Borin', 'Cleo', 'Davos', 'Esme',
  'Florian', 'Greta', 'Halcyon', 'Ivo',
];
const COACH_LAST = [
  'Voss', 'Marlowe', 'Ashcroft', 'Brennan', 'Calloway', 'Drummond', 'Eastwick',
  'Fairbrook', 'Grimsby', 'Hawkridge', 'Ironwood', 'Jessop', 'Kingsley',
  'Larkspur', 'Mossvale', 'Northgate', 'Oakhart', 'Pemberton', 'Quarryman',
  'Rookwood', 'Stormridge', 'Thornbury', 'Underhill', 'Vexley', 'Whitlock',
  'Yarrow', 'Ambermoor', 'Blackwater', 'Cravensworth', 'Dunmore',
];

// ── Team name banks ────────────────────────────────────────────────────────
const TEAM_ADJECTIVE = [
  'Crimson', 'Obsidian', 'Radiant', 'Verdant', 'Tidal', 'Gilded', 'Frostbound',
  'Emberlit', 'Stormcrest', 'Ashen', 'Azure', 'Thundering', 'Shrouded',
  'Feral', 'Iron', 'Vesper', 'Solar', 'Lunar', 'Wandering', 'Sovereign',
  'Phantom', 'Glacial', 'Molten', 'Twilight', 'Boundless',
];
const TEAM_NOUN = [
  'Talons', 'Wyverns', 'Maelstrom', 'Sentinels', 'Vanguard', 'Drakes',
  'Howlers', 'Monarchs', 'Reckoning', 'Tempest', 'Marauders', 'Specters',
  'Colossi', 'Pioneers', 'Outlaws', 'Leviathans', 'Comets', 'Wardens',
  'Juggernauts', 'Renegades', 'Basilisks', 'Nomads', 'Phoenixes', 'Titans',
  'Coyotes',
];

// ── Team color palette ─────────────────────────────────────────────────────
// Vivid dark-theme-friendly hexes; secondary is a deterministic lighter mate.
const TEAM_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#0ea5e9', '#10b981', '#f59e0b', '#7c3aed',
];

/** Lighten a #RRGGBB hex toward white by `amount` (0..1). */
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return (
    '#' +
    [mix(r), mix(g), mix(b)]
      .map(c => c.toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Tracks names already handed out so a single sim run never duplicates a coach
 * or team name. `take()` retries the generator a bounded number of times, then
 * falls back to a numeric suffix so generation always terminates.
 */
export class UniqueNamer {
  private seen = new Set<string>();

  take(gen: () => string): string {
    for (let i = 0; i < 40; i++) {
      const candidate = gen();
      if (!this.seen.has(candidate.toLowerCase())) {
        this.seen.add(candidate.toLowerCase());
        return candidate;
      }
    }
    // Overflow: suffix the last candidate until unique.
    let suffix = 2;
    let base = gen();
    while (this.seen.has(`${base} ${suffix}`.toLowerCase())) suffix++;
    const final = `${base} ${suffix}`;
    this.seen.add(final.toLowerCase());
    return final;
  }
}

/** A coach display name, e.g. "Vesper Marlowe". */
export function generateCoachName(rng: MockRng): string {
  return `${rng.pick(COACH_FIRST)} ${rng.pick(COACH_LAST)}`;
}

export interface GeneratedTeam {
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  secondaryColor: string;
}

/**
 * A team identity. `leagueGem` (the league id, e.g. 'sapphire') is woven into
 * the color choice so teams in the same league trend toward a coherent — but
 * not identical — palette.
 */
export function generateTeam(rng: MockRng, leagueGem: string): GeneratedTeam {
  const adjective = rng.pick(TEAM_ADJECTIVE);
  const noun = rng.pick(TEAM_NOUN);
  const teamName = `${adjective} ${noun}`;

  // 3-char abbreviation: first 2 of adjective + first of noun, uppercased.
  const teamAbbrev = (adjective.slice(0, 2) + noun.slice(0, 1)).toUpperCase();

  // Gem-tinted color selection: hash the league id to bias the palette window.
  const gemHash = [...leagueGem].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const base = TEAM_COLORS[(gemHash + rng.int(0, TEAM_COLORS.length - 1)) % TEAM_COLORS.length]!;

  return {
    teamName,
    teamAbbrev,
    teamColor: base,
    secondaryColor: lighten(base, 0.35),
  };
}
