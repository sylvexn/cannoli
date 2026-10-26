import { useDeferredValue, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { getPokemonData } from '@/data/pokemon-data';
import { matchRawQuery } from '@/lib/pool-search';
import { poolFor } from '@/lib/draft-center/roster';
import type { Ruleset } from '@/lib/draft-center/ruleset';
import { isAvailable, type AvailFilter, type OwnerMap } from '@/lib/draft-center/availability';
import { AvailBadge } from './avail-badge';

const MAX_RESULTS = 60;

/**
 * Pokemon picker. Searches the ruleset's pool by name, ability or learnable
 * move ("stealthrock" finds every setter). Stays open after a pick so a whole
 * team can be sketched in one go; banned mons are selectable but flagged.
 */
export function MonPicker({
  open, onOpenChange, ruleset, taken, remaining, onPick, owners = null, leagueId = null,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ruleset: Ruleset;
  taken: Set<string>;
  /** Points left in the budget (negative when over) — costlier picks get an amber cost. */
  remaining: number;
  onPick: (name: string) => void;
  /** League context: ownership map + id (null = none). */
  owners?: OwnerMap | null;
  leagueId?: string | null;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<AvailFilter>('all');
  const dq = useDeferredValue(q);
  const pool = useMemo(() => poolFor(ruleset.costFormat), [ruleset.costFormat]);

  const results = useMemo(() => {
    const query = dq.trim().toLowerCase();
    const out: { name: string; tier: number; banned: boolean; reason: string | null; rank: number }[] = [];
    for (const p of pool) {
      const abilities = getPokemonData(p.name)?.abilities ?? [];
      const m = matchRawQuery(p.name, query, ruleset.learnsetFormat, abilities);
      if (!m.matched) continue;
      if (owners && filter === 'available' && !isAvailable(owners, p.name)) continue;
      const rank = !query ? 0 : p.name.toLowerCase().startsWith(query) ? 0 : p.name.toLowerCase().includes(query) ? 1 : 2;
      out.push({ ...p, reason: m.reason ? m.reason.label : null, rank });
    }
    out.sort((a, b) => a.rank - b.rank || Number(a.banned) - Number(b.banned) || b.tier - a.tier || a.name.localeCompare(b.name));
    return out;
  }, [pool, dq, ruleset.learnsetFormat, owners, filter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Pokemon</DialogTitle>
          <DialogDescription>{ruleset.label} - search by name, ability or move.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Garchomp, Intimidate, Stealth Rock..." className="pl-8" />
          {owners && (
            <button type="button" onClick={() => setFilter(f => (f === 'all' ? 'available' : 'all'))} aria-pressed={filter === 'available'}
              className={cn('absolute right-1.5 top-1/2 -translate-y-1/2 h-6 rounded px-1.5 text-[10px] font-mono border', filter === 'available' ? 'border-neon/50 text-neon bg-neon/10' : 'border-border-default text-text-muted')}>
              {filter === 'available' ? 'Available only' : 'All'}
            </button>
          )}
        </div>
        <div className="max-h-[50dvh] overflow-y-auto -mx-1 px-1 flex flex-col gap-0.5">
          {results.slice(0, MAX_RESULTS).map(r => {
            const isTaken = taken.has(r.name);
            const data = getPokemonData(r.name);
            return (
              <div key={r.name} className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                disabled={isTaken}
                onClick={() => onPick(r.name)}
                className={cn(
                  'flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors min-w-0',
                  isTaken ? 'opacity-40 cursor-default' : 'hover:bg-surface-overlay',
                )}
              >
                <PokemonSprite name={r.name} size="sm" className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-mono">{r.name}</span>
                  {r.reason && <span className="block truncate text-[10px] text-neon">via {r.reason}</span>}
                </span>
                <TypeChip types={data?.types ?? []} size="xs" noTooltip />
                {r.banned ? (
                  <span className="text-[9px] font-mono uppercase text-loss w-10 text-center shrink-0">Banned</span>
                ) : (
                  <span className={cn('w-10 flex justify-center shrink-0', r.tier > remaining && 'opacity-60')} title={r.tier > remaining ? 'More than the points left' : undefined}>
                    <TierBadge points={r.tier} />
                  </span>
                )}
                {isTaken && <span className="text-[9px] font-mono text-text-muted shrink-0">on team</span>}
              </button>
              <AvailBadge owners={owners} leagueId={leagueId} name={r.name} />
              </div>
            );
          })}
          {results.length === 0 && <div className="py-8 text-center text-sm text-text-muted">No matches</div>}
          {results.length > MAX_RESULTS && (
            <div className="py-1.5 text-center text-[10px] text-text-muted">Showing {MAX_RESULTS} of {results.length} - keep typing to narrow</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
