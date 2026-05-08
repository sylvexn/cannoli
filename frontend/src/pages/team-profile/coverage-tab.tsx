import { useState, useEffect, useMemo } from 'react';
import type { RosterPokemon } from '@/lib/types';
import { DEFAULT_MOVE_CATEGORIES } from '@/data/move-categories';
import type { MoveCategory } from '@/data/move-categories';
import { getTeamMoveCoverage } from '@/lib/move-coverage';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CoverageTabProps {
  roster: RosterPokemon[];
}

/**
 * Per-team coverage view: for each move/ability category, show how many
 * roster mons can perform that role and which ones. Designed for the
 * team-profile right-column tab. Compact, info-dense.
 */
export function CoverageTab({ roster }: CoverageTabProps) {
  const [categories, setCategories] = useState<MoveCategory[]>(DEFAULT_MOVE_CATEGORIES);

  useEffect(() => {
    api.getMoveCategories().then(cats => {
      if (cats.length > 0) setCategories(cats);
    }).catch(() => {
      // Fall back to defaults silently
    });
  }, []);

  // Reuse matchup-center helper with team B empty
  const coverage = useMemo(
    () => getTeamMoveCoverage(roster, [], categories),
    [roster, categories],
  );

  return (
    <div className="p-3 flex-1 flex flex-col gap-3">
      {coverage.map(cat => {
        const totalCovered = cat.entries.filter(e => e.teamA.length > 0).length;
        const totalEntries = cat.entries.length;
        return (
          <div key={cat.category.id} className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider">
              <span className="text-text-secondary font-semibold">
                {cat.category.name}
              </span>
              <span className={cn(
                'tabular-nums',
                totalCovered === 0 ? 'text-loss/60'
                  : totalCovered >= totalEntries / 2 ? 'text-win'
                  : 'text-text-muted',
              )}>
                {totalCovered}/{totalEntries}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {cat.entries.map(e => {
                const covered = e.teamA.length > 0;
                return (
                  <Tooltip key={e.entry.moveId}>
                    <TooltipTrigger>
                      <span className={cn(
                        'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors cursor-default',
                        covered
                          ? 'text-text-secondary hover:bg-surface-overlay/40'
                          : 'text-text-muted/30',
                      )}>
                        <span className={covered ? '' : 'line-through'}>
                          {e.entry.name}
                        </span>
                        {covered && (
                          <span className="text-[9px] font-mono text-neon tabular-nums">
                            {e.teamA.length}
                          </span>
                        )}
                      </span>
                    </TooltipTrigger>
                    {covered && (
                      <TooltipContent side="left" className="bg-surface-raised border-border-default p-2">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
                          {e.entry.name}
                          {e.entry.isAbility && (
                            <span className="ml-1 text-[8px] text-pink">(ability)</span>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5">
                          {e.teamA.map(name => (
                            <div key={name} className="flex items-center gap-1.5">
                              <PokemonSprite name={name} size="xs" />
                              <span className="text-xs text-text-primary">{name}</span>
                            </div>
                          ))}
                        </div>
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-[9px] text-text-muted/50 mt-2 inline-flex items-center gap-1">
        <ChevronRight size={9} />
        Hover an entry to see which mons cover it.
      </p>
    </div>
  );
}
