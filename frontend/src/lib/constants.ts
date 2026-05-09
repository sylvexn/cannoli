import type { PokemonType } from './pokemon';

/** Canonical Pokemon type hex colors — use this everywhere instead of local copies */
export const TYPE_COLORS: Record<PokemonType, string> = {
  normal: '#a8a77a', fire: '#ee8130', water: '#6390f0', electric: '#f7d02c',
  grass: '#7ac74c', ice: '#96d9d6', fighting: '#c22e28', poison: '#a33ea1',
  ground: '#e2bf65', flying: '#a98ff3', psychic: '#f95587', bug: '#a6b91a',
  rock: '#b6a136', ghost: '#735797', dragon: '#6f35fc', dark: '#705746',
  steel: '#b7b7ce', fairy: '#d685ad',
};

/** Three-letter Pokemon type labels for chips/badges */
export const TYPE_LABELS: Record<PokemonType, string> = {
  normal: 'NOR', fire: 'FIR', water: 'WAT', electric: 'ELE', grass: 'GRA',
  ice: 'ICE', fighting: 'FIG', poison: 'POI', ground: 'GRO', flying: 'FLY',
  psychic: 'PSY', bug: 'BUG', rock: 'ROC', ghost: 'GHO', dragon: 'DRA',
  dark: 'DRK', steel: 'STL', fairy: 'FAI',
};

/** Alias kept for code that imported the team-profile copy as TYPE_ABBR */
export const TYPE_ABBR = TYPE_LABELS;

/**
 * Matchup-center side accents — semantic names for the blue/red split between
 * "your team" (a) and "opponent" (b), and the stat-quality green/yellow/red ladder.
 *
 * Note: these hex values are duplicated in Tailwind arbitrary class strings
 * (e.g. `bg-[#3b82f6]/10`) because Tailwind JIT requires literal class strings.
 * Prefer this constant in JS values (inline `style`, conditional logic).
 */
export const MATCHUP_COLORS = {
  sideA: '#3b82f6',
  sideB: '#ef4444',
  statHigh: '#4ade80',     // ≥130
  statGood: '#86efac',     // ≥100
  statWeak: '#fbbf24',     // ≥60
  statLow: '#f87171',      // <60
} as const;

/** Deuteranopia-safe variant — sideB red→orange, stat ladder green→blue.
 *  Yellow midband stays (deuteranopia-safe). Used by callsites that pass
 *  these as inline `style` colors, where CSS-var overrides don't reach. */
export const MATCHUP_COLORS_CB = {
  sideA: '#3b82f6',
  sideB: '#f97316',
  statHigh: '#60a5fa',
  statGood: '#93c5fd',
  statWeak: '#fbbf24',
  statLow: '#fdba74',
} as const;

/** Returns the deuteranopia-safe palette when `cb` is true. Cheap enough to
 *  call inline; callers are typically a handful of leaf components. */
export function getMatchupColors(cb: boolean) {
  return cb ? MATCHUP_COLORS_CB : MATCHUP_COLORS;
}

/**
 * Type-effectiveness multiplier colors — used by the defensive matchup tooltip.
 * Mirrors the win/loss/draw and neon palette so the ladder reads at a glance:
 *   4× hot, 2× warm, ½× safe, ¼× neon-cool, immune lavender.
 */
export const EFFECTIVENESS_COLORS = {
  x4: '#f87171',   // matches --color-loss
  x2: '#fb923c',
  x05: '#4ade80',  // matches --color-win
  x025: '#22d3ee', // matches --color-neon
  x0: '#a78bfa',
} as const;

/** Medal placement colors (1st/2nd/3rd) for archive + leaderboards */
export const MEDAL_COLORS = {
  gold: '#fcd34d',  // matches text-draw token; kept here for completeness
  silver: '#cbd5e1',
  bronze: '#cd7f32',
} as const;

/**
 * Per-tier accent colors — used by the tier list page header bands and
 * any "tier banner" surface. Colors descend from blistering neon at the
 * top tiers (apex / Mega-tier headlines) through cool/warm midrange to
 * muted earth tones at the very low tiers, so the eye reads tier
 * importance at a glance even when scrolling a long list.
 */
export const TIER_COLORS: Record<number, string> = {
  20: '#f472b6', // Pink — apex
  19: '#e879f9', // Magenta
  18: '#22d3ee', // Cyan — premium
  17: '#06b6d4', // Cyan-deep
  16: '#a78bfa', // Violet
  15: '#8b5cf6', // Violet-deep
  14: '#60a5fa', // Blue
  13: '#3b82f6', // Blue-deep
  12: '#34d399', // Emerald
  11: '#10b981', // Emerald-deep
  10: '#facc15', // Amber
  9:  '#eab308', // Amber-deep
  8:  '#fb923c', // Orange
  7:  '#f97316', // Orange-deep
  6:  '#fb7185', // Rose
  5:  '#94a3b8', // Slate
  4:  '#78716c', // Stone
  3:  '#737373', // Neutral
  2:  '#57534e', // Stone-deep
  1:  '#44403c', // Stone-darkest
};

/** Resolves a tier color, falling back to neutral slate if a tier number is
 *  outside the canonical range (e.g. legacy data). */
export function tierColor(tier: number): string {
  return TIER_COLORS[tier] ?? '#64748b';
}

/**
 * Coarse tier-band labels — pairs with the numeric tier in compact rows
 * (e.g. "Tier 16 · Apex"). Mirrors the inline ladder used by the tier-list
 * page header so the same vocabulary surfaces wherever a tier number appears.
 */
export function tierName(tier: number): string {
  if (tier >= 18) return 'Apex';
  if (tier >= 15) return 'Premium';
  if (tier >= 12) return 'High';
  if (tier >= 8) return 'Mid';
  if (tier >= 5) return 'Low';
  return 'Budget';
}

/** Phase display config — shared across overview, app-shell, admin */
export const PHASE_COLORS: Record<string, string> = {
  draft: 'text-draw bg-draw/10',
  regular: 'text-neon bg-neon/10',
  playoffs: 'text-pink bg-pink/10',
  offseason: 'text-text-muted bg-surface-overlay',
};

// ─── Profile / settings limits ───────────────────────────────────────────────
export const MAX_DISPLAY_NAME = 32;
export const MAX_BIO = 280;
export const MAX_TEAM_BIO = 280;
export const MAX_AVATAR_BYTES = 512 * 1024;
export const MAX_BANNER_BYTES = 1024 * 1024;

/** Profile color swatch presets — lifted from settings.tsx */
export const PROFILE_COLOR_SWATCHES = [
  '#7dd3fc', '#a78bfa', '#fb7185',
  '#22d3ee', '#34d399', '#facc15',
  '#fb923c', '#f43f5e', '#ec4899',
  '#8b5cf6', '#3b82f6', '#10b981',
  '#eab308', '#f97316', '#ef4444',
];

/** Default landing page options for user preferences */
export const DEFAULT_LANDING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '/', label: 'Home (League Overview)' },
  { value: '/me', label: 'My Profile' },
  { value: '/replays', label: 'Replays' },
];
