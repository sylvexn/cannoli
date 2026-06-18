import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, Search, X, ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react';
import { STATUS_CONFIG } from './match-status-badges';
import type { League } from '@/lib/types';

export type PhaseFilter = 'all' | 'regular' | 'playoffs';

export interface MatchFilters {
  leagueFilter: string;
  statusFilter: string;
  phaseFilter: PhaseFilter;
  weekFilter: string;
  teamSearch: string;
  attentionOnly: boolean;
}

interface MatchFilterBarProps {
  filters: MatchFilters;
  leagues: League[];
  /** Distinct weeks present in the current league-filtered data, ascending. */
  weeks: number[];
  /** Whether any non-league filter is active (drives the Clear button). */
  isFiltered: boolean;
  onLeagueChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onPhaseChange: (v: PhaseFilter) => void;
  onWeekChange: (v: string) => void;
  onTeamSearchChange: (v: string) => void;
  onAttentionToggle: () => void;
  onClear: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

export function MatchFilterBar({
  filters,
  leagues,
  weeks,
  isFiltered,
  onLeagueChange,
  onStatusChange,
  onPhaseChange,
  onWeekChange,
  onTeamSearchChange,
  onAttentionToggle,
  onClear,
  onExpandAll,
  onCollapseAll,
}: MatchFilterBarProps) {
  const { leagueFilter, statusFilter, phaseFilter, weekFilter, teamSearch, attentionOnly } = filters;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={leagueFilter} onValueChange={(v) => onLeagueChange(v ?? 'all')}>
        <SelectTrigger className="w-[160px] h-8 text-xs bg-surface-overlay">
          <SelectValue placeholder="All Leagues" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">All Leagues</SelectItem>
          {leagues.map(l => (
            <SelectItem key={l.id} value={l.id} className="text-xs">
              <span className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
                {l.name.replace(' League', '')}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={statusFilter} onValueChange={(v) => onStatusChange(v ?? 'all')}>
        <SelectTrigger className="w-[130px] h-8 text-xs bg-surface-overlay">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <SelectItem key={key} value={key} className="text-xs">{cfg.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={phaseFilter} onValueChange={(v) => onPhaseChange((v as PhaseFilter) ?? 'all')}>
        <SelectTrigger className="w-[120px] h-8 text-xs bg-surface-overlay">
          <SelectValue placeholder="All Phases" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">All Phases</SelectItem>
          <SelectItem value="regular" className="text-xs">Regular</SelectItem>
          <SelectItem value="playoffs" className="text-xs">Playoffs</SelectItem>
        </SelectContent>
      </Select>

      <Select value={weekFilter} onValueChange={(v) => onWeekChange(v ?? 'all')}>
        <SelectTrigger className="w-[110px] h-8 text-xs bg-surface-overlay">
          <SelectValue placeholder="All Weeks" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">All Weeks</SelectItem>
          {weeks.map(w => (
            <SelectItem key={w} value={String(w)} className="text-xs">Week {w}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        <Input
          value={teamSearch}
          onChange={e => onTeamSearchChange(e.target.value)}
          placeholder="Search team..."
          className="w-[200px] h-8 text-xs bg-surface-overlay pl-7"
        />
      </div>

      <Button
        size="xs"
        variant="outline"
        aria-pressed={attentionOnly}
        onClick={onAttentionToggle}
        className={cn(
          'h-8 text-[10px] gap-1.5',
          attentionOnly
            ? 'text-loss border-loss/40 bg-loss/10 hover:bg-loss/15'
            : 'text-text-muted',
        )}
      >
        <AlertTriangle size={12} />
        Needs attention
      </Button>

      {isFiltered && (
        <Button
          size="xs"
          variant="ghost"
          onClick={onClear}
          className="h-8 text-[10px] gap-1 text-text-muted hover:text-text-primary"
        >
          <X size={12} />
          Clear filters
        </Button>
      )}

      <div className="flex-1" />

      <Button
        size="xs"
        variant="ghost"
        onClick={onExpandAll}
        className="h-8 text-[10px] gap-1 text-text-muted hover:text-text-primary"
      >
        <ChevronsUpDown size={12} />
        Expand all
      </Button>
      <Button
        size="xs"
        variant="ghost"
        onClick={onCollapseAll}
        className="h-8 text-[10px] gap-1 text-text-muted hover:text-text-primary"
      >
        <ChevronsDownUp size={12} />
        Collapse all
      </Button>
    </div>
  );
}
