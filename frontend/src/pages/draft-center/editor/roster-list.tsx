import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Plus, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { POKEMON_TYPES, type PokemonType } from '@/lib/pokemon';
import { TYPE_COLORS, TYPE_LABELS } from '@/lib/constants';
import { getPokemonData } from '@/data/pokemon-data';
import { pokemonRoute } from '@/lib/pokemon-route';
import { baseTier, captainEligibility, monCost } from '@/lib/draft-center/rules';
import { rosterSizeOf, type Ruleset } from '@/lib/draft-center/ruleset';
import type { DcMon, DcSet, DcViolation } from '@/lib/draft-center/types';
import type { OwnerMap } from '@/lib/draft-center/availability';
import { AvailBadge } from './avail-badge';
import { SetEditor } from './set-editor';

interface Props {
  roster: DcMon[];
  ruleset: Ruleset;
  violations: DcViolation[];
  onChange: (roster: DcMon[]) => void;
  onAdd: () => void;
  owners?: OwnerMap | null;
  leagueId?: string | null;
}

/** Roster slots: captain toggle, tera types, cost, expandable set editor. Empty slots are add-targets. */
export function RosterList({ roster, ruleset, violations, onChange, onAdd, owners = null, leagueId = null }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const patch = (name: string, p: Partial<DcMon>) => onChange(roster.map(m => (m.name === name ? { ...m, ...p } : m)));
  const emptySlots = Math.max(0, rosterSizeOf(ruleset) - roster.length);

  return (
    <div className="flex flex-col gap-1">
      {roster.map(m => {
        const mine = violations.filter(v => v.pokemon === m.name && v.severity === 'warn');
        const expanded = open === m.name;
        return (
          <div key={m.name} className={cn(
            'rounded-lg border bg-surface-raised/50 min-w-0',
            mine.length ? 'border-amber-400/40' : m.captain ? 'border-pink-400/40' : 'border-border-default',
          )}>
            <MonRow
              mon={m} ruleset={ruleset} owners={owners} leagueId={leagueId} warnings={mine} expanded={expanded}
              onToggleOpen={() => setOpen(expanded ? null : m.name)}
              onCaptain={() => patch(m.name, { captain: !m.captain })}
              onTera={teraTypes => patch(m.name, { teraTypes })}
              onRemove={() => { onChange(roster.filter(x => x.name !== m.name)); if (expanded) setOpen(null); }}
            />
            {expanded && <SetEditor mon={m} ruleset={ruleset} onChange={(set: DcSet) => patch(m.name, { set })} />}
          </div>
        );
      })}
      {Array.from({ length: emptySlots }, (_, i) => (
        <button
          key={`empty-${i}`}
          type="button"
          onClick={onAdd}
          className="flex items-center justify-center gap-1.5 h-10 rounded-lg border border-dashed border-border-default text-xs text-text-muted hover:text-neon hover:border-neon/40 hover:bg-neon/5 transition-colors"
        >
          <Plus size={13} /> Add Pokemon
        </button>
      ))}
      {emptySlots === 0 && (
        <button type="button" onClick={onAdd} className="flex items-center justify-center gap-1.5 h-8 rounded-lg text-[11px] text-text-muted hover:text-neon transition-colors">
          <Plus size={12} /> Add another (over roster size)
        </button>
      )}
    </div>
  );
}

