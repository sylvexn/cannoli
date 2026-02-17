import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { NumberInput } from '@/components/ui/number-input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { RosterPokemon } from '@/lib/types';
import type { SpeedCalcSlot } from '../use-matchup-state';
import { Plus, X } from 'lucide-react';

interface SpeedTabProps {
  teamA: RosterPokemon[];
  teamB: RosterPokemon[];
  slots: SpeedCalcSlot[];
  onAddSlot: () => void;
  onRemoveSlot: (id: string) => void;
  onUpdateSlot: (id: string, updates: Partial<SpeedCalcSlot>) => void;
}

function calcSpeed(
  baseSpe: number, level: number, evs: number, ivs: number,
  nature: 'positive' | 'neutral' | 'negative', boosts: number,
): number {
  const raw = Math.floor((2 * baseSpe + ivs + Math.floor(evs / 4)) * level / 100 + 5);
  const natureMult = nature === 'positive' ? 1.1 : nature === 'negative' ? 0.9 : 1.0;
  const natured = Math.floor(raw * natureMult);
  if (boosts === 0) return natured;
  if (boosts > 0) return Math.floor(natured * (2 + boosts) / 2);
  return Math.floor(natured * 2 / (2 - boosts));
}

export function SpeedTab({ teamA, teamB, slots, onAddSlot, onRemoveSlot, onUpdateSlot }: SpeedTabProps) {
  const speedList = useMemo(() => {
    return [
      ...teamA.map(p => ({ name: p.name, spe: p.stats.spe, side: 'a' as const })),
      ...teamB.map(p => ({ name: p.name, spe: p.stats.spe, side: 'b' as const })),
    ].sort((a, b) => b.spe - a.spe);
  }, [teamA, teamB]);

  const allPokemon = useMemo(() => [...teamA, ...teamB], [teamA, teamB]);

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
                <PokemonSprite name={entry.name} size="xs" />
                <span className="text-xs font-mono text-text-primary whitespace-nowrap">{entry.name}</span>
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
  const pokemon = allPokemon.find(p => p.name === slot.pokemonName);
  const baseSpe = pokemon?.stats.spe ?? 0;
  const computed = pokemon
    ? calcSpeed(baseSpe, slot.level, slot.evs, slot.ivs, slot.nature, slot.boosts)
    : 0;

  return (
    <div className="rounded-lg border border-border-default bg-surface-raised/50 p-2.5 space-y-2">
      {/* Header: sprite + computed speed + remove */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {pokemon && <PokemonSprite name={pokemon.name} size="sm" />}
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
        <LabeledInput label="EVs" value={slot.evs} onChange={v => onUpdate({ evs: Math.min(252, Math.max(0, v)) })} min={0} max={252} />
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
            {n === 'positive' ? '+10%' : n === 'negative' ? '-10%' : '—'}
          </button>
        ))}
      </div>

      {pokemon && (
        <div className="text-[9px] text-text-muted">Base: {baseSpe}</div>
      )}
    </div>
  );
}

function LabeledInput({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] text-text-muted w-7 shrink-0">{label}</span>
      <NumberInput
        value={value}
        onChange={onChange}
        min={min} max={max}
        className="h-5 text-[11px] [&_input]:px-1 [&_input]:h-5 [&_input]:text-[11px]"
      />
    </div>
  );
}
