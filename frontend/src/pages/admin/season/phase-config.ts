import { Play, Trophy, Swords, Flag, Calendar } from 'lucide-react';

export const PHASES = ['draft', 'regular', 'playoffs', 'offseason'] as const;
export type Phase = typeof PHASES[number];

export const phaseConfig: Record<Phase, { label: string; color: string; icon: typeof Play; description: string }> = {
  draft: { label: 'Draft', color: 'text-draw bg-draw/10 border-draw/30', icon: Trophy, description: 'Teams draft Pokemon from the tier list' },
  regular: { label: 'Regular Season', color: 'text-neon bg-neon/10 border-neon/30', icon: Swords, description: 'Weekly matches and standings' },
  playoffs: { label: 'Playoffs', color: 'text-pink bg-pink/10 border-pink/30', icon: Flag, description: 'Top teams compete in elimination bracket' },
  offseason: { label: 'Offseason', color: 'text-text-muted bg-surface-overlay border-border', icon: Calendar, description: 'Between seasons — prep for next' },
};

/** Predraft sits before PHASES (new seasons start here); shown on cards, not in the advance order. */
export const PREDRAFT_CONFIG = { label: 'Predraft', color: 'text-text-secondary bg-surface-overlay border-border-default', icon: Calendar, description: 'Season created; rules, teams and dates editable until the draft opens' };

export function getNextPhase(current: Phase): Phase | null {
  const idx = PHASES.indexOf(current);
  return idx < PHASES.length - 1 ? PHASES[idx + 1] : null;
}

export const PRESET_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c',
  '#0891b2', '#ca8a04', '#be185d', '#4f46e5', '#059669',
];

export interface EditableLeague {
  id: string;
  name: string;
  color: string;
}
