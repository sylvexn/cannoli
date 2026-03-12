import { POKEMON_TYPES } from '@/lib/pokemon';
import { cn } from '@/lib/utils';
import { TYPE_COLORS } from '@/lib/constants';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import type { DraftFilters } from './types';


interface DraftFilterBarProps {
  filters: DraftFilters;
  onUpdate: (filters: Partial<DraftFilters>) => void;
  totalCount: number;
  filteredCount: number;
}

export function DraftFilterBar({ filters, onUpdate, totalCount, filteredCount }: DraftFilterBarProps) {
  const hasActiveFilters = filters.search || filters.abilitySearch || filters.types.length > 0 || filters.ownership !== 'all' || filters.tierMin !== 1 || filters.tierMax !== 20;

  return (
    <div className="space-y-2">
      {/* Main controls row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" size={14} />
          <Input
            value={filters.search}
            onChange={e => onUpdate({ search: e.target.value })}
            placeholder="Search Pokemon..."
            className="pl-8 h-8 text-sm bg-surface-raised border-border-default"
          />
          {filters.search && (
            <button
              onClick={() => onUpdate({ search: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Ability search */}
        <div className="relative min-w-[140px] max-w-[180px]">
          <Input
            value={filters.abilitySearch}
            onChange={e => onUpdate({ abilitySearch: e.target.value })}
            placeholder="Ability..."
            className="h-8 text-sm bg-surface-raised border-border-default pl-2.5"
          />
          {filters.abilitySearch && (
            <button
              onClick={() => onUpdate({ abilitySearch: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X size={12} />
            </button>
          )}
        </div>

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
                search: '', abilitySearch: '', tierMin: 1, tierMax: 20, types: [], typeMode: 'or', ownership: 'all',
              })}
              className="h-7 text-xs text-text-muted hover:text-neon"
            >
              <X size={12} className="mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Type filter chips */}
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
        {filters.types.length >= 2 && (
          <button
            onClick={() => onUpdate({ typeMode: filters.typeMode === 'or' ? 'and' : 'or' })}
            className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors',
              filters.typeMode === 'and'
                ? 'text-neon border-neon/30 bg-neon/10'
                : 'text-text-muted border-border-subtle hover:text-text-secondary',
            )}
          >
            {filters.typeMode === 'and' ? 'Both' : 'Either'}
          </button>
        )}
        {filters.types.length > 0 && (
          <button
            onClick={() => onUpdate({ types: [] })}
            className="px-2 py-0.5 rounded-full text-[10px] text-text-muted hover:text-neon transition-colors"
          >
            clear types
          </button>
        )}
      </div>
    </div>
  );
}
