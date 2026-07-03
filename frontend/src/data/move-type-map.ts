import type { PokemonType } from '@/lib/pokemon';
import { TYPE_COLORS } from '@/lib/constants';

/**
 * Best-effort move-name → Pokemon type lookup.
 * Only needs to cover the default move categories — admin-added moves fall back
 * to uncolored text, which is fine.
 *
 * Shared between the site's Matchup Center Moves tab and the Showdown-native
 * matchup plugin so the coloring never drifts.
 */
export const MOVE_TYPE_MAP: Record<string, PokemonType> = {
  // Hazards
  'Stealth Rock': 'rock', 'Spikes': 'ground', 'Toxic Spikes': 'poison',
  'Sticky Web': 'bug', 'Defog': 'flying', 'Rapid Spin': 'normal',
  // Healing
  'Wish': 'normal', 'Healing Wish': 'psychic', 'Revival Blessing': 'normal',
  'Heal Bell': 'normal', 'Aromatherapy': 'grass', 'Moonlight': 'fairy',
  'Morning Sun': 'normal', 'Recover': 'normal', 'Roost': 'flying',
  'Slack Off': 'normal', 'Soft-Boiled': 'normal', 'Strength Sap': 'grass',
  'Synthesis': 'grass',
  // Momentum
  'U-turn': 'bug', 'Volt Switch': 'electric', 'Flip Turn': 'water',
  'Parting Shot': 'dark', 'Teleport': 'psychic', 'Shed Tail': 'normal',
  // Priority
  'Accelerock': 'rock', 'Aqua Jet': 'water', 'Bullet Punch': 'steel',
  'Extreme Speed': 'normal', 'Fake Out': 'normal', 'Feint': 'normal',
  'First Impression': 'bug', 'Ice Shard': 'ice', 'Mach Punch': 'fighting',
  'Quick Attack': 'normal', 'Shadow Sneak': 'ghost', 'Sucker Punch': 'dark',
  'Vacuum Wave': 'fighting', 'Upper Hand': 'fighting', 'Water Shuriken': 'water',
  // Disruption
  'Taunt': 'dark', 'Knock Off': 'dark', 'Encore': 'normal',
  'Trick': 'psychic', 'Switcheroo': 'normal', 'Thief': 'dark',
  'Psychic Noise': 'psychic', 'Covet': 'normal', 'Corrosive Gas': 'poison',
  'Soak': 'water', 'Worry Seed': 'grass', 'Entrainment': 'normal',
  'Skill Swap': 'psychic', 'Simple Beam': 'normal', 'Imprison': 'psychic',
  // Trapping (moves)
  'Bind': 'normal', 'Block': 'normal', 'Clamp': 'water',
  'Fire Spin': 'fire', 'Mean Look': 'normal', 'Sand Tomb': 'ground',
  'Whirlpool': 'water', 'Wrap': 'normal',
  // Phasing
  'Haze': 'ice', 'Circle Throw': 'fighting', 'Dragon Tail': 'dragon',
  'Roar': 'normal', 'Clear Smog': 'poison', 'Whirlwind': 'normal',
  // HP Cutting
  'Pain Split': 'normal', 'Endeavor': 'normal', 'Super Fang': 'normal',
  'Seismic Toss': 'fighting', 'Final Gambit': 'fighting', 'Night Shade': 'ghost',
  'Psywave': 'psychic', 'Dragon Rage': 'dragon', 'Sonic Boom': 'normal',
  // Status
  'Glare': 'normal', 'Nuzzle': 'electric', 'Sleep Powder': 'grass',
  'Spore': 'grass', 'Stun Spore': 'grass', 'Thunder Wave': 'electric',
  'Toxic': 'poison', 'Will-O-Wisp': 'fire', 'Yawn': 'normal',
  // Speed Control
  'Bulldoze': 'ground', 'Electroweb': 'electric', 'Icy Wind': 'ice',
  'Quash': 'dark', 'Tailwind': 'flying', 'Trick Room': 'psychic',
  // Support
  'Reflect': 'psychic', 'Light Screen': 'psychic', 'Aurora Veil': 'ice',
  'Ally Switch': 'psychic', 'Follow Me': 'normal', 'Rage Powder': 'bug',
  'Quick Guard': 'fighting', 'Wide Guard': 'rock', 'Helping Hand': 'normal',
  'Snarl': 'dark', 'Beat Up': 'dark',
  // Weather moves
  'Sunny Day': 'fire', 'Rain Dance': 'water', 'Hail': 'ice',
  'Snowscape': 'ice', 'Sandstorm': 'rock', 'Weather Ball': 'normal',
  // Terrain moves
  'Electric Terrain': 'electric', 'Rising Voltage': 'electric',
  'Psychic Terrain': 'psychic', 'Expanding Force': 'psychic',
  'Misty Terrain': 'fairy', 'Misty Explosion': 'fairy',
  'Grassy Terrain': 'grass', 'Grassy Glide': 'grass',
  'Ice Spinner': 'ice', 'Terrain Pulse': 'normal',
  // Setup
  'Dragon Dance': 'dragon', 'Swords Dance': 'normal', 'Shell Smash': 'normal',
  'Shift Gear': 'steel', 'Belly Drum': 'normal', 'Bulk Up': 'fighting',
  'Coil': 'poison', 'Hone Claws': 'dark', 'Curse': 'ghost', 'Work Up': 'normal',
  'Calm Mind': 'psychic', 'Nasty Plot': 'dark', 'Quiver Dance': 'bug',
  'Cosmic Power': 'psychic', 'Iron Defense': 'steel', 'Cotton Guard': 'grass',
  'Acid Armor': 'poison', 'Amnesia': 'psychic', 'Agility': 'psychic',
  'Rock Polish': 'rock', 'Autotomize': 'steel', 'Body Press': 'fighting',
  'Stored Power': 'psychic', 'Power Trip': 'dark',
};

/**
 * Return the type color for a move or ability name, or undefined if unknown.
 * Pass a palette (e.g. `getTypeColors(colorblindMode)`) to honor colorblind
 * mode; defaults to the standard TYPE_COLORS.
 */
export function getMoveColor(
  name: string,
  colors: Record<PokemonType, string> = TYPE_COLORS,
): string | undefined {
  const type = MOVE_TYPE_MAP[name];
  return type ? colors[type] : undefined;
}
