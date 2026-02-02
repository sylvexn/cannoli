import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import type { RosterPokemon } from '@/lib/types';
import { DEFAULT_MOVE_CATEGORIES } from '@/data/move-categories';
import { getTeamMoveCoverage } from '@/lib/move-coverage';
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
    <div className="space-y-2">
      {coverage.map(({ category, entries }) => {
        const isCollapsed = collapsed.has(category.id);
        // Count how many entries have at least one Pokemon
        const aCount = entries.filter(e => e.teamA.length > 0).length;
        const bCount = entries.filter(e => e.teamB.length > 0).length;

        return (
          <div key={category.id} className="rounded-lg border border-border-default overflow-hidden">
            {/* Category header */}
            <button
              onClick={() => toggleCategory(category.id)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-surface-raised hover:bg-surface-overlay/60 transition-colors text-left"
            >
              <ChevronDown
                size={14}
                className={cn(
                  'text-text-muted transition-transform',
                  isCollapsed && '-rotate-90',
                )}
              />
              <span className="text-sm font-medium text-text-primary flex-1">{category.name}</span>
              <div className="flex gap-3 text-[10px]">
                <span className="text-[#3b82f6]">{aCount}/{entries.length}</span>
                <span className="text-[#ef4444]">{bCount}/{entries.length}</span>
              </div>
            </button>

            {/* Category content */}
            {!isCollapsed && (
              <div>
                {/* Column headers: pokemon sprites */}
                <div className="flex items-center border-t border-border-subtle/50 bg-surface-raised/30">
                  <div className="w-36 shrink-0 px-3 py-1 text-[10px] text-text-muted">Move / Ability</div>
                  {/* Team A columns */}
                  {teamA.map(p => (
                    <div key={`a-${p.name}`} className="w-8 flex justify-center py-1" title={p.name}>
                      <PokemonSprite name={p.name} size="xs" />
                    </div>
                  ))}
                  {/* Separator */}
                  {teamA.length > 0 && teamB.length > 0 && (
                    <div className="w-px bg-border-default mx-1 self-stretch" />
                  )}
                  {/* Team B columns */}
                  {teamB.map(p => (
                    <div key={`b-${p.name}`} className="w-8 flex justify-center py-1" title={p.name}>
                      <PokemonSprite name={p.name} size="xs" />
                    </div>
                  ))}
                </div>

                {/* Entry rows */}
                {entries.map(({ entry, teamA: matchesA, teamB: matchesB }) => (
                  <div
                    key={entry.moveId}
                    className="flex items-center border-t border-border-subtle/30 hover:bg-surface-overlay/20"
                  >
                    <div className="w-36 shrink-0 px-3 py-1 flex items-center gap-1">
                      <span className={cn(
                        'text-xs',
                        entry.isAbility ? 'text-draw italic' : 'text-text-secondary',
                      )}>
                        {entry.name}
                      </span>
                      {entry.isAbility && (
                        <span className="text-[8px] text-draw/60 uppercase">abl</span>
                      )}
                    </div>
                    {/* Team A indicators */}
                    {teamA.map(p => {
                      const has = matchesA.includes(p.name);
                      return (
                        <div key={`a-${p.name}`} className="w-8 flex justify-center py-1">
                          {has && (
                            <div className="w-3 h-3 rounded-full bg-[#3b82f6]/80" />
                          )}
                        </div>
                      );
                    })}
                    {/* Separator */}
                    {teamA.length > 0 && teamB.length > 0 && (
                      <div className="w-px mx-1" />
                    )}
                    {/* Team B indicators */}
                    {teamB.map(p => {
                      const has = matchesB.includes(p.name);
                      return (
                        <div key={`b-${p.name}`} className="w-8 flex justify-center py-1">
                          {has && (
                            <div className="w-3 h-3 rounded-full bg-[#ef4444]/80" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
