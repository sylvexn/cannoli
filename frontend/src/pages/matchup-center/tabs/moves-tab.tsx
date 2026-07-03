import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { pokemonRoute } from '@/lib/pokemon-route';
import type { RosterPokemon } from '@/lib/types';
import { DEFAULT_MOVE_CATEGORIES } from '@/data/move-categories';
import { getMoveColor } from '@/data/move-type-map';
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

  // Column widths: move label 160px, each pokemon ~40px min
  const colW = 'min-w-[38px] max-w-[56px] flex-1';

  return (
    // Own scroll box (both axes) so the sprite header can truly stick on
    // vertical scroll and the label column can stick on horizontal scroll —
    // previously the sprites scrolled out of view (feedback #43).
    <div className="border border-border-default rounded-lg w-full overflow-auto max-h-[70vh]">
      {/* ── Sticky sprite header ───────────────────────────── */}
      <div className="sticky top-0 z-20 flex items-center border-b border-border-default bg-surface-raised rounded-t-lg min-w-max">
        {/* Label column — frozen top-left corner, above both sticky axes */}
        <div className="w-40 shrink-0 px-3 py-2 text-[10px] text-text-muted font-medium uppercase tracking-wider sticky left-0 z-30 bg-surface-raised">
          Move / Ability
        </div>

        {/* Team A sprites */}
        <div className="flex">
          {teamA.map((p, i) => (
            <div
              key={`a-${p.name}`}
              className={cn(
                colW,
                'flex justify-center py-1.5 bg-[#3b82f6]/5',
                i < teamA.length - 1 && 'border-r border-[#3b82f6]/10',
              )}
            >
              <Link
                to={pokemonRoute(p.name)}
                title={p.nickname ? `${p.name} — "${p.nickname}"` : p.name}
                className="hover:scale-110 transition-transform"
              >
                <PokemonSprite name={p.name} size="sm" shiny={p.isShiny} />
              </Link>
            </div>
          ))}
        </div>

        {/* Divider between teams */}
        <div className="w-px bg-border-default shrink-0 self-stretch" />

        {/* Team B sprites */}
        <div className="flex">
          {teamB.map((p, i) => (
            <div
              key={`b-${p.name}`}
              className={cn(
                colW,
                'flex justify-center py-1.5 bg-[#ef4444]/5',
                i < teamB.length - 1 && 'border-r border-[#ef4444]/10',
              )}
            >
              <Link
                to={pokemonRoute(p.name)}
                title={p.nickname ? `${p.name} — "${p.nickname}"` : p.name}
                className="hover:scale-110 transition-transform"
              >
                <PokemonSprite name={p.name} size="sm" shiny={p.isShiny} />
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* ── Categories ────────────────────────────────────── */}
      {coverage.map(({ category, entries }) => {
        const isCollapsed = collapsed.has(category.id);
        const aCount = entries.filter(e => e.teamA.length > 0).length;
        const bCount = entries.filter(e => e.teamB.length > 0).length;

        return (
          <div key={category.id}>
            {/* Category header row */}
            <button
              onClick={() => toggleCategory(category.id)}
              className="w-full min-w-max flex items-center px-3 py-1.5 bg-surface-overlay/40 hover:bg-surface-overlay/60 transition-colors text-left border-b border-border-subtle/50"
            >
              {/* Keep the category label + counts pinned left on horizontal scroll */}
              <span className="sticky left-3 z-10 flex items-center gap-2">
                <ChevronDown
                  size={12}
                  className={cn(
                    'text-text-muted transition-transform shrink-0',
                    isCollapsed && '-rotate-90',
                  )}
                />
                <span className="text-xs font-semibold text-text-primary w-32 shrink-0">
                  {category.name}
                </span>
                <span className="text-[10px] text-[#3b82f6] font-mono tabular-nums">
                  {aCount}/{entries.length}
                </span>
                <span className="mx-1 text-text-muted text-[10px]">·</span>
                <span className="text-[10px] text-[#ef4444] font-mono tabular-nums">
                  {bCount}/{entries.length}
                </span>
              </span>
            </button>

            {/* Entry rows */}
            {!isCollapsed && entries.map(({ entry, teamA: matchesA, teamB: matchesB }, rowIdx) => {
              const typeColor = getMoveColor(entry.name);
              return (
                <div
                  key={entry.moveId}
                  className={cn(
                    'flex items-center border-b border-border-subtle/20 min-w-max',
                    rowIdx % 2 === 0 ? 'bg-transparent' : 'bg-surface-overlay/[0.04]',
                    'hover:bg-surface-overlay/10 transition-colors',
                  )}
                >
                  {/* Move / Ability name — frozen left column on horizontal scroll */}
                  <div className="w-40 shrink-0 px-3 py-[5px] sticky left-0 z-10 bg-surface-raised">
                    {entry.isAbility ? (
                      <AbilityChip name={entry.name} />
                    ) : (
                      <span
                        className="text-[11px] font-medium leading-tight"
                        title={`Move: ${entry.name}`}
                        style={typeColor ? { color: typeColor } : undefined}
                      >
                        {!typeColor && (
                          <span className="text-text-secondary">{entry.name}</span>
                        )}
                        {typeColor && entry.name}
                      </span>
                    )}
                  </div>

                  {/* Team A indicators */}
                  <div className="flex">
                    {teamA.map((p, i) => {
                      const has = matchesA.includes(p.name);
                      return (
                        <div
                          key={`a-${p.name}`}
                          className={cn(
                            colW,
                            'flex justify-center items-center py-[5px]',
                            i < teamA.length - 1 && 'border-r border-border-subtle/10',
                            has && 'bg-[#3b82f6]/[0.07]',
                          )}
                        >
                          {has ? (
                            <span
                              className="inline-block w-2 h-2 rounded-full bg-[#3b82f6] shadow-[0_0_4px_#3b82f6]"
                              title={`${p.name} has ${entry.name}`}
                            />
                          ) : (
                            <span className="inline-block w-2 h-2 rounded-full bg-surface-overlay/20" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Team divider */}
                  <div className="w-px bg-border-default/40 shrink-0 self-stretch" />

                  {/* Team B indicators */}
                  <div className="flex">
                    {teamB.map((p, i) => {
                      const has = matchesB.includes(p.name);
                      return (
                        <div
                          key={`b-${p.name}`}
                          className={cn(
                            colW,
                            'flex justify-center items-center py-[5px]',
                            i < teamB.length - 1 && 'border-r border-border-subtle/10',
                            has && 'bg-[#ef4444]/[0.07]',
                          )}
                        >
                          {has ? (
                            <span
                              className="inline-block w-2 h-2 rounded-full bg-[#ef4444] shadow-[0_0_4px_#ef4444]"
                              title={`${p.name} has ${entry.name}`}
                            />
                          ) : (
                            <span className="inline-block w-2 h-2 rounded-full bg-surface-overlay/20" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
