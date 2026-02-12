import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TeamLogo } from '@/components/team-logo';
import { TierBadge } from '@/components/tier-badge';
import { PointCapBar } from '@/components/point-cap-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronRight, ChevronLeft, ArrowRightLeft, Zap } from 'lucide-react';
import type { Player } from '@/lib/types';
import type { Acquisition } from './types';

interface DraftTeamSidebarProps {
  /** Players in display order (draft order during draft, standings after) */
  teamOrder: Player[];
  teamRosters: Map<string, { name: string; tier: number; acquisition: Acquisition }[]>;
  teamPoints: Map<string, number>;
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string | null) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Current drafter's team ID (live mode only) */
  currentDrafterId?: string | null;
  /** Whether we're in live draft mode */
  isLiveMode?: boolean;
}

export function DraftTeamSidebar({
  teamOrder,
  teamRosters,
  teamPoints,
  selectedTeamId,
  onSelectTeam,
  collapsed,
  onToggleCollapse,
  currentDrafterId,
  isLiveMode,
}: DraftTeamSidebarProps) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 py-2 w-10 bg-surface-raised border-l border-border-default">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          className="h-6 w-6 p-0 text-text-muted hover:text-neon mb-2"
        >
          <ChevronLeft size={14} />
        </Button>
        {teamOrder.map(p => (
          <button
            key={p.id}
            onClick={() => onSelectTeam(p.id)}
            className={cn(
              'transition-all duration-150 relative',
              selectedTeamId === p.id && 'ring-1 ring-neon rounded-full',
              currentDrafterId === p.id && 'ring-1 ring-pink rounded-full animate-pulse',
            )}
          >
            <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="w-[300px] flex-shrink-0 bg-surface-raised border-l border-border-default flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <span className="text-xs font-heading font-semibold text-text-primary">
          {isLiveMode ? 'Draft Order' : 'Teams'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          className="h-6 w-6 p-0 text-text-muted hover:text-neon"
        >
          <ChevronRight size={14} />
        </Button>
      </div>

      {/* Team list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {teamOrder.map((p, orderIdx) => {
            const roster = teamRosters.get(p.id) ?? [];
            const points = teamPoints.get(p.id) ?? 0;
            const isSelected = selectedTeamId === p.id;
            const isDrafter = currentDrafterId === p.id;

            return (
              <div
                key={p.id}
                className={cn(
                  'rounded-md border transition-all duration-150 overflow-hidden',
                  isDrafter
                    ? 'border-pink/50 bg-pink/5'
                    : isSelected
                    ? 'border-border-default bg-surface-overlay/40'
                    : 'border-transparent hover:border-border-subtle hover:bg-surface-overlay/20',
                )}
              >
                {/* Team header */}
                <button
                  onClick={() => onSelectTeam(p.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 cursor-pointer"
                >
                  {/* Draft position number */}
                  {isLiveMode && (
                    <span className="text-[10px] font-mono tabular-nums text-text-muted w-3 shrink-0">
                      {orderIdx + 1}
                    </span>
                  )}
                  <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-text-primary truncate">{p.teamAbbrev}</span>
                      {isDrafter && (
                        <Badge className="bg-pink/20 text-pink border-pink/30 text-[8px] px-1 py-0 h-3.5">
                          <Zap size={8} className="mr-0.5" />
                          OTC
                        </Badge>
                      )}
                    </div>
                    <span className="text-[9px] text-text-muted">{p.name}</span>
                  </div>
                  <span className="text-[10px] font-mono tabular-nums text-text-muted">
                    {points}/110
                  </span>
                </button>

                {/* Expanded roster / pick history */}
                {isSelected && (
                  <div className="px-2 pb-2 space-y-1">
                    <PointCapBar used={points} className="mb-1.5" />
                    {roster.map((mon, pickIdx) => (
                      <div
                        key={mon.name}
                        className="flex items-center gap-1.5 py-0.5 group/row hover:bg-surface-overlay/40 rounded px-1 -mx-1"
                      >
                        {/* Pick number */}
                        <span className="text-[9px] font-mono tabular-nums text-text-muted/50 w-3 shrink-0 text-right">
                          {pickIdx + 1}
                        </span>
                        <PokemonSprite name={mon.name} size="xs" />
                        <span className="text-[11px] text-text-primary flex-1 min-w-0 truncate">
                          {mon.name}
                        </span>
                        {mon.acquisition.method === 'traded' && (
                          <ArrowRightLeft size={10} className="text-pink flex-shrink-0" />
                        )}
                        <TierBadge points={mon.tier} />
                      </div>
                    ))}
                    {roster.length === 0 && (
                      <div className="text-[10px] text-text-muted py-1 text-center">No picks yet</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
