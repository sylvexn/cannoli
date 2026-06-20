/**
 * Per-league rules content: the structured document rendered on the public
 * /rules page and edited in the admin Rules tab.
 *
 * Storage: one JSON blob per league in the `league_rules` table. When a league
 * has no saved row, the API falls back to DEFAULT_RULES keyed by the league's
 * `costFormat` ('natdex' = Emerald, 'natdexplus' = Ruby/Sapphire). The defaults
 * below are the canonical Season 11 rule sets, transcribed from the league
 * workbooks — so the page shows correct content before any admin edit.
 *
 * NOTE: the matching frontend type lives in
 * `frontend/src/lib/rules-types.ts` — keep the two shapes in sync.
 */

export interface Clause {
  name: string;
  description: string;
}

export interface PokemonBan {
  /** The Pokémon the ban applies to, e.g. "Mega Alakazam". */
  pokemon: string;
  /** The move/element banned on it, e.g. "Nasty Plot". */
  move: string;
}

export interface RulesContent {
  /** Freeform "Additional Notes" prose shown at the top (newlines preserved). */
  notes: string;
  draftRules: string[];
  battleRules: string[];
  clauses: Clause[];
  pokemonBans: PokemonBan[];
  bannedAbilities: string[];
  bannedItems: string[];
  bannedMoves: string[];
  /** Pokémon that may be drafted but not run as a Tera Captain. */
  teraCaptainBans: string[];
}

export type RulesCostFormat = 'natdex' | 'natdexplus';

// ─── Shared baseline (identical across S11 formats) ─────────────────────────

const SHARED_DRAFT_RULES: string[] = [
  'You have up to 110 points with which to draft 10–12 Pokémon. Costs are listed on the draft board. You do not have to spend your full budget.',
  'Pokémon cost anywhere between 1 – 20 points. Tera Captains cost extra as indicated by the tier they are in.',
  'The draft is a randomized snake-style draft (1→12, 12→1, etc.).',
  'Coaches have 1 hour before their respective draft to trade draft position with another coach.',
  'If a Pokémon is picked by someone else, you cannot pick it.',
  'Tera Captains are limited to Tiers 9 and below, and have a multiplier applied to their cost when drafted as a Tera Captain (see Draft Board).',
  "You may have up to 2 Tera Captains from any tiers 9 and below. Tera Captains have 3 Tera Types, visible on each team's sheet. All three types are free, and Stellar Tera is banned.",
  'The deadline for Trades and Free Agencies is Week 7.',
  'You can change tera types on each captain for free once per season.',
  'You can change tera captains within your team by using a FA, or for free the first time when making another trade.',
  "You cannot draft more than 1 Mega Pokémon, and Mega Pokémon need to have their Mega Stone in battle. They don't need to Mega Evolve.",
  'You cannot draft two Pokémon with the same National Dex number. This means you cannot draft two forms of the same Pokémon. Ex. Decidueye and Decidueye-Hisui, Rotom-Wash and Rotom-Heat, or Mega Gardevoir and Gardevoir.',
];

const SHARED_BATTLE_RULES: string[] = [
  'All games must be played in the NatDex Draft format with Tera Preview enabled on Pokémon Showdown.',
  'Each set is a best-of-one set. Same for playoffs.',
  'Either coach can turn the timer on without asking the other coach.',
  'All Pokémon must be Level 100 and you must bring a team of 6 Pokémon to battle.',
  "Battles are done with Tera Preview, meaning the Tera Types of both teams are posted in the battle's chat box when choosing your lead Pokémon.",
];

const SHARED_CLAUSES: Clause[] = [
  { name: 'Species Clause', description: 'A player cannot have two Pokémon with the same National Pokédex number on a team.' },
  { name: 'Sleep Clause', description: "If a player has already put a Pokémon on their opponent's side to sleep and it is still sleeping, another one can't be put to sleep." },
  { name: 'Evasion Clause', description: 'A Pokémon may not hold an item, use a move, or possess an ability that can increase their evasion stat.' },
  { name: 'OHKO Clause', description: 'A Pokémon may not have the moves Fissure, Guillotine, Horn Drill, or Sheer Cold in its moveset.' },
  { name: 'Moody Clause', description: 'A Pokémon may not enter battle with the ability Moody.' },
  { name: 'Endless Battle Clause', description: 'Players cannot intentionally prevent an opponent from being able to end the game without forfeiting.' },
  { name: 'Baton Pass Clause', description: 'A Pokémon may not have Baton Pass in its moveset.' },
  { name: 'Accuracy Moves Clause', description: "A Pokémon may not have a move that lowers the opponent's accuracy." },
];

const SHARED_BANNED_ABILITIES = ['Shadow Tag', 'Arena Trap', 'Moody'];
const SHARED_BANNED_ITEMS = ['Bright Powder', 'Lax Incense', 'Razor Fang', "King's Rock"];

const SHARED_BANNED_MOVES = [
  'Acupressure', 'Baton Pass', 'Flatter', 'Frustration', 'Hidden Power',
  'Last Respects', 'Pursuit', 'Return', 'Revival Blessing', 'Shed Tail', 'Swagger',
];

