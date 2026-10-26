import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { AbilityChip } from '@/components/ability-chip';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { DEFAULT_MOVE_CATEGORIES, type MoveCategory } from '@/data/move-categories';
import { getMoveColor } from '@/data/move-type-map';
import { getTeamMoveCoverage } from '@/lib/move-coverage';
import { pokemonRoute } from '@/lib/pokemon-route';
import { teamToRoster } from '@/lib/draft-center/roster';
import { monHasEntry } from '@/lib/draft-center/compare';
import type { Ruleset } from '@/lib/draft-center/ruleset';
import type { DcMon } from '@/lib/draft-center/types';

type Mode = 'set' | 'learn';

// The admin-managed category list is fetched once per page load.
let categoriesCache: Promise<MoveCategory[]> | null = null;
export const loadCategories = () => (categoriesCache ??= api.getMoveCategories()
  .then(c => (c.length > 0 ? c : DEFAULT_MOVE_CATEGORIES))
  .catch(() => DEFAULT_MOVE_CATEGORIES));

/**
 * Move-role checklist: for each role (hazards, removal, priority, ...) which
 * team members cover it. "Set moves" counts only the 4 moves actually chosen on
 * each set; "Can learn" counts anything in the mon's learnset (and any of its
 * possible abilities), which is what you want while still building.
 */
export function RolesPanel({ roster, ruleset }: { roster: DcMon[]; ruleset: Ruleset }) {
  const [cats, setCats] = useState<MoveCategory[]>(DEFAULT_MOVE_CATEGORIES);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const anySetMoves = roster.some(m => (m.set?.moves.length ?? 0) > 0);
  const [override, setOverride] = useState<Mode | null>(null);
  const mode: Mode = override ?? (anySetMoves ? 'set' : 'learn');

  useEffect(() => { let c = false; loadCategories().then(x => { if (!c) setCats(x); }); return () => { c = true; }; }, []);

  const coverage = useMemo(
    () => getTeamMoveCoverage(teamToRoster(roster, ruleset), [], cats, ruleset.learnsetFormat),
    [roster, ruleset, cats],
  );

  const byName = useMemo(() => new Map(roster.map(m => [m.name, m])), [roster]);

  if (roster.length === 0) {
    return <div className="rounded-lg border border-dashed border-border-default p-8 text-center text-sm text-text-muted">Add Pokemon to see role coverage.</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-md border border-border-subtle overflow-hidden text-[11px] font-mono">
          {(['set', 'learn'] as const).map(m => (
            <button
              key={m} type="button" onClick={() => setOverride(m)}
              className={cn('px-2.5 py-1 transition-colors', mode === m ? 'bg-neon/15 text-neon font-semibold' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay/50')}
            >
              {m === 'set' ? 'Set moves' : 'Can learn'}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-text-muted">
          {mode === 'set' ? 'Only moves picked on each set count.' : 'Solid = on the set, faded = in the learnset.'}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
        {coverage.map(({ category, entries }) => {
          const rows = entries.map(({ entry, teamA }) => {
            const members = teamA.map(n => byName.get(n)).filter((m): m is DcMon => !!m);
            const has = members.filter(m => monHasEntry(m, entry));
            const shown = mode === 'set' ? has : members;
            return { entry, shown, has };
          });
          const covered = rows.filter(r => r.shown.length > 0).length;
          const isCollapsed = collapsed.has(category.id);
          return (
            <div key={category.id} className="rounded-lg border border-border-default overflow-hidden">
              <button
                type="button"
                onClick={() => setCollapsed(prev => { const n = new Set(prev); if (!n.delete(category.id)) n.add(category.id); return n; })}
                className="w-full flex items-center gap-2 px-3 py-1.5 bg-surface-overlay/40 hover:bg-surface-overlay/60 transition-colors text-left"
              >
                <ChevronDown size={12} className={cn('text-text-muted transition-transform', isCollapsed && '-rotate-90')} />
                <span className="text-xs font-semibold text-text-primary">{category.name}</span>
                <span className={cn('ml-auto text-[10px] font-mono tabular-nums', covered === 0 ? 'text-loss' : 'text-win')}>
                  {covered}/{entries.length}
                </span>
              </button>
              {!isCollapsed && rows.map(({ entry, shown, has }) => {
                const color = getMoveColor(entry.name);
                return (
                  <div key={entry.moveId} className={cn('flex items-center gap-2 px-3 py-[3px] border-t border-border-subtle min-h-7', shown.length === 0 && 'opacity-50')}>
                    <div className="w-36 shrink-0 min-w-0 truncate">
                      {entry.isAbility ? <AbilityChip name={entry.name} /> : (
                        <span className="text-[11px] font-medium" style={color ? { color } : undefined}>{entry.name}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-0.5 min-w-0">
                      {shown.map(m => (
                        <Tooltip key={m.name}>
                          <TooltipTrigger render={
                            <Link to={pokemonRoute(m.name)} className={cn('rounded hover:bg-surface-overlay', !has.includes(m) && 'opacity-40')} />
                          }>
                            <PokemonSprite name={m.name} size="xs" />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {m.name}{has.includes(m) ? ' (on set)' : ' (can learn)'}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
