import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { pokemonRoute } from '@/lib/pokemon-route';
import type { RosterPokemon } from '@/lib/types';
import { DEFAULT_MOVE_CATEGORIES } from '@/data/move-categories';
import { getTeamMoveCoverage } from '@/lib/move-coverage';
import { AbilityChip } from '@/components/ability-chip';
import { api } from '@/lib/api';
import { ChevronDown } from 'lucide-react';

interface MovesTabProps {
  teamA: RosterPokemon[];
  teamB: RosterPokemon[];
}

export function MovesTab({ teamA, teamB }: MovesTabProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [apiCategories, setApiCategories] = useState(DEFAULT_MOVE_CATEGORIES);

  useEffect(() => {
    api.getMoveCategories().then(cats => {
      if (cats.length > 0) setApiCategories(cats);
    }).catch(() => {
      // Fall back to defaults silently
    });
  }, []);

  const coverage = useMemo(
    () => getTeamMoveCoverage(teamA, teamB, apiCategories),
    [teamA, teamB, apiCategories],
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
    <div className="border border-border-default rounded-lg w-full">
      {/* Sticky sprite header */}
      <div className="sticky top-0 z-10 flex items-center border-b border-border-default bg-surface-raised rounded-t-lg">
        <div className="w-40 shrink-0 px-3 py-2 text-[10px] text-text-muted font-medium">Move / Ability</div>
        {/* Team A sprites */}
        <div className="flex flex-1">
          {teamA.map((p, i) => (
            <div
              key={`a-${p.name}`}
              className={cn(
                'flex-1 flex justify-center py-1.5 bg-[#3b82f6]/5 min-w-[44px]',
                i < teamA.length - 1 && 'border-r border-[#3b82f6]/10',
              )}
            >
              <Link
                to={pokemonRoute(p.name)}
                title={p.name}
                className="hover:scale-110 transition-transform"
              >
                <PokemonSprite name={p.name} size="sm" />
              </Link>
            </div>
          ))}
          {/* Divider between teams */}
          <div className="w-px bg-border-default shrink-0" />
          {teamB.map((p, i) => (
            <div
              key={`b-${p.name}`}
              className={cn(
                'flex-1 flex justify-center py-1.5 bg-[#ef4444]/5 min-w-[44px]',
                i < teamB.length - 1 && 'border-r border-[#ef4444]/10',
              )}
            >
              <Link
                to={pokemonRoute(p.name)}
                title={p.name}
                className="hover:scale-110 transition-transform"
              >
                <PokemonSprite name={p.name} size="sm" />
              </Link>
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

            {!isCollapsed && entries.map(({ entry, teamA: matchesA, teamB: matchesB }, rowIdx) => (
              <div
                key={entry.moveId}
                className={cn(
                  'flex items-center border-b border-border-subtle/30',
                  rowIdx % 2 === 0 ? 'bg-transparent' : 'bg-surface-overlay/5',
                  'hover:bg-surface-overlay/15',
                )}
              >
                <div className="w-40 shrink-0 px-3 py-1">
                  {entry.isAbility ? (
                    <AbilityChip name={entry.name} />
                  ) : (
                    <span className="text-[11px] text-text-secondary" title={`Move: ${entry.name}`}>
                      {entry.name}
                    </span>
                  )}
                </div>
                {/* Team A + Team B indicators in a flex row */}
                <div className="flex flex-1">
                  {teamA.map((p, i) => {
                    const has = matchesA.includes(p.name);
                    return (
                      <div
                        key={`a-${p.name}`}
                        className={cn(
                          'flex-1 flex justify-center py-1 min-w-[44px]',
                          i < teamA.length - 1 && 'border-r border-border-subtle/15',
                        )}
                      >
                        {has && (
                          <div className="w-5 h-5 rounded-full bg-[#3b82f6] flex items-center justify-center">
                            <div className="w-3 h-3 rounded-full bg-[#60a5fa]" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Team divider */}
                  <div className="w-px bg-border-default/40 shrink-0" />
                  {teamB.map((p, i) => {
                    const has = matchesB.includes(p.name);
                    return (
                      <div
                        key={`b-${p.name}`}
                        className={cn(
                          'flex-1 flex justify-center py-1 min-w-[44px]',
                          i < teamB.length - 1 && 'border-r border-border-subtle/15',
                        )}
                      >
                        {has && (
                          <div className="w-5 h-5 rounded-full bg-[#ef4444] flex items-center justify-center">
                            <div className="w-3 h-3 rounded-full bg-[#f87171]" />
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
