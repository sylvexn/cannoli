import { POKEMON_TYPES } from '@/lib/pokemon';
import type { PokemonType } from '@/lib/pokemon';
import { cn } from '@/lib/utils';
import { TYPE_COLORS } from '@/lib/constants';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X } from 'lucide-react';
import { useLeagueData } from '@/lib/league-data-context';
import { TeamLogo } from '@/components/team-logo';


export interface StatsFilters {
  search: string;
  teamId: string | null;
  types: PokemonType[];
  tierMin: number;
  tierMax: number;
}

export const defaultFilters: StatsFilters = {
  search: '',
  teamId: null,
  types: [],
  tierMin: 1,
  tierMax: 20,
};

interface StatsFilterBarProps {
  filters: StatsFilters;
  onUpdate: (filters: Partial<StatsFilters>) => void;
  totalCount: number;
  filteredCount: number;
}

export function StatsFilterBar({ filters, onUpdate, totalCount, filteredCount }: StatsFilterBarProps) {
  const { players } = useLeagueData();
  const hasActiveFilters = filters.search || filters.teamId || filters.types.length > 0 || filters.tierMin !== 1 || filters.tierMax !== 20;

  return (
    <div className="space-y-2">
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

        {/* Team filter */}
        <Select
          value={filters.teamId ?? 'all'}
          onValueChange={v => onUpdate({ teamId: v === 'all' ? null : v })}
        >
          <SelectTrigger className="h-8 w-[160px] text-sm bg-surface-raised border-border-default">
            <SelectValue placeholder="All Teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Teams</SelectItem>
            {players.map(p => (
              <SelectItem key={p.id} value={p.id}>
                <span className="flex items-center gap-2">
                  <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" logoPath={p.logoPath} />
                  {p.teamAbbrev}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Tier range */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-muted uppercase">Tier</span>
          <Select value={String(filters.tierMin)} onValueChange={v => onUpdate({ tierMin: Number(v) })}>
            <SelectTrigger className="h-8 w-[60px] text-sm bg-surface-raised border-border-default">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 20 }, (_, i) => i + 1).map(t => (
                <SelectItem key={t} value={String(t)}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-text-muted text-xs">—</span>
          <Select value={String(filters.tierMax)} onValueChange={v => onUpdate({ tierMax: Number(v) })}>
            <SelectTrigger className="h-8 w-[60px] text-sm bg-surface-raised border-border-default">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 20 }, (_, i) => i + 1).map(t => (
                <SelectItem key={t} value={String(t)}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Count + clear */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-text-muted tabular-nums">
            {filteredCount}/{totalCount}
          </span>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onUpdate(defaultFilters)}
              className="h-7 px-2 text-xs text-text-muted hover:text-text-primary"
            >
              <X size={12} className="mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Type chips */}
      <div className="flex gap-1 flex-wrap">
        {POKEMON_TYPES.map(type => {
          const active = filters.types.includes(type);
          return (
            <button
              key={type}
              onClick={() => {
                const types = active
                  ? filters.types.filter(t => t !== type)
                  : [...filters.types, type];
                onUpdate({ types });
              }}
              className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide transition-all duration-150 border',
                active
                  ? 'text-white border-transparent shadow-sm'
                  : 'text-text-muted border-border-subtle hover:border-border-default hover:text-text-secondary',
              )}
              style={active ? { backgroundColor: TYPE_COLORS[type], borderColor: TYPE_COLORS[type] } : undefined}
            >
              {type.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
