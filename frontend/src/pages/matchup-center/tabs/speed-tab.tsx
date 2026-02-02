import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Input } from '@/components/ui/input';
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

/** Pokemon speed stat formula at level 100 */
function calcSpeed(
  baseSpe: number,
  level: number,
  evs: number,
  ivs: number,
  nature: 'positive' | 'neutral' | 'negative',
  boosts: number,
): number {
  const raw = Math.floor((2 * baseSpe + ivs + Math.floor(evs / 4)) * level / 100 + 5);
  const natureMult = nature === 'positive' ? 1.1 : nature === 'negative' ? 0.9 : 1.0;
  const natured = Math.floor(raw * natureMult);
  // Boost multipliers: +1=1.5, +2=2, +3=2.5, +4=3, +5=3.5, +6=4, -1=0.67, -2=0.5, etc.
  if (boosts === 0) return natured;
  if (boosts > 0) return Math.floor(natured * (2 + boosts) / 2);
  return Math.floor(natured * 2 / (2 - boosts));
}

export function SpeedTab({ teamA, teamB, slots, onAddSlot, onRemoveSlot, onUpdateSlot }: SpeedTabProps) {
  // Merge both teams for base speed display
  const speedList = useMemo(() => {
    const all = [
      ...teamA.map(p => ({ name: p.name, spe: p.stats.spe, side: 'a' as const })),
      ...teamB.map(p => ({ name: p.name, spe: p.stats.spe, side: 'b' as const })),
    ].sort((a, b) => b.spe - a.spe);
    return all;
  }, [teamA, teamB]);

  const allPokemon = useMemo(() => [...teamA, ...teamB], [teamA, teamB]);

  return (
    <div className="flex gap-6">
      {/* Base Speed Column */}
      <div className="w-64 shrink-0">
        <div className="text-xs font-medium text-text-primary mb-2">Base Speed</div>
        <div className="rounded-lg border border-border-default bg-surface-raised/50 overflow-hidden">
          {speedList.length === 0 ? (
            <div className="p-4 text-center text-text-muted text-sm">No teams loaded</div>
          ) : (
            <div className="divide-y divide-border-subtle/50">
              {speedList.map((entry, i) => (
                <div
                  key={`${entry.name}-${entry.side}-${i}`}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1',
                    entry.side === 'a' ? 'bg-[#3b82f6]/5' : 'bg-[#ef4444]/5',
                  )}
                >
                  <PokemonSprite name={entry.name} size="xs" />
                  <span className="text-xs text-text-primary flex-1 truncate">{entry.name}</span>
                  <span className={cn(
                    'text-xs font-mono font-bold tabular-nums',
                    entry.side === 'a' ? 'text-[#3b82f6]' : 'text-[#ef4444]',
                  )}>
                    {entry.spe}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Speed Calculator Slots */}
      <div className="flex-1 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-text-primary">Speed Calculator</div>
          <Button size="xs" variant="outline" onClick={onAddSlot}>
            <Plus size={12} />
            Add Slot
          </Button>
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(slots.length, 3)}, 1fr)` }}>
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
    </div>
  );
}

function SpeedCalcCard({
  slot,
  allPokemon,
  onUpdate,
  onRemove,
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
    <div className="rounded-lg border border-border-default bg-surface-raised/50 p-3 space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {pokemon && <PokemonSprite name={pokemon.name} size="sm" />}
          <span className="text-2xl font-bold font-mono text-neon tabular-nums">{computed}</span>
        </div>
        {onRemove && (
          <button onClick={onRemove} className="p-0.5 rounded hover:bg-surface-overlay text-text-muted hover:text-text-primary transition-colors">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Pokemon selector */}
      <div className="space-y-1">
        <label className="text-[10px] text-text-muted">Pokemon</label>
        <Select value={slot.pokemonName} onValueChange={(v) => { if (v) onUpdate({ pokemonName: v }); }}>
          <SelectTrigger className="h-7 text-xs">
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
      </div>

      {/* Stat inputs grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <label className="text-[10px] text-text-muted">Level</label>
          <Input
            type="number"
            value={slot.level}
            onChange={e => onUpdate({ level: Number(e.target.value) || 100 })}
            min={1} max={100}
            className="h-6 text-xs"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[10px] text-text-muted">EVs</label>
          <Input
            type="number"
            value={slot.evs}
            onChange={e => onUpdate({ evs: Math.min(252, Math.max(0, Number(e.target.value) || 0)) })}
            min={0} max={252}
            className="h-6 text-xs"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[10px] text-text-muted">IVs</label>
          <Input
            type="number"
            value={slot.ivs}
            onChange={e => onUpdate({ ivs: Math.min(31, Math.max(0, Number(e.target.value) || 0)) })}
            min={0} max={31}
            className="h-6 text-xs"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[10px] text-text-muted">Boosts</label>
          <Input
            type="number"
            value={slot.boosts}
            onChange={e => onUpdate({ boosts: Math.min(6, Math.max(-6, Number(e.target.value) || 0)) })}
            min={-6} max={6}
            className="h-6 text-xs"
          />
        </div>
      </div>

      {/* Nature */}
      <div className="space-y-0.5">
        <label className="text-[10px] text-text-muted">Nature</label>
        <div className="flex gap-1">
          {(['positive', 'neutral', 'negative'] as const).map(n => (
            <button
              key={n}
              onClick={() => onUpdate({ nature: n })}
              className={cn(
                'flex-1 px-1.5 py-1 rounded text-[10px] font-medium border transition-colors',
                slot.nature === n
                  ? n === 'positive' ? 'bg-win/15 text-win border-win/30'
                    : n === 'negative' ? 'bg-loss/15 text-loss border-loss/30'
                    : 'bg-surface-overlay text-text-primary border-border-default'
                  : 'border-transparent text-text-muted hover:text-text-secondary',
              )}
            >
              {n === 'positive' ? '+10%' : n === 'negative' ? '-10%' : 'Neutral'}
            </button>
          ))}
        </div>
      </div>

      {/* Base stat info */}
      {pokemon && (
        <div className="text-[10px] text-text-muted">
          Base Speed: {baseSpe}
        </div>
      )}
    </div>
  );
}
