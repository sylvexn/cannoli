import { POKEMON_TYPES } from '@/lib/pokemon';
import { cn } from '@/lib/utils';
import { TYPE_COLORS } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { X, SlidersHorizontal, ChevronDown, Wallet } from 'lucide-react';
import type { DraftFilters } from './types';
import type { DraftFormat } from '@/data/pokemon-learnsets';
import { DraftSearch } from './draft-search';


interface DraftFilterBarProps {
  filters: DraftFilters;
  onUpdate: (filters: Partial<DraftFilters>) => void;
  totalCount: number;
  filteredCount: number;
  format: DraftFormat;
  /** Show the "fits my budget" affordability toggle. Hidden outside an active draft. */
  showAffordableToggle?: boolean;
  /** Highest tier the user can afford right now — drives the toggle's hover hint. */
  affordCap?: number;
}

export function DraftFilterBar({
  filters, onUpdate, totalCount, filteredCount, format,
  showAffordableToggle, affordCap,
}: DraftFilterBarProps) {
  const hasActiveFilters = filters.search || filters.searchChips.length > 0 || filters.types.length > 0 || filters.ownership !== 'all' || filters.tierMin !== 1 || filters.tierMax !== 20 || filters.affordableOnly;
  const typesActive = filters.types.length > 0;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Unified search */}
      <DraftSearch
        search={filters.search}
        chips={filters.searchChips}
        format={format}
        onUpdate={onUpdate}
      />

      {/* Tier range */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase text-text-muted font-medium">Tier</span>
        <NumberInput
          value={filters.tierMin}
          onChange={v => onUpdate({ tierMin: Math.min(v, filters.tierMax) })}
          min={1}
          max={20}
          className="w-[60px] h-8 text-xs"
        />
        <span className="text-text-muted text-xs">–</span>
        <NumberInput
          value={filters.tierMax}
          onChange={v => onUpdate({ tierMax: Math.max(v, filters.tierMin) })}
          min={1}
          max={20}
          className="w-[60px] h-8 text-xs"
        />
      </div>

      {/* Type filter — collapsed pill that expands into a popover */}
      <TypeFilterPill filters={filters} onUpdate={onUpdate} typesActive={typesActive} />

      {/* Affordability toggle — only relevant during an active draft. */}
      {showAffordableToggle && (
        <button
          type="button"
          onClick={() => onUpdate({ affordableOnly: !filters.affordableOnly })}
          aria-pressed={filters.affordableOnly}
          title={
            affordCap != null
              ? `Show only Pokemon ≤ ${affordCap}pt (your effective budget after reserving for remaining picks)`
              : 'Show only Pokemon you can afford right now'
          }
          className={cn(
            'h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md border text-xs transition-colors',
            filters.affordableOnly
              ? 'border-neon/40 bg-neon/10 text-neon shadow-[0_0_10px_rgba(34,211,238,0.20)]'
              : 'border-border-default bg-surface-raised text-text-muted hover:text-text-secondary',
          )}
        >
          <Wallet size={12} aria-hidden />
          <span className="font-medium">Fits</span>
          {affordCap != null && (
            <span className="text-[10px] font-mono tabular-nums text-text-muted/70">
              ≤{affordCap}pt
            </span>
          )}
        </button>
      )}

      {/* Ownership filter */}
      <Select
        value={filters.ownership}
        onValueChange={v => onUpdate({ ownership: v as DraftFilters['ownership'] })}
      >
        <SelectTrigger className="h-8 w-[110px] text-xs bg-surface-raised border-border-default">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">All</SelectItem>
          <SelectItem value="owned" className="text-xs">Owned</SelectItem>
          <SelectItem value="free-agent" className="text-xs">Free Agents</SelectItem>
        </SelectContent>
      </Select>

      {/* Sort */}
      <Select
        value={filters.sortBy}
        onValueChange={v => onUpdate({ sortBy: v as DraftFilters['sortBy'] })}
      >
        <SelectTrigger className="h-8 w-[130px] text-xs bg-surface-raised border-border-default">
          <SlidersHorizontal size={12} className="mr-1 text-text-muted" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tier-desc" className="text-xs">Tier (high → low)</SelectItem>
          <SelectItem value="tier-asc" className="text-xs">Tier (low → high)</SelectItem>
          <SelectItem value="name-asc" className="text-xs">Name (A → Z)</SelectItem>
          <SelectItem value="name-desc" className="text-xs">Name (Z → A)</SelectItem>
        </SelectContent>
      </Select>

      {/* Count + clear */}
      <div className="flex items-center gap-2 ml-auto">
        <span className="text-xs text-text-muted font-mono tabular-nums">
          {filteredCount === totalCount ? totalCount : `${filteredCount}/${totalCount}`}
        </span>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onUpdate({
              search: '', searchChips: [], tierMin: 1, tierMax: 20, types: [], typeMode: 'or', ownership: 'all',
              affordableOnly: false,
            })}
            className="h-7 text-xs text-text-muted hover:text-neon"
          >
            <X size={12} className="mr-1" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// Type-filter pill — collapsed by default, popover expands the chip grid

