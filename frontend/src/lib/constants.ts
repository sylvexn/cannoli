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
