/** Pure helpers behind the Draft Center compare page (and the roles panel's on-set check). */
import { POKEMON_TYPES, type PokemonType } from '@/lib/pokemon';
import { getDefensiveMatchups, normalizeAbility } from '@/lib/type-effectiveness';
import { getTeamMoveCoverage } from '@/lib/move-coverage';
import type { MoveCategory, MoveCategoryEntry } from '@/data/move-categories';
import { monToRoster, teamToRoster } from './roster';
import { moveId, setSpeed } from './sets';
import type { Ruleset } from './ruleset';
import type { DcMon } from './types';

/** Does this mon's chosen set (ability or one of its 4 moves) satisfy the role entry? */
export function monHasEntry(mon: DcMon, entry: Pick<MoveCategoryEntry, 'moveId' | 'isAbility'>): boolean {
  if (entry.isAbility) return !!mon.set?.ability && normalizeAbility(mon.set.ability) === entry.moveId;
  return !!mon.set?.moves.some(mv => moveId(mv) === entry.moveId);
}

export interface TypeTotals { type: PokemonType; weak: number; resist: number }

/** Per attacking type: how many roster mons are weak to it / resist (or are immune to) it. */
export function typeTotals(roster: DcMon[], ruleset: Pick<Ruleset, 'costFormat'>): TypeTotals[] {
  const rows = roster.map(m => {
    const r = monToRoster(m, ruleset.costFormat);
    return getDefensiveMatchups(r.types as PokemonType[], r.abilities[0]);
  });
  return POKEMON_TYPES.map(type => {
    let weak = 0, resist = 0;
    for (const row of rows) {
      const mult = row.find(x => x.type === type)?.multiplier ?? 1;
      if (mult > 1) weak++; else if (mult < 1) resist++;
    }
    return { type, weak, resist };
  });
}

/** A "hole": 3+ weak and at most 1 resist. */
export const isHole = (t: Pick<TypeTotals, 'weak' | 'resist'>): boolean => t.weak >= 3 && t.resist <= 1;
export const holesOf = (totals: TypeTotals[]): PokemonType[] => totals.filter(isHole).map(t => t.type);

/** Net defensive score for a type (resist - weak); higher is better. */
export const typeScore = (t: Pick<TypeTotals, 'weak' | 'resist'>): number => t.resist - t.weak;

export type Side = 'a' | 'b';
export interface LadderEntry { side: Side; name: string; base: number; set: number | null }

/** Both rosters interleaved, fastest base speed first; ties put team A first, then by name. */
export function mergedSpeedLadder(a: DcMon[], b: DcMon[], ruleset: Pick<Ruleset, 'costFormat'>): LadderEntry[] {
  const entries = (side: Side, roster: DcMon[]): LadderEntry[] => roster.map(m => ({
    side, name: m.name, base: monToRoster(m, ruleset.costFormat).stats.spe, set: setSpeed(m),
  }));
  return [...entries('a', a), ...entries('b', b)].sort((x, y) =>
    y.base - x.base || x.side.localeCompare(y.side) || x.name.localeCompare(y.name));
}

/** How many mons on the other side this entry outspeeds (by base speed). */
export const outspeeds = (ladder: LadderEntry[], e: LadderEntry): number =>
  ladder.filter(o => o.side !== e.side && o.base < e.base).length;

export interface RoleRow { category: string; entry: MoveCategoryEntry; has: boolean }

/** Role checklist: covered by set moves when any set has moves, else by learnset. */
export function roleChecklist(roster: DcMon[], ruleset: Ruleset, cats: MoveCategory[]): RoleRow[] {
  const bySet = roster.some(m => (m.set?.moves.length ?? 0) > 0);
  const byName = new Map(roster.map(m => [m.name, m]));
  return getTeamMoveCoverage(teamToRoster(roster, ruleset), [], cats, ruleset.learnsetFormat).flatMap(({ category, entries }) =>
    entries.map(({ entry, teamA }) => ({
      category: category.name, entry,
      has: bySet ? teamA.some(n => { const m = byName.get(n); return !!m && monHasEntry(m, entry); }) : teamA.length > 0,
    })));
}

/** Pokemon in both rosters, and the ones unique to each. */
export function sharedUnique(a: DcMon[], b: DcMon[]) {
  const an = new Set(a.map(m => m.name)), bn = new Set(b.map(m => m.name));
  return {
    shared: [...an].filter(n => bn.has(n)),
    onlyA: [...an].filter(n => !bn.has(n)),
    onlyB: [...bn].filter(n => !an.has(n)),
  };
}
