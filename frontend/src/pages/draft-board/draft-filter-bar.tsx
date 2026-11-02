import { POKEMON_TYPES } from '@/lib/pokemon';
import { cn } from '@/lib/utils';
import { TYPE_COLORS } from '@/lib/constants';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { X, SlidersHorizontal } from 'lucide-react';
import type { DraftFilters } from './types';
import type { DraftFormat } from '@/data/pokemon-learnsets';
import { DraftSearch } from './draft-search';

interface DraftFilterBarProps {
  filters: DraftFilters;
  onUpdate: (filters: Partial<DraftFilters>) => void;
  totalCount: number;
  filteredCount: number;
  format: DraftFormat;
  /** Show the "Affordable" chip. Hidden outside an active draft. */
  showAffordableToggle?: boolean;
  /** Highest tier the user can afford right now — drives the chip's hover hint. */
  affordCap?: number;
}

const RESET: Partial<DraftFilters> = {
  search: '', searchChips: [], tierMin: 1, tierMax: 20, types: [], typeMode: 'or',
  ownership: 'all', affordableOnly: false,
};

/** Compact pool filter row: search + All / Affordable / Free-only chips +
 *  a Filters popover (tier range, types, sort). */
export function DraftFilterBar({
  filters, onUpdate, totalCount, filteredCount, format, showAffordableToggle, affordCap,
}: DraftFilterBarProps) {
  const hasActive = !!filters.search || filters.searchChips.length > 0 || filters.types.length > 0
    || filters.ownership !== 'all' || filters.tierMin !== 1 || filters.tierMax !== 20 || filters.affordableOnly;
  const extra = (filters.types.length > 0 ? 1 : 0) + (filters.tierMin !== 1 || filters.tierMax !== 20 ? 1 : 0);
  const allActive = filters.ownership === 'all' && !filters.affordableOnly;

  return (
    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
      <DraftSearch search={filters.search} chips={filters.searchChips} format={format} onUpdate={onUpdate} />

      <Chip active={allActive} onClick={() => onUpdate({ ownership: 'all', affordableOnly: false })}>All</Chip>
      {showAffordableToggle && (
        <Chip
          active={filters.affordableOnly}
          onClick={() => onUpdate({ affordableOnly: !filters.affordableOnly })}
          title={affordCap != null ? `Only Pokemon up to ${affordCap}pt (after reserving for remaining picks)` : 'Only Pokemon you can afford'}
        >
          Affordable{affordCap != null && <span className="ml-1 text-[9px] text-text-muted">≤{affordCap}</span>}
        </Chip>
      )}
      <Chip
        active={filters.ownership === 'free-agent'}
        onClick={() => onUpdate({ ownership: filters.ownership === 'free-agent' ? 'all' : 'free-agent' })}
      >
        Free only
      </Chip>

      <Popover>
        <PopoverTrigger
          className={cn(
            'h-7 inline-flex items-center gap-1.5 px-2 rounded-md border text-[11px] transition-colors',
            extra > 0
              ? 'border-neon/40 bg-neon/10 text-neon'
              : 'border-border-default bg-surface-raised text-text-muted hover:text-text-secondary',
          )}
        >
          <SlidersHorizontal size={12} aria-hidden />
          Filters{extra > 0 && <span className="font-mono text-[10px]">{extra}</span>}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[300px] p-3 space-y-3">
          <Section label="Tier">
            <div className="flex items-center gap-1.5">
              <NumberInput value={filters.tierMin} min={1} max={20} className="w-[60px] h-7 text-xs"
                onChange={v => onUpdate({ tierMin: Math.min(v, filters.tierMax) })} />
              <span className="text-text-muted text-xs">–</span>
              <NumberInput value={filters.tierMax} min={1} max={20} className="w-[60px] h-7 text-xs"
                onChange={v => onUpdate({ tierMax: Math.max(v, filters.tierMin) })} />
            </div>
          </Section>

          <Section label="Types" action={filters.types.length > 0 ? { label: 'Clear', onClick: () => onUpdate({ types: [] }) } : undefined}>
            <div className="flex flex-wrap gap-1">
              {POKEMON_TYPES.map(t => {
                const active = filters.types.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => onUpdate({ types: active ? filters.types.filter(x => x !== t) : [...filters.types, t] })}
                    aria-pressed={active}
                    className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-colors cursor-pointer',
                      active ? 'text-white border-transparent' : 'text-text-muted border-border-subtle hover:text-text-secondary bg-surface-overlay/30',
                    )}
                    style={active ? { backgroundColor: TYPE_COLORS[t], borderColor: TYPE_COLORS[t] } : undefined}
                  >
                    {t.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            {filters.types.length >= 2 && (
              <button
                onClick={() => onUpdate({ typeMode: filters.typeMode === 'or' ? 'and' : 'or' })}
                aria-pressed={filters.typeMode === 'and'}
                className={cn(
                  'mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors',
                  filters.typeMode === 'and' ? 'text-neon border-neon/30 bg-neon/10' : 'text-text-muted border-border-subtle',
                )}
              >
                {filters.typeMode === 'and' ? 'Match all selected' : 'Match any selected'}
              </button>
            )}
          </Section>

          <Section label="Sort">
            <Select value={filters.sortBy} onValueChange={v => onUpdate({ sortBy: v as DraftFilters['sortBy'] })}>
              <SelectTrigger className="h-7 w-full text-xs bg-surface-raised border-border-default"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tier-desc" className="text-xs">Tier (high to low)</SelectItem>
                <SelectItem value="tier-asc" className="text-xs">Tier (low to high)</SelectItem>
                <SelectItem value="name-asc" className="text-xs">Name (A to Z)</SelectItem>
                <SelectItem value="name-desc" className="text-xs">Name (Z to A)</SelectItem>
              </SelectContent>
            </Select>
          </Section>

          <Section label="Ownership">
            <Select value={filters.ownership} onValueChange={v => onUpdate({ ownership: v as DraftFilters['ownership'] })}>
              <SelectTrigger className="h-7 w-full text-xs bg-surface-raised border-border-default"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All</SelectItem>
                <SelectItem value="owned" className="text-xs">Owned</SelectItem>
                <SelectItem value="free-agent" className="text-xs">Free agents</SelectItem>
              </SelectContent>
            </Select>
          </Section>
        </PopoverContent>
      </Popover>

      <div className="flex items-center gap-1.5 ml-auto">
        <span className="text-[11px] text-text-muted font-mono tabular-nums">
          {filteredCount === totalCount ? totalCount : `${filteredCount}/${totalCount}`}
        </span>
        {hasActive && (
          <button
            type="button"
            onClick={() => onUpdate(RESET)}
            className="h-6 px-1.5 inline-flex items-center gap-1 rounded text-[11px] text-text-muted hover:text-neon"
          >
            <X size={11} aria-hidden />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        'h-7 inline-flex items-center px-2.5 rounded-full border text-[11px] font-medium transition-colors',
        active
          ? 'border-neon/40 bg-neon/10 text-neon'
          : 'border-border-default bg-surface-raised text-text-muted hover:text-text-secondary',
      )}
    >
      {children}
    </button>
  );
}

function Section({ label, action, children }: {
  label: string; action?: { label: string; onClick: () => void }; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-heading font-semibold uppercase tracking-wider text-text-muted">{label}</span>
        {action && (
          <button onClick={action.onClick} className="text-[10px] text-text-muted hover:text-neon transition-colors">
            {action.label}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
