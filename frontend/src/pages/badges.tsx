/**
 * Public badge catalog — every pin definition in the game, grouped by
 * category, with icon/name/description and whether it's auto-awarded by the
 * stat engine or hand-picked by staff. Previously there was no way for a
 * user to see what badges exist or how to earn them (the definitions
 * endpoint was staff-only) — this is the first-class answer to that, not a
 * debug page.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, AlertTriangle, RotateCw, Crown, Trophy, Zap,
  LayoutDashboard, Users, Sparkles, type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LoadingSprite } from '@/components/loading-sprite';
import { EmptyState } from '@/components/empty-state';
import { Pin } from '@/components/pin';
import { api, type ApiPinDefinition, type PinCategory } from '@/lib/api';
import { cn } from '@/lib/utils';

const CATEGORY_ORDER: PinCategory[] = ['career', 'season', 'week', 'draft', 'community', 'custom'];

const CATEGORY_META: Record<PinCategory, { label: string; icon: LucideIcon; tagline: string }> = {
  career: { label: 'Career', icon: Crown, tagline: 'Earned once, carried for good.' },
  season: { label: 'Season', icon: Trophy, tagline: 'Decided when a season wraps.' },
  week: { label: 'Weekly', icon: Zap, tagline: 'Earned in a single match or week.' },
  draft: { label: 'Draft Night', icon: LayoutDashboard, tagline: 'Won before the season even starts.' },
  community: { label: 'Community', icon: Users, tagline: 'Staff- and coach-picked.' },
  custom: { label: 'Special', icon: Sparkles, tagline: 'One-off awards.' },
};

export function BadgesPage() {
  const [defs, setDefs] = useState<ApiPinDefinition[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setError(false);
    api.getPublicPinDefinitions().then(setDefs).catch(() => setError(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!defs) return [];
    const q = search.trim().toLowerCase();
    if (!q) return defs;
    return defs.filter(d =>
      d.name.toLowerCase().includes(q) ||
      (d.description ?? '').toLowerCase().includes(q) ||
      d.id.includes(q),
    );
  }, [defs, search]);

  const grouped = useMemo(() => {
    const map = new Map<PinCategory, ApiPinDefinition[]>();
    for (const d of filtered) {
      const list = map.get(d.category) ?? [];
      list.push(d);
      map.set(d.category, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [filtered]);

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-8">
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-amber-400">Badge</span>{' '}
          <span className="text-text-primary">Catalog</span>
        </h1>
        <p className="text-xs text-text-muted mt-1 max-w-prose leading-relaxed">
          Every pin in Cannoli. Some are minted automatically by the stat engine at the
          end of a match, week, or season; others are hand-picked by staff. Hover any
          pin elsewhere in the app for the full award detail.
        </p>
      </div>

      <div className="relative max-w-xs">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search badges"
          className="pl-7 h-8 text-xs"
        />
      </div>

      {defs === null && !error ? (
        <LoadingSprite label="Loading badges" size="md" padding="lg" />
      ) : error ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="flex items-center gap-1.5 text-sm text-loss">
            <AlertTriangle size={14} />
            Couldn&apos;t load the badge catalog.
          </span>
          <Button variant="outline" size="sm" onClick={load}>
            <RotateCw size={11} />
            Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          variant="nothing-here"
          title="No badges match."
          spriteSize="md"
          padding="md"
        />
      ) : (
        <div className="space-y-6">
          {CATEGORY_ORDER.filter(cat => grouped.has(cat)).map(cat => (
            <CategorySection key={cat} category={cat} defs={grouped.get(cat)!} />
          ))}
        </div>
      )}
    </div>
  );
}

function CategorySection({ category, defs }: { category: PinCategory; defs: ApiPinDefinition[] }) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2.5 pb-1.5 border-b border-border-subtle flex-wrap">
        <h2 className="flex items-center gap-1.5 text-sm font-mono uppercase tracking-wide text-text-primary shrink-0">
          <Icon size={14} className="text-neon" />
          {meta.label}
        </h2>
        <span className="text-[11px] text-text-muted">{meta.tagline}</span>
        <span className="ml-auto text-[10px] font-mono text-text-muted tabular-nums shrink-0">
          {defs.length}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {defs.map(d => <BadgeCard key={d.id} def={d} />)}
      </div>
    </section>
  );
}

function BadgeCard({ def }: { def: ApiPinDefinition }) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-raised p-3 flex gap-3 items-start">
      <Pin def={def} size="lg" noTooltip className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13px] font-semibold" style={{ color: def.color }}>{def.name}</span>
          <span
            className={cn(
              'text-[8px] font-mono uppercase tracking-wider px-1 py-px rounded shrink-0',
              def.isAuto ? 'bg-cyan-400/15 text-cyan-400' : 'bg-amber-400/15 text-amber-400',
            )}
          >
            {def.isAuto ? 'Auto-awarded' : 'Hand-picked'}
          </span>
        </div>
        {def.description && (
          <p className="text-[11px] text-text-secondary leading-snug mt-0.5">{def.description}</p>
        )}
      </div>
    </div>
  );
}