// ─── Format-specific defaults (Season 11 workbooks) ─────────────────────────

/** Emerald — restricted pool (legendaries/paradoxes/mythicals banned). */
const NATDEX_DEFAULT: RulesContent = {
  notes: '',
  draftRules: [...SHARED_DRAFT_RULES],
  battleRules: [...SHARED_BATTLE_RULES],
  clauses: SHARED_CLAUSES.map(c => ({ ...c })),
  pokemonBans: [
    { pokemon: 'Palafin', move: 'Jet Punch' },
    { pokemon: 'Mega Alakazam', move: 'Nasty Plot' },
  ],
  bannedAbilities: [...SHARED_BANNED_ABILITIES],
  bannedItems: [...SHARED_BANNED_ITEMS],
  bannedMoves: [...SHARED_BANNED_MOVES],
  teraCaptainBans: [
    'Alcremie', 'Cetitan', 'Linoone', 'Mudsdale',
    'Polteageist', 'Reuniclus', 'Sinistcha', 'Toxtricity',
  ],
};

/** Ruby / Sapphire — fuller pool. */
const NATDEXPLUS_DEFAULT: RulesContent = {
  notes: '',
  draftRules: [...SHARED_DRAFT_RULES],
  battleRules: [...SHARED_BATTLE_RULES],
  clauses: SHARED_CLAUSES.map(c => ({ ...c })),
  pokemonBans: [
    { pokemon: 'Mega Alakazam', move: 'Nasty Plot' },
  ],
  bannedAbilities: [...SHARED_BANNED_ABILITIES],
  bannedItems: [...SHARED_BANNED_ITEMS],
  bannedMoves: [...SHARED_BANNED_MOVES, 'Take Heart'],
  teraCaptainBans: [
    'Alcremie', 'Cetitan', 'Diancie', 'Glastrier', 'Hoopa',
    'Iron Thorns', 'Linoone', 'Mudsdale', 'Polteageist', 'Regieleki',
    'Registeel', 'Reuniclus', 'Sinistcha', 'Toxtricity', 'Wo-Chien',
  ],
};

export const DEFAULT_RULES: Record<RulesCostFormat, RulesContent> = {
  natdex: NATDEX_DEFAULT,
  natdexplus: NATDEXPLUS_DEFAULT,
};

/** Deep clone of the default rules for a given cost format (safe to mutate). */
export function defaultRulesFor(costFormat: string | null | undefined): RulesContent {
  const key: RulesCostFormat = costFormat === 'natdex' ? 'natdex' : 'natdexplus';
  return structuredClone(DEFAULT_RULES[key]);
}

// ─── Validation / normalization ─────────────────────────────────────────────

const MAX_NOTES = 8_000;
const MAX_ITEM = 600;   // a single rule / clause description line
const MAX_NAME = 80;    // a Pokémon / ability / item / move / clause name
const MAX_LIST = 100;   // rules / clauses / pokemon-bans per section
const MAX_TAGS = 300;   // ban tag lists (abilities/items/moves/tera)

function str(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.slice(0, cap).trim() : '';
}

function strList(v: unknown, cap: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map(x => str(x, cap))
    .filter(Boolean)
    .slice(0, maxLen);
}

/**
 * Coerce arbitrary input (e.g. a PUT body) into a safe RulesContent. Never
 * throws — invalid/missing fields collapse to empty rather than rejecting the
 * whole document, and every string is length-capped.
 */
export function normalizeRules(input: unknown): RulesContent {
  const o = (input && typeof input === 'object') ? (input as Record<string, unknown>) : {};

  const clauses: Clause[] = Array.isArray(o.clauses)
    ? o.clauses
        .map(c => {
          const co = (c && typeof c === 'object') ? (c as Record<string, unknown>) : {};
          return { name: str(co.name, MAX_NAME), description: str(co.description, MAX_ITEM) };
        })
        .filter(c => c.name || c.description)
        .slice(0, MAX_LIST)
    : [];

  const pokemonBans: PokemonBan[] = Array.isArray(o.pokemonBans)
    ? o.pokemonBans
        .map(b => {
          const bo = (b && typeof b === 'object') ? (b as Record<string, unknown>) : {};
          return { pokemon: str(bo.pokemon, MAX_NAME), move: str(bo.move, MAX_NAME) };
        })
        .filter(b => b.pokemon || b.move)
        .slice(0, MAX_LIST)
    : [];

  return {
    notes: str(o.notes, MAX_NOTES),
    draftRules: strList(o.draftRules, MAX_ITEM, MAX_LIST),
    battleRules: strList(o.battleRules, MAX_ITEM, MAX_LIST),
    clauses,
    pokemonBans,
    bannedAbilities: strList(o.bannedAbilities, MAX_NAME, MAX_TAGS),
    bannedItems: strList(o.bannedItems, MAX_NAME, MAX_TAGS),
    bannedMoves: strList(o.bannedMoves, MAX_NAME, MAX_TAGS),
    teraCaptainBans: strList(o.teraCaptainBans, MAX_NAME, MAX_TAGS),
  };
}
