/**
 * Per-Pokemon set helpers: stat math, learnset-backed move options, and the
 * bridge from a set to the existing speed calculator.
 */
import { getLearnset, type DraftFormat } from '@/data/pokemon-learnsets';
import { moveDisplayName } from '@/data/move-names';
import { getPokemonData } from '@/data/pokemon-data';
import { NATURE_BY_NAME } from '@/data/battle-items';
import { calcSpeed, type SpeedNature } from '@/lib/speed';
import { emptySpread, type DcMon, type DcSet, type StatKey } from './types';

export const moveId = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export const MAX_TOTAL_EVS = 510;
export const MAX_SINGLE_EV = 252;

export function blankSet(name: string): DcSet {
  return {
    moves: [], item: '', ability: getPokemonData(name)?.abilities[0] ?? '',
    nature: 'Hardy', evs: emptySpread(0), ivs: emptySpread(31),
  };
}

export const evTotal = (s: DcSet): number =>
  Object.values(s.evs).reduce((a, b) => a + b, 0);

/** Move options from the mon's learnset for the ruleset's format, display-named + sorted. */
export function learnableMoves(name: string, format: DraftFormat): string[] {
  const ls = getLearnset(name, format);
  if (!ls) return [];
  return [...ls].map(moveDisplayName).sort((a, b) => a.localeCompare(b));
}

/** Learnset membership by move id, for "can learn" markers. */
export function learnsetIds(name: string, format: DraftFormat): Set<string> {
  return getLearnset(name, format) ?? new Set();
}

function natureMult(nature: string, stat: StatKey): number {
  const n = NATURE_BY_NAME.get(nature);
  if (!n) return 1;
  return n.plus === stat ? 1.1 : n.minus === stat ? 0.9 : 1;
}

/** Final in-game stat at `level` for a base stat + spread + nature. */
export function calcStat(stat: StatKey, base: number, ev: number, iv: number, nature: string, level = 100): number {
  const core = Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100);
  if (stat === 'hp') return base === 1 ? 1 : core + level + 10;
  return Math.floor((core + 5) * natureMult(nature, stat));
}

/** Nature's effect on Speed in the shape the shared speed calculator expects. */
export function speedNature(nature: string): SpeedNature {
  const n = NATURE_BY_NAME.get(nature);
  return n?.plus === 'spe' ? 'positive' : n?.minus === 'spe' ? 'negative' : 'neutral';
}

/** Effective Speed of a mon's set (EVs/IVs/nature/Choice Scarf). Null when no set. */
export function setSpeed(mon: DcMon, level = 100): number | null {
  const base = getPokemonData(mon.name)?.stats.spe;
  if (!mon.set || base == null) return null;
  return calcSpeed(
    base, level, mon.set.evs.spe, mon.set.ivs.spe,
    speedNature(mon.set.nature), 0, mon.set.item === 'Choice Scarf', false,
  );
}
