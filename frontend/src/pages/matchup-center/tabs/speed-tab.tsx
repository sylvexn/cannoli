import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { pokemonRoute } from '@/lib/pokemon-route';
import { NumberInput } from '@/components/ui/number-input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { RosterPokemon } from '@/lib/types';
import type { SpeedCalcSlot } from '../use-matchup-state';
import { calcSpeed } from '@/lib/speed';
import { Plus, X } from 'lucide-react';

interface SpeedTabProps {
  teamA: RosterPokemon[];
  teamB: RosterPokemon[];
  slots: SpeedCalcSlot[];
  onAddSlot: () => void;
  onRemoveSlot: (id: string) => void;
  onUpdateSlot: (id: string, updates: Partial<SpeedCalcSlot>) => void;
}

export function SpeedTab({ teamA, teamB, slots, onAddSlot, onRemoveSlot, onUpdateSlot }: SpeedTabProps) {
  const { openSideCard } = usePokemonSideCard();
  const speedList = useMemo(() => {
    return [
      ...teamA.map(p => ({ name: p.name, spe: p.stats.spe, side: 'a' as const, isShiny: p.isShiny, nickname: p.nickname })),
      ...teamB.map(p => ({ name: p.name, spe: p.stats.spe, side: 'b' as const, isShiny: p.isShiny, nickname: p.nickname })),
    ].sort((a, b) => b.spe - a.spe);
  }, [teamA, teamB]);

  const allPokemon = useMemo(() => [...teamA, ...teamB].sort((a, b) => b.stats.spe - a.stats.spe), [teamA, teamB]);

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
      {/* Speed Calculators — Left */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-muted">Speed Calculator</div>
          <Button size="xs" variant="outline" onClick={onAddSlot}>
            <Plus size={12} />
            Add Slot
          </Button>
        </div>

        <div className="grid gap-3 grid-cols-1" style={{
          gridTemplateColumns: slots.length > 2
            ? `repeat(2, minmax(0, 200px))`
            : `repeat(${slots.length}, minmax(0, 200px))`,
        }}>
          {slots.map(slot => (
            <SpeedCalcCard
              key={slot.id}
              slot={slot}
              allPokemon={allPokemon}
              onUpdate={(updates) => onUpdateSlot(slot.id, updates)}
              onRemove={slots.length > 1 ? () => onRemoveSlot(slot.id) : undefined}
            />
          ))}
        </div>
      </div>

      {/* Base Speed Column — Center */}
      <div className="rounded-lg border border-border-default bg-surface-raised/50 overflow-hidden w-[260px]">
        <div className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-text-muted border-b border-border-subtle bg-surface-overlay/30 text-center">
          Base Speed
        </div>
        {speedList.length === 0 ? (
          <div className="p-4 text-center text-text-muted text-sm">No teams loaded</div>
        ) : (
          <div>
            {speedList.map((entry, i) => (
              <div
                key={`${entry.name}-${entry.side}-${i}`}
                className={cn(
                  'flex items-center gap-2 px-2.5 py-[3px]',
                  entry.side === 'a' ? 'bg-[#3b82f6]/10 border-l-2 border-l-[#3b82f6]/50' : 'bg-[#ef4444]/10 border-l-2 border-l-[#ef4444]/50',
                )}
              >
                <button onClick={() => openSideCard(entry.name)} title={entry.nickname ? `${entry.name} — "${entry.nickname}"` : 'View details'}>
                  <PokemonSprite name={entry.name} size="xs" shiny={entry.isShiny} />
                </button>
                <Link
                  to={pokemonRoute(entry.name)}
                  className="text-xs font-mono text-text-primary hover:text-neon hover:underline transition-colors whitespace-nowrap"
                >
                  {entry.name}
                </Link>
                {entry.nickname && (
                  <span className="text-[10px] italic font-mono text-text-muted truncate" title={entry.nickname}>
                    "{entry.nickname}"
                  </span>
                )}
                <span className="flex-1" />
                <span className={cn(
                  'text-xs font-mono font-bold tabular-nums shrink-0',
                  entry.side === 'a' ? 'text-[#3b82f6]' : 'text-[#ef4444]',
                )}>
                  {entry.spe}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right spacer — keeps center column centered */}
      <div />
    </div>
  );
}

function SpeedCalcCard({
  slot, allPokemon, onUpdate, onRemove,
}: {
  slot: SpeedCalcSlot;
  allPokemon: RosterPokemon[];
  onUpdate: (updates: Partial<SpeedCalcSlot>) => void;
  onRemove?: () => void;
}) {
  const { openSideCard } = usePokemonSideCard();
  const pokemon = allPokemon.find(p => p.name === slot.pokemonName);
  const baseSpe = pokemon?.stats.spe ?? 0;
  const computed = pokemon
    ? calcSpeed(baseSpe, slot.level, slot.evs, slot.ivs, slot.nature, slot.boosts, slot.scarf, slot.stickyWeb)
    : 0;

  return (
    <div className="rounded-lg border border-border-default bg-surface-raised/50 p-2.5 space-y-2">
      {/* Header: sprite + computed speed + remove */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {pokemon && (
            <button onClick={() => openSideCard(pokemon.name)} title={pokemon.nickname ? `${pokemon.name} — "${pokemon.nickname}"` : 'View details'}>
              <PokemonSprite name={pokemon.name} size="sm" shiny={pokemon.isShiny} />
            </button>
          )}
          <span className="text-xl font-bold font-mono text-neon tabular-nums">{computed}</span>
        </div>
        {onRemove && (
          <button onClick={onRemove} className="p-0.5 rounded hover:bg-surface-overlay text-text-muted">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Pokemon selector */}
      <Select value={slot.pokemonName} onValueChange={(v) => { if (v) onUpdate({ pokemonName: v }); }}>
        <SelectTrigger className="h-6 text-xs">
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          {allPokemon.map(p => (
            <SelectItem key={p.name} value={p.name}>
              {p.name} ({p.stats.spe})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Compact stat grid */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <LabeledInput label="Lv" value={slot.level} onChange={v => onUpdate({ level: v || 100 })} min={1} max={100} />
        <LabeledInput label="EVs" value={slot.evs} onChange={v => onUpdate({ evs: Math.min(252, Math.max(0, v)) })} min={0} max={252} step={4} />
        <LabeledInput label="IVs" value={slot.ivs} onChange={v => onUpdate({ ivs: Math.min(31, Math.max(0, v)) })} min={0} max={31} />
        <LabeledInput label="Boost" value={slot.boosts} onChange={v => onUpdate({ boosts: Math.min(6, Math.max(-6, v)) })} min={-6} max={6} />
      </div>

      {/* Nature toggle */}
      <div className="flex gap-0.5">
        {(['positive', 'neutral', 'negative'] as const).map(n => (
          <button
            key={n}
            onClick={() => onUpdate({ nature: n })}
            className={cn(
              'flex-1 px-1 py-0.5 rounded text-[9px] font-medium border transition-colors',
              slot.nature === n
                ? n === 'positive' ? 'bg-win/15 text-win border-win/30'
                  : n === 'negative' ? 'bg-loss/15 text-loss border-loss/30'
                  : 'bg-surface-overlay text-text-primary border-border-default'
                : 'border-transparent text-text-muted hover:text-text-secondary',
            )}
          >
            {n === 'positive' ? '+Spe' : n === 'negative' ? '-Spe' : 'Neutral'}
          </button>
        ))}
      </div>

      {/* Item / Field toggles */}
      <div className="flex gap-0.5">
        <button
          onClick={() => onUpdate({ scarf: !slot.scarf })}
          className={cn(
            'flex-1 px-1 py-0.5 rounded text-[9px] font-medium border transition-colors',
            slot.scarf
              ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
              : 'border-transparent text-text-muted hover:text-text-secondary',
          )}
        >
          Scarf
        </button>
        <button
          onClick={() => onUpdate({ stickyWeb: !slot.stickyWeb })}
          className={cn(
            'flex-1 px-1 py-0.5 rounded text-[9px] font-medium border transition-colors',
            slot.stickyWeb
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'border-transparent text-text-muted hover:text-text-secondary',
          )}
        >
          Sticky Web
        </button>
      </div>

      {pokemon && (
        <div className="text-[9px] text-text-muted">Base: {baseSpe}</div>
      )}
    </div>
  );
}

function LabeledInput({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] text-text-muted w-7 shrink-0">{label}</span>
      <NumberInput
        value={value}
        onChange={onChange}
        min={min} max={max}
        step={step}
        className="h-5 text-[11px] [&_input]:px-1 [&_input]:h-5 [&_input]:text-[11px]"
      />
    </div>
  );
}
