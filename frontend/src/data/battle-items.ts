/**
 * Held items and natures for Draft Center sets. Items live in items.ts.
 */
import type { StatKey } from '@/lib/draft-center/types';


export interface Nature { name: string; plus: StatKey | null; minus: StatKey | null }

const N = (name: string, plus: StatKey | null, minus: StatKey | null): Nature => ({ name, plus, minus });

export const NATURES: Nature[] = [
  N('Hardy', null, null), N('Docile', null, null), N('Serious', null, null), N('Bashful', null, null), N('Quirky', null, null),
  N('Lonely', 'atk', 'def'), N('Brave', 'atk', 'spe'), N('Adamant', 'atk', 'spa'), N('Naughty', 'atk', 'spd'),
  N('Bold', 'def', 'atk'), N('Relaxed', 'def', 'spe'), N('Impish', 'def', 'spa'), N('Lax', 'def', 'spd'),
  N('Timid', 'spe', 'atk'), N('Hasty', 'spe', 'def'), N('Jolly', 'spe', 'spa'), N('Naive', 'spe', 'spd'),
  N('Modest', 'spa', 'atk'), N('Mild', 'spa', 'def'), N('Quiet', 'spa', 'spe'), N('Rash', 'spa', 'spd'),
  N('Calm', 'spd', 'atk'), N('Gentle', 'spd', 'def'), N('Sassy', 'spd', 'spe'), N('Careful', 'spd', 'spa'),
];

export const NATURE_BY_NAME = new Map(NATURES.map(n => [n.name, n]));

/** Compact "+Atk / -SpA" label for a nature ('' when neutral). */
export function natureEffect(name: string): string {
  const n = NATURE_BY_NAME.get(name);
  if (!n?.plus || !n.minus) return '';
  const L: Record<StatKey, string> = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
  return `+${L[n.plus]} -${L[n.minus]}`;
}
