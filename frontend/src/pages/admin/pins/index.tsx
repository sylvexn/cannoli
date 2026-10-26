/**
 * Pins admin. Two views over one season selector:
 *   - Awards: the Awards Sheet (./awards-sheet) - curate, save drafts, publish.
 *   - Definitions: the catalog of pins (icon, scope, award inputs) with inline
 *     edit; "New Pin" opens the definition dialog.
 *
 * Nothing here awards automatically: the engine only suggests inside the sheet.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, RotateCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSprite } from '@/components/loading-sprite';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';
import { api, type ApiPinDefinition, type ApiSeasonPin } from '@/lib/api';
import { DefinitionCard } from './definition-card';
import { AwardsSheet } from './awards-sheet';
import { NewDefinitionDialog } from '../admin-pins';

interface SeasonRow { id: number; seasonNumber: number; archived: boolean }

type View = 'awards' | 'defs';

export function PinsTab() {
  const [defs, setDefs] = useState<ApiPinDefinition[]>([]);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [view, setView] = useState<View>('awards');
  const [sheetDef, setSheetDef] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [seasonPins, setSeasonPins] = useState<ApiSeasonPin[]>([]);
  // Bumped when the sheet saves/publishes so the definition counts refresh.
  const [rev, setRev] = useState(0);

  const loadBase = useCallback(() => {
    setLoading(true);
    setFailed(false);
    Promise.all([api.getPinDefinitions(), api.getSeasons()])
      .then(([d, s]) => {
        setDefs(d);
        const rows = s.map(x => ({ id: x.id, seasonNumber: x.seasonNumber, archived: !!x.archived }));
        setSeasons(rows);
        // Default to the newest season, once.
        setSeasonId(cur => cur ?? rows.reduce<SeasonRow | null>(
          (a, r) => (!a || r.seasonNumber > a.seasonNumber ? r : a), null)?.id ?? null);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadBase(); }, [loadBase]);

  useEffect(() => {
    if (seasonId == null) return;
    api.getSeasonPins(seasonId).then(r => setSeasonPins(r.pins)).catch(() => setSeasonPins([]));
  }, [seasonId, rev]);

  const season = seasons.find(s => s.id === seasonId) ?? null;
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of seasonPins) m[p.pinDefId] = (m[p.pinDefId] ?? 0) + 1;
    return m;
  }, [seasonPins]);

  const filteredDefs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return defs;
    return defs.filter(d => d.id.includes(q) || d.name.toLowerCase().includes(q) || d.category.includes(q));
  }, [defs, search]);

  if (loading) return <LoadingSprite size="md" padding="md" />;
  if (failed) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-loss/40 bg-loss/5 px-3 py-2 text-[11px] text-loss">
        <span className="flex items-center gap-1.5"><AlertTriangle size={12} />Couldn&apos;t load pins.</span>
        <Button variant="ghost" size="sm" className="h-6 text-[11px] text-loss hover:text-loss" onClick={loadBase}>
          <RotateCw size={10} />Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
          Season
          <select
            value={seasonId ?? ''}
            onChange={e => setSeasonId(e.target.value ? parseInt(e.target.value) : null)}
            className="h-7 rounded-md border border-border-default bg-surface-raised px-2 text-xs"
          >
            {seasons.slice().sort((a, b) => b.seasonNumber - a.seasonNumber).map(s => (
              <option key={s.id} value={s.id}>S{s.seasonNumber}{s.archived ? ' (archived)' : ''}</option>
            ))}
          </select>
        </label>

        <div className="inline-flex rounded-md border border-border-default p-0.5" role="tablist">
          {(['awards', 'defs'] as const).map(v => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition-colors',
                view === v ? 'bg-neon/15 text-text-primary' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {v === 'awards' ? 'Awards' : 'Definitions'}
            </button>
          ))}
        </div>

        {view === 'defs' && (
          <div className="relative min-w-[180px] max-w-xs flex-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pins" className="h-7 pl-7 text-xs" />
          </div>
        )}

        <Button size="sm" onClick={() => setCreating(true)} className="ml-auto h-7">
          <Plus size={12} />New Pin
        </Button>
      </div>

      {view === 'awards' ? (
        season ? (
          <AwardsSheet
            key={season.id}
            season={season}
            defs={defs}
            initialDefId={sheetDef}
            onChanged={() => setRev(r => r + 1)}
          />
        ) : (
          <EmptyState variant="nothing-here" title="No seasons yet." spriteSize="md" padding="sm" />
        )
      ) : filteredDefs.length === 0 ? (
        <EmptyState variant="nothing-here" title="No pins match." spriteSize="md" padding="sm" />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filteredDefs.map(def => (
            <DefinitionCard
              key={def.id}
              def={def}
              seasonAwardCount={counts[def.id] ?? 0}
              seasonLabel={season ? `S${season.seasonNumber}` : null}
              onOpenSheet={() => { setSheetDef(def.id); setView('awards'); }}
              onEdited={loadBase}
            />
          ))}
        </div>
      )}

      {creating && (
        <NewDefinitionDialog
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); loadBase(); }}
        />
      )}
    </div>
  );
}
