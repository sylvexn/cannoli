import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { SpeedCalcCard } from '@/pages/matchup-center/tabs/speed-tab';
import type { SpeedCalcSlot } from '@/pages/matchup-center/use-matchup-state';
import { pokemonRoute } from '@/lib/pokemon-route';
import { monToRoster } from '@/lib/draft-center/roster';
import { setSpeed, speedNature } from '@/lib/draft-center/sets';
import type { Ruleset } from '@/lib/draft-center/ruleset';
import type { DcMon } from '@/lib/draft-center/types';

const slotFor = (id: string, m: DcMon | undefined): SpeedCalcSlot => ({
  id, pokemonName: m?.name ?? '', level: 100,
  evs: m?.set?.evs.spe ?? 252, ivs: m?.set?.ivs.spe ?? 31,
  nature: m?.set ? speedNature(m.set.nature) : 'positive',
  boosts: 0, scarf: m?.set?.item === 'Choice Scarf', stickyWeb: false,
});

/** Base-speed ladder (with each set's real speed) plus two configurable calc cards. */
export function SpeedPanel({ roster, ruleset }: { roster: DcMon[]; ruleset: Ruleset }) {
  const rp = useMemo(() => roster.map(m => ({ mon: m, r: monToRoster(m, ruleset.costFormat) }))
    .sort((a, b) => b.r.stats.spe - a.r.stats.spe), [roster, ruleset.costFormat]);

  // Calc slots hold user edits; unset slots fall back to the two fastest mons.
  const [edits, setEdits] = useState<Record<string, Partial<SpeedCalcSlot>>>({});
  const slots = (['calc-a', 'calc-b'] as const).map((id, i) => {
    const defaults = slotFor(id, rp[i]?.mon);
    const e = edits[id];
    // A stale pick (mon removed from the team) falls back to the default.
    const valid = !e?.pokemonName || roster.some(m => m.name === e.pokemonName);
    return { ...defaults, ...(valid ? e : { ...e, pokemonName: defaults.pokemonName }) } as SpeedCalcSlot;
  });
  const update = (id: string, u: Partial<SpeedCalcSlot>) =>
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...u } }));

  if (roster.length === 0) {
    return <div className="rounded-lg border border-dashed border-border-default p-8 text-center text-sm text-text-muted">Add Pokemon to compare speeds.</div>;
  }

  const allPokemon = rp.map(x => x.r);
  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,200px)_minmax(0,1fr)_minmax(0,200px)] gap-3 items-start">
      <div className="md:order-1 order-2"><SpeedCalcCard slot={slots[0]} allPokemon={allPokemon} onUpdate={u => update('calc-a', u)} /></div>

      <div className="md:order-2 order-1 rounded-lg border border-border-default bg-surface-raised/50 overflow-hidden w-full max-w-md mx-auto">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-text-muted border-b border-border-subtle bg-surface-overlay/30">
          <span>Speed</span><span className="w-10 text-right">Base</span>
          <span className="w-12 text-right" title="Speed from the set's EVs / IVs / nature / Choice Scarf">Set</span>
        </div>
        {rp.map(({ mon, r }) => {
          const final = setSpeed(mon);
          return (
            <div key={mon.name} className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center px-3 py-[3px] min-w-0 border-b border-border-subtle/50 last:border-b-0">
              <div className="flex items-center gap-2 min-w-0">
                <PokemonSprite name={mon.name} size="xs" className="shrink-0" />
                <Link to={pokemonRoute(mon.name)} className="truncate min-w-0 text-xs font-mono hover:text-neon hover:underline">{mon.name}</Link>
                {mon.set?.item === 'Choice Scarf' && <span className="text-[9px] font-mono text-amber-400 shrink-0">scarf</span>}
              </div>
              <span className="w-10 text-right text-xs font-mono font-bold tabular-nums text-[#3b82f6]">{r.stats.spe}</span>
              <span className="w-12 text-right text-xs font-mono tabular-nums text-text-secondary">{final ?? <span className="text-text-muted">-</span>}</span>
            </div>
          );
        })}
      </div>

      <div className="order-3"><SpeedCalcCard slot={slots[1]} allPokemon={allPokemon} onUpdate={u => update('calc-b', u)} /></div>
    </div>
  );
}
