/**
 * Move/ability categories for matchup analysis.
 * Admin-configurable (full CRUD) — these are the shipped defaults.
 *
 * Entries can be moves (checked against learnsets) OR abilities (checked against roster).
 * The `isAbility` flag on individual entries controls which lookup to use.
 */

export interface MoveCategoryEntry {
  name: string;
  /** Showdown move ID (lowercase, no spaces) for learnset lookup */
  moveId: string;
  /** If true, check against Pokemon abilities instead of learnset */
  isAbility?: boolean;
}

export interface MoveCategory {
  id: string;
  name: string;
  entries: MoveCategoryEntry[];
}

/** Convert display name to Showdown move ID */
function mid(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function move(name: string): MoveCategoryEntry {
  return { name, moveId: mid(name) };
}

function ability(name: string): MoveCategoryEntry {
  return { name, moveId: mid(name), isAbility: true };
}

export const DEFAULT_MOVE_CATEGORIES: MoveCategory[] = [
  {
    id: 'hazards',
    name: 'Hazards',
    entries: [
      move('Stealth Rock'), move('Spikes'), move('Toxic Spikes'),
      move('Sticky Web'), move('Defog'), move('Rapid Spin'),
    ],
  },
  {
    id: 'healing',
    name: 'Healing / Cleric',
    entries: [
      move('Wish'), move('Healing Wish'), move('Revival Blessing'),
      move('Heal Bell'), move('Aromatherapy'), move('Moonlight'),
      move('Morning Sun'), move('Recover'), move('Roost'),
      move('Slack Off'), move('Soft-Boiled'), move('Strength Sap'),
      move('Synthesis'),
    ],
  },
  {
    id: 'momentum',
    name: 'Momentum',
    entries: [
      move('U-turn'), move('Volt Switch'), move('Flip Turn'),
      move('Parting Shot'), move('Teleport'), move('Shed Tail'),
    ],
  },
  {
    id: 'priority',
    name: 'Priority',
    entries: [
      move('Accelerock'), move('Aqua Jet'), move('Bullet Punch'),
      move('Extreme Speed'), move('Fake Out'), move('Feint'),
      move('First Impression'), move('Ice Shard'), move('Mach Punch'),
      move('Quick Attack'), move('Shadow Sneak'), move('Sucker Punch'),
      move('Vacuum Wave'), move('Upper Hand'), move('Water Shuriken'),
    ],
  },
  {
    id: 'disruption',
    name: 'Disruption',
    entries: [
      move('Taunt'), move('Knock Off'), move('Encore'),
      move('Trick'), move('Switcheroo'), move('Thief'),
      move('Psychic Noise'), move('Covet'), move('Corrosive Gas'),
      move('Soak'), move('Worry Seed'), move('Entrainment'),
      move('Skill Swap'), move('Simple Beam'), move('Imprison'),
    ],
  },
  {
    id: 'trapping',
    name: 'Trapping',
    entries: [
      ability('Arena Trap'), ability('Magnet Pull'), ability('Shadow Tag'),
      move('Bind'), move('Block'), move('Clamp'),
      move('Fire Spin'), move('Mean Look'), move('Sand Tomb'),
      move('Whirlpool'), move('Wrap'),
    ],
  },
  {
    id: 'phasing',
    name: 'Phasing',
    entries: [
      move('Haze'), move('Circle Throw'), move('Dragon Tail'),
      move('Roar'), move('Clear Smog'), move('Whirlwind'),
    ],
  },
  {
    id: 'hpcutting',
    name: 'HP Cutting',
    entries: [
      move('Pain Split'), move('Endeavor'), move('Super Fang'),
      move('Seismic Toss'), move('Final Gambit'), move('Night Shade'),
      move('Psywave'), move('Dragon Rage'), move('Sonic Boom'),
    ],
  },
  {
    id: 'status',
    name: 'Status',
    entries: [
      move('Glare'), move('Nuzzle'), move('Sleep Powder'),
      move('Spore'), move('Stun Spore'), move('Thunder Wave'),
      move('Toxic'), move('Will-O-Wisp'), move('Yawn'),
    ],
  },
  {
    id: 'speedcontrol',
    name: 'Speed Control',
    entries: [
      move('Bulldoze'), move('Electroweb'), move('Icy Wind'),
      move('Quash'), move('Tailwind'), move('Trick Room'),
    ],
  },
  {
    id: 'support',
    name: 'Support',
    entries: [
      move('Reflect'), move('Light Screen'), move('Aurora Veil'),
      move('Ally Switch'), move('Follow Me'), move('Rage Powder'),
      move('Quick Guard'), move('Wide Guard'), move('Helping Hand'),
      move('Snarl'), move('Beat Up'),
    ],
  },
  {
    id: 'weather',
    name: 'Weather',
    entries: [
      ability('Drought'), move('Sunny Day'), ability('Chlorophyll'),
      ability('Drizzle'), move('Rain Dance'), ability('Swift Swim'),
      ability('Snow Warning'), move('Hail'), move('Snowscape'),
      ability('Slush Rush'), ability('Sand Stream'), move('Sandstorm'),
      ability('Sand Rush'), move('Weather Ball'),
    ],
  },
  {
    id: 'terrain',
    name: 'Terrain',
    entries: [
      ability('Electric Surge'), move('Electric Terrain'), move('Rising Voltage'),
      ability('Psychic Surge'), move('Psychic Terrain'), move('Expanding Force'),
      ability('Misty Surge'), move('Misty Terrain'), move('Misty Explosion'),
      ability('Grassy Surge'), move('Grassy Terrain'), move('Grassy Glide'),
      move('Ice Spinner'), move('Terrain Pulse'),
    ],
  },
  {
    id: 'setup',
    name: 'Setup',
    entries: [
      move('Dragon Dance'), move('Swords Dance'), move('Shell Smash'),
      move('Shift Gear'), move('Belly Drum'), move('Bulk Up'),
      move('Coil'), move('Hone Claws'), move('Curse'), move('Work Up'),
      move('Calm Mind'), move('Nasty Plot'), move('Quiver Dance'),
      move('Cosmic Power'), move('Iron Defense'), move('Cotton Guard'),
      move('Acid Armor'), move('Amnesia'), move('Agility'),
      move('Rock Polish'), move('Autotomize'), move('Body Press'),
      move('Stored Power'), move('Power Trip'),
    ],
  },
];
