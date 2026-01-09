import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TeamLogo } from '@/components/team-logo';
import { TierBadge } from '@/components/tier-badge';
import { PointCapBar } from '@/components/point-cap-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ChevronRight, ChevronLeft, ArrowRightLeft } from 'lucide-react';
import { players } from '@/mocks/players';
import type { Player } from '@/lib/types';
import type { Acquisition } from './types';

interface DraftTeamSidebarProps {
  teamRosters: Map<string, { name: string; tier: number; acquisition: Acquisition }[]>;
  teamPoints: Map<string, number>;
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string | null) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function DraftTeamSidebar({
  teamRosters,
  teamPoints,
  selectedTeamId,
  onSelectTeam,
  collapsed,
  onToggleCollapse,
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
        {players.map(p => (
          <button
            key={p.id}
            onClick={() => onSelectTeam(p.id)}
            className={cn(
              'transition-all duration-150',
              selectedTeamId === p.id && 'ring-1 ring-neon rounded-full',
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
        <span className="text-xs font-heading font-semibold text-text-primary">Teams</span>
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
          {players.map(p => {
            const roster = teamRosters.get(p.id) ?? [];
            const points = teamPoints.get(p.id) ?? 0;
            const isSelected = selectedTeamId === p.id;

            return (
              <div
                key={p.id}
                className={cn(
                  'rounded-md border transition-all duration-150 overflow-hidden',
                  isSelected
                    ? 'border-border-default bg-surface-overlay/40'
                    : 'border-transparent hover:border-border-subtle hover:bg-surface-overlay/20',
                )}
              >
                {/* Team header */}
                <button
                  onClick={() => onSelectTeam(p.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 cursor-pointer"
                >
                  <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-xs font-medium text-text-primary truncate">{p.teamAbbrev}</div>
                  </div>
                  <span className="text-[10px] font-mono tabular-nums text-text-muted">
                    {points}/110
                  </span>
                </button>

                {/* Expanded roster */}
                {isSelected && (
                  <div className="px-2 pb-2 space-y-1">
                    <PointCapBar used={points} className="mb-1.5" />
                    {roster.map(mon => (
                      <div
                        key={mon.name}
                        className="flex items-center gap-1.5 py-0.5 group/row hover:bg-surface-overlay/40 rounded px-1 -mx-1"
                      >
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
