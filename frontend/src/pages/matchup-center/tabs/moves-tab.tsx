import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import type { RosterPokemon } from '@/lib/types';
import { DEFAULT_MOVE_CATEGORIES } from '@/data/move-categories';
import { getTeamMoveCoverage } from '@/lib/move-coverage';
import { AbilityChip } from '@/components/ability-chip';
import { ChevronDown } from 'lucide-react';

interface MovesTabProps {
  teamA: RosterPokemon[];
  teamB: RosterPokemon[];
}

export function MovesTab({ teamA, teamB }: MovesTabProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const coverage = useMemo(
    () => getTeamMoveCoverage(teamA, teamB, DEFAULT_MOVE_CATEGORIES),
    [teamA, teamB],
  );

  function toggleCategory(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (teamA.length === 0 && teamB.length === 0) {
    return (
      <div className="rounded-lg border border-border-default p-8 text-center text-text-muted text-sm">
        Select teams to see move coverage
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-default overflow-hidden relative">
      {/* Sticky sprite header */}
      <div className="sticky top-0 z-10 flex items-center border-b border-border-default bg-surface-raised">
        <div className="w-36 shrink-0 px-3 py-2 text-[10px] text-text-muted font-medium">Move / Ability</div>
        {/* Team A sprites */}
        <div className="flex border-r border-border-default">
          {teamA.map(p => (
            <div key={`a-${p.name}`} className="w-11 flex justify-center py-1.5 bg-[#3b82f6]/5" title={p.name}>
              <PokemonSprite name={p.name} size="sm" />
            </div>
          ))}
        </div>
        {/* Team B sprites */}
        <div className="flex">
          {teamB.map(p => (
            <div key={`b-${p.name}`} className="w-11 flex justify-center py-1.5 bg-[#ef4444]/5" title={p.name}>
              <PokemonSprite name={p.name} size="sm" />
            </div>
          ))}
        </div>
      </div>

      {/* Categories */}
      {coverage.map(({ category, entries }) => {
        const isCollapsed = collapsed.has(category.id);
        const aCount = entries.filter(e => e.teamA.length > 0).length;
        const bCount = entries.filter(e => e.teamB.length > 0).length;

        return (
          <div key={category.id}>
            <button
              onClick={() => toggleCategory(category.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 bg-surface-overlay/40 hover:bg-surface-overlay/60 transition-colors text-left border-b border-border-subtle/50"
            >
              <ChevronDown
                size={12}
                className={cn(
                  'text-text-muted transition-transform shrink-0',
                  isCollapsed && '-rotate-90',
                )}
              />
              <span className="text-xs font-medium text-text-primary flex-1">{category.name}</span>
              <span className="text-[10px] text-[#3b82f6] font-mono">{aCount}/{entries.length}</span>
              <span className="text-[10px] text-[#ef4444] font-mono">{bCount}/{entries.length}</span>
            </button>

            {!isCollapsed && entries.map(({ entry, teamA: matchesA, teamB: matchesB }) => (
              <div
                key={entry.moveId}
                className="flex items-center border-b border-border-subtle/20 hover:bg-surface-overlay/10"
              >
                <div className="w-36 shrink-0 px-3 py-[3px]">
                  {entry.isAbility ? (
                    <AbilityChip name={entry.name} />
                  ) : (
                    <span className="text-[11px] text-text-secondary">{entry.name}</span>
                  )}
                </div>
                {/* Team A indicators */}
                <div className="flex border-r border-border-default/30">
                  {teamA.map(p => {
                    const has = matchesA.includes(p.name);
                    return (
                      <div key={`a-${p.name}`} className="w-11 flex justify-center py-[3px]">
                        {has && (
                          <div className="w-4 h-4 rounded-full bg-[#3b82f6] flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-[#60a5fa]" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Team B indicators */}
                <div className="flex">
                  {teamB.map(p => {
                    const has = matchesB.includes(p.name);
                    return (
                      <div key={`b-${p.name}`} className="w-11 flex justify-center py-[3px]">
                        {has && (
                          <div className="w-4 h-4 rounded-full bg-[#ef4444] flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-[#f87171]" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