function MonRow({ mon, ruleset, owners, leagueId, warnings, expanded, onToggleOpen, onCaptain, onTera, onRemove }: {
  mon: DcMon; ruleset: Ruleset; owners: OwnerMap | null; leagueId: string | null; warnings: DcViolation[]; expanded: boolean;
  onToggleOpen: () => void; onCaptain: () => void; onTera: (t: PokemonType[]) => void; onRemove: () => void;
}) {
  const data = getPokemonData(mon.name);
  const tier = baseTier(mon.name, ruleset.costFormat);
  const cost = monCost(mon, ruleset);
  const elig = captainEligibility(mon.name, ruleset);
  const setSummary = mon.set ? [mon.set.item, ...mon.set.moves.filter(Boolean)].filter(Boolean).join(' / ') : '';

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 min-w-0">
      <Link to={pokemonRoute(mon.name)} className="shrink-0 hover:scale-105 transition-transform">
        <PokemonSprite name={mon.name} size="md" />
      </Link>
      <div className="min-w-0 flex-1 basis-36">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link to={pokemonRoute(mon.name)} className={cn('truncate text-sm font-mono font-semibold hover:underline', mon.captain ? 'text-pink-400' : 'text-text-primary hover:text-neon')}>
            {mon.name}
          </Link>
          <AvailBadge owners={owners} leagueId={leagueId} name={mon.name} />
          {warnings.length > 0 && (
            <Tooltip>
              <TooltipTrigger render={<span className="size-1.5 rounded-full bg-amber-400 shrink-0" />} />
              <TooltipContent side="top"><ul>{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul></TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="shrink-0"><TypeChip types={data?.types ?? []} size="xs" noTooltip /></span>
          {setSummary && <span className="truncate text-[10px] text-text-muted font-mono min-w-0">{setSummary}</span>}
        </div>
      </div>

      {/* Controls wrap under the identity block when the row is too narrow, instead of crushing the type chips. */}
      <div className="ml-auto shrink-0 flex items-center gap-2">
      <div className="shrink-0 flex flex-col items-center gap-0.5 w-8">
        {tier != null ? <TierBadge points={tier} /> : <span className="text-[9px] text-loss font-mono">n/a</span>}
        <span className={cn('text-[10px] font-mono tabular-nums', mon.captain && cost !== tier ? 'text-pink-400 font-bold' : 'text-text-muted')}>{cost}pt</span>
      </div>

      <Tooltip>
        <TooltipTrigger render={
          <button
            type="button" onClick={onCaptain} aria-pressed={mon.captain} aria-label={`Toggle tera captain: ${mon.name}`}
            className={cn(
              'shrink-0 size-7 rounded-md flex items-center justify-center border transition-colors',
              mon.captain
                ? elig.ok ? 'bg-pink-400/15 border-pink-400/50 text-pink-400' : 'bg-amber-400/15 border-amber-400/50 text-amber-400'
                : 'border-transparent text-text-muted hover:text-pink-400 hover:bg-surface-overlay',
            )}
          />
        }>
          <Sparkles size={14} />
        </TooltipTrigger>
        <TooltipContent side="top">
          {mon.captain ? 'Tera captain (click to remove)' : elig.ok ? 'Make tera captain' : `Make captain anyway - ${elig.reason}`}
        </TooltipContent>
      </Tooltip>

      {mon.captain && ruleset.teraEnabled && <TeraPicker name={mon.name} value={mon.teraTypes} max={ruleset.teraTypesPerCaptain} onChange={onTera} />}

      <button type="button" onClick={onToggleOpen} aria-expanded={expanded} aria-label={`Edit set: ${mon.name}`} title="Edit set"
        className="shrink-0 size-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay">
        <ChevronDown size={14} className={cn('transition-transform', expanded && 'rotate-180')} />
      </button>
      <button type="button" onClick={onRemove} aria-label={`Remove ${mon.name}`} title="Remove"
        className="shrink-0 size-7 rounded-md flex items-center justify-center text-text-muted opacity-60 hover:opacity-100 hover:text-loss hover:bg-surface-overlay">
        <X size={14} />
      </button>
      </div>
    </div>
  );
}

/** Up to `max` tera types for a captain, picked from a popover grid of all 18. */
function TeraPicker({ name, value, max, onChange }: { name: string; value: PokemonType[]; max: number; onChange: (t: PokemonType[]) => void }) {
  const toggle = (t: PokemonType) => onChange(value.includes(t) ? value.filter(x => x !== t) : [...value, t].slice(0, max));
  return (
    <Popover>
      <PopoverTrigger render={
        <button type="button" aria-label={`Pick tera types: ${name}`} title="Pick tera types"
          className="shrink-0 h-7 min-w-7 px-1.5 rounded-md border border-pink-400/30 flex items-center justify-center gap-0.5 hover:bg-pink-400/10 focus-visible:ring-2 focus-visible:ring-pink-400/60 outline-none" />
      }>
        {value.length === 0 && <span className="text-[10px] font-mono text-pink-400">tera?</span>}
        {value.map(t => <span key={t} className="size-3 rounded-full ring-1 ring-white/20" style={{ backgroundColor: TYPE_COLORS[t] }} />)}
        {Array.from({ length: Math.max(0, max - value.length) }, (_, i) => value.length > 0 && (
          <span key={i} className="size-3 rounded-full border border-dashed border-text-muted/50" />
        ))}
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <div className="text-[10px] font-mono uppercase text-text-muted">Tera types ({value.length}/{max})</div>
        <div className="grid grid-cols-3 gap-1">
          {POKEMON_TYPES.map(t => {
            const on = value.includes(t);
            const blocked = !on && value.length >= max;
            return (
              <button
                key={t} type="button" disabled={blocked} onClick={() => toggle(t)}
                className={cn(
                  'h-6 rounded-full text-[9px] font-bold uppercase text-white transition-all',
                  on ? 'ring-2 ring-pink-400 scale-105' : 'opacity-70 hover:opacity-100',
                  blocked && 'opacity-25 cursor-not-allowed',
                )}
                style={{ backgroundColor: TYPE_COLORS[t] }}
              >
                {TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
