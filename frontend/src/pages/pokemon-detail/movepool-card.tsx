import { useEffect, useMemo, useState } from 'react';
import { getLearnset, DEFAULT_FORMAT, type DraftFormat } from '@/data/pokemon-learnsets';
import { MOVE_NAMES } from '@/data/move-names';
import { DEFAULT_MOVE_CATEGORIES, type MoveCategory } from '@/data/move-categories';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollText, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Resolve a move ID to its display name (falls back to the raw ID). */
function moveLabel(moveId: string): string {
  return MOVE_NAMES[moveId] ?? moveId;
}

interface MovepoolCardProps {
  /** Tier-list display name of the Pokemon. */
  pokemonName: string;
  /** Learnset gen-source (gen9natdex/gen9ou/…). Distinct from the cannoli
   *  cost format (natdex/natdexplus). Defaults to NatDex — the widest pool. */
  learnsetFormat?: DraftFormat;
}

/**
 * Movepool scouting card for the Pokemon detail page.
 *
 * Two stacked views over the mon's learnset:
 *   1. "Notable moves" — the curated role categories (hazards, priority, setup,
 *      status, …) filtered to only the moves THIS mon learns, so a scout sees
 *      threats at a glance. Categories the mon can't access are hidden.
 *   2. "Full movepool" — the complete alphabetical list, searchable + collapsed
 *      by default since it's long.
 *
 * Reuses the same learnset map + curated categories that the matchup-center
 * coverage view consumes. Renders a muted note (not a crash) when the mon has
 * no learnset entry.
 */
export function MovepoolCard({ pokemonName, learnsetFormat = DEFAULT_FORMAT }: MovepoolCardProps) {
  const [categories, setCategories] = useState<MoveCategory[]>(DEFAULT_MOVE_CATEGORIES);
  const [query, setQuery] = useState('');
  const [fullOpen, setFullOpen] = useState(false);

  // Same admin-overridable category source as the coverage tab; fall back to
  // shipped defaults silently if the request fails.
  useEffect(() => {
    api.getMoveCategories()
      .then(cats => { if (cats.length > 0) setCategories(cats); })
      .catch(() => { /* keep defaults */ });
  }, []);

  const learnset = useMemo(
    () => getLearnset(pokemonName, learnsetFormat),
    [pokemonName, learnsetFormat],
  );

  // Curated role categories, each filtered to the moves this mon actually
  // learns. Ability-typed entries are skipped — this is a movepool, not an
  // ability list (abilities already render on the identity card).
  const notable = useMemo(() => {
    if (!learnset) return [];
    return categories
      .map(cat => ({
        category: cat,
        moves: cat.entries.filter(e => !e.isAbility && learnset.has(e.moveId)),
      }))
      .filter(group => group.moves.length > 0);
  }, [categories, learnset]);

  // Every move ID, sorted by display name, for the full list.
  const allMoves = useMemo(() => {
    if (!learnset) return [];
    return [...learnset]
      .map(id => ({ id, name: moveLabel(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [learnset]);

  const filteredMoves = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allMoves;
    return allMoves.filter(m => m.name.toLowerCase().includes(q));
  }, [allMoves, query]);

  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-heading font-semibold uppercase tracking-wider text-text-primary flex items-center gap-2">
          <ScrollText size={14} className="text-neon" />
          Movepool
          {learnset && (
            <span className="ml-auto text-[10px] font-mono text-text-muted normal-case tracking-normal">
              {allMoves.length} moves
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        {!learnset ? (
          <p className="text-xs text-text-muted">Movepool data unavailable for this Pokemon.</p>
        ) : (
          <>
            {/* Notable moves grouped by role category */}
            {notable.length > 0 ? (
              <div className="space-y-2.5">
                {notable.map(({ category, moves }) => (
                  <div key={category.id}>
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider mb-1">
                      <span className="text-text-secondary font-semibold">{category.name}</span>
                      <span className="text-neon tabular-nums">{moves.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {moves.map(m => (
                        <span
                          key={m.moveId}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-surface-overlay/50 text-text-secondary"
                        >
                          {m.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted">No notable role moves in its learnset.</p>
            )}

            {/* Full movepool — collapsible + searchable */}
            <div className="border-t border-border-subtle pt-2.5">
              <button
                onClick={() => setFullOpen(o => !o)}
                className="w-full flex items-center gap-2 text-left group"
              >
                <ChevronDown
                  size={12}
                  className={cn(
                    'text-text-muted transition-transform shrink-0',
                    !fullOpen && '-rotate-90',
                  )}
                />
                <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary font-semibold group-hover:text-text-primary transition-colors">
                  Full movepool
                </span>
                <span className="text-[10px] font-mono text-text-muted tabular-nums">
                  {allMoves.length}
                </span>
              </button>

              {fullOpen && (
                <div className="mt-2 space-y-2">
                  <div className="relative">
                    <Search
                      size={12}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                    />
                    <Input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Filter moves…"
                      className="h-7 pl-7 text-xs bg-surface-overlay/40"
                    />
                  </div>
                  {filteredMoves.length === 0 ? (
                    <p className="text-xs text-text-muted">No moves match "{query}".</p>
                  ) : (
                    <div className="flex flex-wrap gap-1 max-h-64 overflow-y-auto">
                      {filteredMoves.map(m => (
                        <span
                          key={m.id}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-surface-overlay/40 text-text-muted"
                        >
                          {m.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
