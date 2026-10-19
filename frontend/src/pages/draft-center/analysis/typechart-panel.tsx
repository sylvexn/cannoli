import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { TypeGrid, type TypeGridRow } from '@/pages/matchup-center/tabs/typechart-tab';
import { POKEMON_TYPES, type PokemonType } from '@/lib/pokemon';
import { TYPE_COLORS, TYPE_LABELS } from '@/lib/constants';
import { getDefensiveMatchups } from '@/lib/type-effectiveness';
import { monToRoster } from '@/lib/draft-center/roster';
import { pokemonRoute } from '@/lib/pokemon-route';
import type { Ruleset } from '@/lib/draft-center/ruleset';
import type { DcMon } from '@/lib/draft-center/types';

/**
 * Defensive type chart with weak/resist totals. Captains can add their tera
 * forms as extra rows (a tera'd mon defends as the mono tera type), kept out of
 * the base totals; a strip below shows which types the team can tera into.
 */
export function TypeChartPanel({ roster, ruleset }: { roster: DcMon[]; ruleset: Ruleset }) {
  const [showTera, setShowTera] = useState(true);

  const rows = useMemo<TypeGridRow[]>(() => roster.map(m => {
    const r = monToRoster(m, ruleset.costFormat);
    return { name: m.name, matchups: getDefensiveMatchups(r.types as PokemonType[], r.abilities[0]) };
  }), [roster, ruleset.costFormat]);

  const teraRows = useMemo<TypeGridRow[]>(() => roster.flatMap(m => {
    if (!m.captain) return [];
    const r = monToRoster(m, ruleset.costFormat);
    return m.teraTypes.map(t => ({
      name: m.name,
      rowKey: `${m.name}:tera:${t}`,
      label: `Tera ${t}`,
      matchups: getDefensiveMatchups([t], r.abilities[0]),
    }));
  }), [roster, ruleset.costFormat]);

  const captains = roster.filter(m => m.captain);

  if (roster.length === 0) {
    return <div className="rounded-lg border border-dashed border-border-default p-8 text-center text-sm text-text-muted">Add Pokemon to see the type chart.</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-text-muted">
        <span>Defensive</span>
        <span className="normal-case tracking-normal">green = resists, red = weak. Footer: resist over weak count.</span>
      </div>
      <TypeGrid chart={rows} mode="defensive" />

      {captains.length > 0 && (
        <div className="rounded-lg border border-pink-400/25 bg-pink-400/[0.03] p-2.5 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles size={13} className="text-pink-400" />
            <span className="text-xs font-heading font-semibold uppercase tracking-wider text-pink-400">Tera forms</span>
            <label className="ml-auto flex items-center gap-1.5 text-[10px] font-mono text-text-muted cursor-pointer">
              Show defensive rows
              <Switch size="sm" checked={showTera} onCheckedChange={setShowTera} />
            </label>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {captains.map(m => (
              <div key={m.name} className="flex items-center gap-1.5 min-w-0">
                <Link to={pokemonRoute(m.name)} className="text-[11px] font-mono hover:text-neon hover:underline truncate">{m.name}</Link>
                {m.teraTypes.length === 0 && <span className="text-[10px] text-text-muted italic">no tera types yet</span>}
                {m.teraTypes.map(t => (
                  <span key={t} className="inline-flex items-center rounded-full px-1.5 h-4 text-[9px] font-bold uppercase text-white" style={{ backgroundColor: TYPE_COLORS[t] }}>
                    {TYPE_LABELS[t]}
                  </span>
                ))}
              </div>
            ))}
          </div>
          {showTera && teraRows.length > 0 && <TypeGrid chart={teraRows} mode="defensive" />}
        </div>
      )}

      <OffensiveStab roster={roster} ruleset={ruleset} />
    </div>
  );
}

/** Which defending types the team's STAB (and captains' tera types) hit super-effectively. */
function OffensiveStab({ roster, ruleset }: { roster: DcMon[]; ruleset: Ruleset }) {
  const { stab, tera } = useMemo(() => {
    const stabTypes = new Set<PokemonType>();
    const teraTypes = new Set<PokemonType>();
    for (const m of roster) {
      for (const t of monToRoster(m, ruleset.costFormat).types) stabTypes.add(t as PokemonType);
      if (m.captain) for (const t of m.teraTypes) teraTypes.add(t);
    }
    // defending type D is hit super-effectively by attacking type A iff the mono-D chart has A > 1
    const hit = (attackers: Set<PokemonType>) => POKEMON_TYPES.filter(d =>
      getDefensiveMatchups([d]).some(x => x.multiplier > 1 && attackers.has(x.type)));
    const all = new Set([...stabTypes, ...teraTypes]);
    return { stab: hit(stabTypes), tera: hit(all).filter(d => !hit(stabTypes).includes(d)) };
  }, [roster, ruleset.costFormat]);

  const missing = POKEMON_TYPES.filter(d => !stab.includes(d) && !tera.includes(d));

  return (
    <div className="rounded-lg border border-border-default p-2.5 flex flex-col gap-1.5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
        STAB coverage <span className="normal-case tracking-normal">- types hit super-effectively by the team's STAB types</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {POKEMON_TYPES.map(d => {
          const state = stab.includes(d) ? 'stab' : tera.includes(d) ? 'tera' : 'none';
          return (
            <span
              key={d}
              title={state === 'stab' ? 'Hit by STAB' : state === 'tera' ? 'Only via a tera type' : 'Not hit super-effectively by STAB'}
              className={cn(
                'inline-flex items-center rounded-full px-2 h-5 text-[9px] font-bold uppercase text-white',
                state === 'none' && 'opacity-25',
                state === 'tera' && 'ring-2 ring-pink-400',
              )}
              style={{ backgroundColor: TYPE_COLORS[d] }}
            >
              {TYPE_LABELS[d]}
            </span>
          );
        })}
      </div>
      {missing.length > 0 && roster.length > 0 && (
        <div className="text-[10px] text-text-muted">Uncovered: {missing.map(t => TYPE_LABELS[t]).join(', ')}</div>
      )}
    </div>
  );
}