interface TypeFilterPillProps {
  filters: DraftFilters;
  onUpdate: (filters: Partial<DraftFilters>) => void;
  typesActive: boolean;
}

function TypeFilterPill({ filters, onUpdate, typesActive }: TypeFilterPillProps) {
  const dotsToShow = filters.types.slice(0, 4);
  const hiddenCount = filters.types.length - dotsToShow.length;

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md border text-xs transition-colors',
          typesActive
            ? 'border-neon/40 bg-neon/10 text-neon shadow-[0_0_10px_rgba(34,211,238,0.20)]'
            : 'border-border-default bg-surface-raised text-text-muted hover:text-text-secondary',
        )}
        aria-label={typesActive ? `Type filter: ${filters.types.join(', ')}` : 'Type filter'}
      >
        <span className="font-medium">Types</span>
        {typesActive ? (
          <span className="flex items-center gap-1">
            {dotsToShow.map(t => (
              <span
                key={t}
                className="w-2 h-2 rounded-full ring-1 ring-surface-raised"
                style={{ backgroundColor: TYPE_COLORS[t] }}
                aria-hidden
              />
            ))}
            {hiddenCount > 0 && (
              <span className="text-[10px] font-mono">+{hiddenCount}</span>
            )}
          </span>
        ) : (
          <span className="text-[10px] text-text-muted/70">All types</span>
        )}
        <ChevronDown size={11} className="text-text-muted" aria-hidden />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[280px] p-2.5"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-heading font-semibold uppercase tracking-wider text-text-muted">
            Types
          </span>
          {filters.types.length > 0 && (
            <button
              onClick={() => onUpdate({ types: [] })}
              className="text-[10px] text-text-muted hover:text-neon transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {POKEMON_TYPES.map(t => {
            const active = filters.types.includes(t);
            return (
              <button
                key={t}
                onClick={() => {
                  const types = active
                    ? filters.types.filter(x => x !== t)
                    : [...filters.types, t];
                  onUpdate({ types });
                }}
                aria-pressed={active}
                className={cn(
                  'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                  'border transition-all duration-150 cursor-pointer',
                  active
                    ? 'text-white border-transparent shadow-sm'
                    : 'text-text-muted border-border-subtle hover:border-border-default hover:text-text-secondary bg-surface-overlay/30',
                )}
                style={active ? {
                  backgroundColor: TYPE_COLORS[t],
                  borderColor: TYPE_COLORS[t],
                } : undefined}
              >
                {t.slice(0, 3)}
              </button>
            );
          })}
        </div>

        {filters.types.length >= 2 && (
          <div className="mt-2 pt-2 border-t border-border-subtle flex items-center gap-2">
            <span className="text-[10px] text-text-muted">Match</span>
            <button
              onClick={() => onUpdate({ typeMode: filters.typeMode === 'or' ? 'and' : 'or' })}
              className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors',
                filters.typeMode === 'and'
                  ? 'text-neon border-neon/30 bg-neon/10'
                  : 'text-text-muted border-border-subtle hover:text-text-secondary',
              )}
              aria-pressed={filters.typeMode === 'and'}
            >
              {filters.typeMode === 'and' ? 'Both' : 'Either'}
            </button>
            <span className="text-[10px] text-text-muted/70">
              {filters.typeMode === 'and' ? 'must have all selected' : 'any of the selected'}
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
