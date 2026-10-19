/**
 * Held items and natures for Draft Center sets. Items are a curated list of the
 * competitively relevant ones (not the full Showdown item dex); the set editor
 * still accepts free text, so a missing item is never a dead end.
 */
import type { StatKey } from '@/lib/draft-center/types';

export const ITEMS: string[] = [
  'Absorb Bulb', 'Air Balloon', 'Assault Vest', 'Big Root', 'Black Belt', 'Black Glasses', 'Black Sludge',
  'Blunder Policy', 'Booster Energy', 'Cell Battery', 'Charcoal', 'Choice Band', 'Choice Scarf', 'Choice Specs',
  'Clear Amulet', 'Covert Cloak', 'Custap Berry', 'Damp Rock', 'Dragon Fang', 'Eject Button', 'Eject Pack',
  'Eviolite', 'Expert Belt', 'Figy Berry', 'Flame Orb', 'Focus Band', 'Focus Sash', 'Grassy Seed', 'Grip Claw',
  'Hard Stone', 'Heat Rock', 'Heavy-Duty Boots', 'Icy Rock', 'Iron Ball', 'Kee Berry', 'King\'s Rock',
  'Lagging Tail', 'Leftovers', 'Leppa Berry', 'Life Orb', 'Light Clay', 'Loaded Dice', 'Lum Berry', 'Macho Brace',
  'Magnet', 'Maranga Berry', 'Mental Herb', 'Metal Coat', 'Metronome', 'Miracle Seed', 'Muscle Band', 'Mystic Water',
  'Never-Melt Ice', 'Poison Barb', 'Power Herb', 'Protective Pads', 'Punching Glove', 'Quick Claw', 'Razor Fang',
  'Red Card', 'Ring Target', 'Rocky Helmet', 'Room Service', 'Safety Goggles', 'Salac Berry', 'Scope Lens',
  'Sharp Beak', 'Shed Shell', 'Shell Bell', 'Silk Scarf', 'Silver Powder', 'Sitrus Berry', 'Smooth Rock',
  'Soft Sand', 'Spell Tag', 'Terrain Extender', 'Throat Spray', 'Toxic Orb', 'Twisted Spoon', 'Utility Umbrella',
  'Weakness Policy', 'White Herb', 'Wide Lens', 'Wise Glasses', 'Zoom Lens',
];

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
