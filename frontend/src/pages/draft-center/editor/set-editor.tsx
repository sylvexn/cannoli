import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NATURES, natureEffect } from '@/data/battle-items';
import { ALL_ITEMS } from '@/data/items';
import { MOVE_NAMES } from '@/data/move-names';
import { MOVE_TYPES } from '@/data/move-types';
import { getPokemonData } from '@/data/pokemon-data';
import { TYPE_COLORS } from '@/lib/constants';
import {
  blankSet, calcStat, evTotal, learnableMoves, learnsetIds, moveId, MAX_SINGLE_EV, MAX_TOTAL_EVS,
} from '@/lib/draft-center/sets';
import { STAT_KEYS, STAT_LABELS, type DcMon, type DcSet, type StatKey } from '@/lib/draft-center/types';
import { Combobox } from './combobox';
import type { Ruleset } from '@/lib/draft-center/ruleset';

/** Moveset / item / ability / nature / EVs / IVs for one Pokemon. Illegal values warn, never block. */
export function SetEditor({ mon, ruleset, onChange }: {
  mon: DcMon;
  ruleset: Ruleset;
  onChange: (set: DcSet) => void;
}) {
  const data = getPokemonData(mon.name);
  const set = mon.set ?? blankSet(mon.name);
  const patch = (p: Partial<DcSet>) => onChange({ ...set, ...p });

  // No learnset data for this mon -> offer every move rather than an empty list.
  const moveOptions = useMemo(() => {
    const l = learnableMoves(mon.name, ruleset.learnsetFormat);
    return l.length ? l : Object.values(MOVE_NAMES).sort((a, b) => a.localeCompare(b));
  }, [mon.name, ruleset.learnsetFormat]);
  const ids = useMemo(() => learnsetIds(mon.name, ruleset.learnsetFormat), [mon.name, ruleset.learnsetFormat]);
  const evs = evTotal(set);
  const effect = natureEffect(set.nature);

  const setMove = (i: number, v: string) => {
    // Slots keep their position (blanks included) so a half-filled set doesn't shuffle while typing.
    const moves = [0, 1, 2, 3].map(j => set.moves[j] ?? '');
    moves[i] = v;
    patch({ moves });
  };

  return (
    <div className="flex flex-col gap-2.5 p-2.5 border-t border-border-subtle bg-surface-overlay/20">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {[0, 1, 2, 3].map(i => {
          const v = set.moves[i] ?? '';
          const type = MOVE_TYPES[v];
          const illegal = !!v && ids.size > 0 && !ids.has(moveId(v));
          return (
            <Combobox
              key={i} value={v} options={moveOptions} onChange={x => setMove(i, x)}
              placeholder={`Move ${i + 1}`} label={`Move ${i + 1}`} invalid={illegal}
              leading={<>
                <span className="shrink-0 size-2 rounded-full bg-surface-overlay ring-1 ring-white/10" style={type ? { backgroundColor: TYPE_COLORS[type] } : undefined} />
                {illegal && <span title={`${mon.name} can't learn this in ${ruleset.label}`} className="shrink-0 text-amber-400"><AlertTriangle size={12} /></span>}
              </>}
            />
        );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
        <label className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[9px] font-mono uppercase text-text-muted">Ability</span>
          <Select value={set.ability} onValueChange={v => { if (v) patch({ ability: v }); }}>
            <SelectTrigger size="sm" className="w-full"><SelectValue placeholder="Ability" /></SelectTrigger>
            <SelectContent>
              {(data?.abilities ?? []).map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[9px] font-mono uppercase text-text-muted">Item</span>
          <Combobox value={set.item} options={ALL_ITEMS} onChange={v => patch({ item: v })} placeholder="Item" label="Item" />
        </label>
        <label className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[9px] font-mono uppercase text-text-muted">Nature {effect && <span className="normal-case text-text-secondary">{effect}</span>}</span>
          <Select value={set.nature} onValueChange={v => { if (v) patch({ nature: v }); }}>
            <SelectTrigger size="sm" className="w-full"><SelectValue placeholder="Nature" /></SelectTrigger>
            <SelectContent>
              {NATURES.map(n => <SelectItem key={n.name} value={n.name}>{n.name}{n.plus ? ` (+${STAT_LABELS[n.plus]} -${STAT_LABELS[n.minus!]})` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[300px] grid grid-cols-[2.5rem_1fr_1fr_2.5rem] gap-x-2 gap-y-1 items-center">
          <span />
          <span className="text-[9px] font-mono uppercase text-text-muted flex justify-between">
            EVs <span className={cn('tabular-nums', evs > MAX_TOTAL_EVS ? 'text-amber-400 font-bold' : '')}>{evs}/{MAX_TOTAL_EVS}</span>
          </span>
          <span className="text-[9px] font-mono uppercase text-text-muted">IVs</span>
          <span className="text-[9px] font-mono uppercase text-text-muted text-right">Lv100</span>
          {STAT_KEYS.map(k => (
            <StatRow
              key={k} stat={k} base={data?.stats[k] ?? 0} set={set}
              onEv={v => patch({ evs: { ...set.evs, [k]: v } })}
              onIv={v => patch({ ivs: { ...set.ivs, [k]: v } })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StatRow({ stat, base, set, onEv, onIv }: {
  stat: StatKey; base: number; set: DcSet; onEv: (v: number) => void; onIv: (v: number) => void;
}) {
  const final = calcStat(stat, base, set.evs[stat], set.ivs[stat], set.nature);
  const n = NATURES.find(x => x.name === set.nature);
  return (
    <>
      <span className={cn('text-[10px] font-mono', n?.plus === stat ? 'text-win' : n?.minus === stat ? 'text-loss' : 'text-text-secondary')}>
        {STAT_LABELS[stat]}{n?.plus === stat ? '+' : n?.minus === stat ? '-' : ''}
      </span>
      <NumberInput value={set.evs[stat]} onChange={onEv} min={0} max={MAX_SINGLE_EV} step={4} className="[&_input]:h-6 [&_input]:text-[11px] [&_input]:px-1.5" />
      <NumberInput value={set.ivs[stat]} onChange={onIv} min={0} max={31} className="[&_input]:h-6 [&_input]:text-[11px] [&_input]:px-1.5" />
      <span className="text-[11px] font-mono tabular-nums text-text-primary text-right">{final}</span>
    </>
  );
}
