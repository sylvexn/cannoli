import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { PokemonSprite } from '@/components/pokemon-sprite';
import {
  Search, X, ChevronDown, Check,
} from 'lucide-react';
import { toast } from 'sonner';

type BanStatus = 'available' | 'tera-banned' | 'banned';

interface PoolEntry {
  name: string;
  baseTier: number;
  tier: number;
  status: BanStatus;
  modified: boolean;
}

const STATUS_CONFIG: Record<BanStatus, { label: string; color: string; bg: string; border: string; next: BanStatus }> = {
  available:     { label: 'Available',    color: 'text-win',  bg: 'bg-win/10',  border: 'border-win/30',  next: 'tera-banned' },
  'tera-banned': { label: 'Tera Banned',  color: 'text-draw', bg: 'bg-draw/10', border: 'border-draw/30', next: 'banned' },
  banned:        { label: 'Banned',       color: 'text-loss', bg: 'bg-loss/10', border: 'border-loss/30', next: 'available' },
};

export function AdminTierList() {
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getTierList()
      .then(entries => {
        setPool(entries.map(e => ({
          name: e.name,
          baseTier: e.tier,
          tier: e.tier,
          status: e.status,
          modified: false,
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(60);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editTierValue, setEditTierValue] = useState(0);

  const poolMap = useMemo(() => new Map(pool.map(e => [e.name, e])), [pool]);

  const filtered = useMemo(() => {
    let list = [...pool];

    if (tierFilter !== 'all') {
      list = list.filter(e => e.tier === Number(tierFilter));
    }
    if (statusFilter !== 'all') {
      list = list.filter(e => e.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q));
    }

    return list.sort((a, b) => {
      // Banned to bottom unless filtering by banned
      if (statusFilter === 'all') {
        if (a.status === 'banned' && b.status !== 'banned') return 1;
        if (a.status !== 'banned' && b.status === 'banned') return -1;
      }
      return b.tier - a.tier || a.name.localeCompare(b.name);
    });
  }, [pool, search, tierFilter, statusFilter]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  // Counts
  const counts = useMemo(() => {
    const c = { total: 0, available: 0, teraBanned: 0, banned: 0, modified: 0, tiers: {} as Record<number, number> };
    for (const e of pool) {
      c.total++;
      if (e.status === 'available') c.available++;
      else if (e.status === 'tera-banned') c.teraBanned++;
      else c.banned++;
      if (e.modified) c.modified++;
      if (e.status !== 'banned') {
        c.tiers[e.tier] = (c.tiers[e.tier] || 0) + 1;
      }
    }
    return c;
  }, [pool]);

  const cycleStatus = useCallback((name: string) => {
    setPool(prev => prev.map(e => {
      if (e.name !== name) return e;
      const next = STATUS_CONFIG[e.status].next;
      api.updateTierListEntry(name, { status: next }).catch(err => toast.error(err.message));
      toast.success(`${name}: ${STATUS_CONFIG[next].label}`);
      return { ...e, status: next, modified: true };
    }));
  }, []);

  const startEditTier = useCallback((name: string) => {
    const entry = poolMap.get(name);
    if (!entry) return;
    setEditingName(name);
    setEditTierValue(entry.tier);
  }, [poolMap]);

  const saveTier = useCallback(() => {
    if (!editingName) return;
    api.updateTierListEntry(editingName, { tier: editTierValue }).catch(err => toast.error(err.message));
    setPool(prev => prev.map(e => {
      if (e.name !== editingName) return e;
      return { ...e, tier: editTierValue, modified: editTierValue !== e.baseTier };
    }));
    toast.success(`${editingName} → Tier ${editTierValue}`);
    setEditingName(null);
  }, [editingName, editTierValue]);

  const cancelEdit = useCallback(() => setEditingName(null), []);

  const activeFilters = (tierFilter !== 'all' ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="flex flex-wrap gap-4 text-sm items-center">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Pool:</span>
          <span className="text-text-primary font-medium font-mono">{counts.available}</span>
        </div>
        <button
          onClick={() => setStatusFilter(statusFilter === 'tera-banned' ? 'all' : 'tera-banned')}
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <span className="text-text-muted">Tera Banned:</span>
          <span className="text-draw font-medium font-mono">{counts.teraBanned}</span>
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === 'banned' ? 'all' : 'banned')}
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <span className="text-text-muted">Banned:</span>
          <span className="text-loss font-medium font-mono">{counts.banned}</span>
        </button>
        {counts.modified > 0 && (
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-pink font-medium font-mono">{counts.modified} unsaved changes</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setVisibleCount(60); }}
            placeholder="Search Pokemon..."
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={tierFilter} onValueChange={v => { setTierFilter(v ?? 'all'); setVisibleCount(60); }}>
          <SelectTrigger className="w-[120px] h-8 text-sm">
            <SelectValue placeholder="Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            {Array.from({ length: 20 }, (_, i) => 20 - i).map(t => (
              <SelectItem key={t} value={String(t)}>
                Tier {t} ({counts.tiers[t] || 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v ?? 'all'); setVisibleCount(60); }}>
          <SelectTrigger className="w-[150px] h-8 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="available">
              <span className="text-win">Available</span>
            </SelectItem>
            <SelectItem value="tera-banned">
              <span className="text-draw">Tera Banned</span>
            </SelectItem>
            <SelectItem value="banned">
              <span className="text-loss">Banned</span>
            </SelectItem>
          </SelectContent>
        </Select>
        {activeFilters > 0 && (
          <Button
            size="sm" variant="ghost"
            onClick={() => { setSearch(''); setTierFilter('all'); setStatusFilter('all'); setVisibleCount(60); }}
            className="h-8 text-text-muted hover:text-text-primary"
          >
            <X size={12} />
            Clear ({activeFilters})
          </Button>
        )}
        <span className="text-xs text-text-muted ml-auto">
          {filtered.length} results
        </span>
      </div>

      {/* Pokemon grid */}
      <Card>
        <CardContent className="p-3">
          {visible.length === 0 ? (
            <div className="py-8 text-center text-text-muted text-sm">
              No Pokemon match your filters
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
              {visible.map(entry => {
                const cfg = STATUS_CONFIG[entry.status];
                const isEditing = editingName === entry.name;

                return (
                  <div
                    key={entry.name}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors ${
                      entry.status === 'banned' ? 'opacity-50 hover:opacity-80' : 'hover:bg-surface-overlay/50'
                    }`}
                  >
                    <PokemonSprite name={entry.name} size="sm" />

                    {/* Name */}
                    <span className={`text-sm flex-1 min-w-0 truncate ${
                      entry.status === 'banned' ? 'text-text-muted line-through' : 'text-text-primary'
                    }`}>
                      {entry.name}
                    </span>

                    {/* Tier — click to edit inline */}
                    {isEditing ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <NumberInput
                          value={editTierValue}
                          onChange={setEditTierValue}
                          min={0}
                          max={20}
                          className="w-16 h-6 text-xs"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveTier();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        />
                        <button onClick={saveTier} className="text-win hover:text-win/80 p-0.5">
                          <Check size={12} />
                        </button>
                        <button onClick={cancelEdit} className="text-text-muted hover:text-loss p-0.5">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditTier(entry.name)}
                        className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-mono border transition-colors hover:bg-surface-overlay ${
                          entry.modified && entry.tier !== entry.baseTier
                            ? 'border-pink/30 text-pink bg-pink/10'
                            : 'border-border-subtle text-text-secondary'
                        }`}
                      >
                        T{entry.tier}
                      </button>
                    )}

                    {/* Status badge — click to cycle */}
                    <button
                      onClick={() => cycleStatus(entry.name)}
                      className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium border transition-all hover:brightness-125 ${cfg.color} ${cfg.bg} ${cfg.border}`}
                      title={`Click to change (→ ${STATUS_CONFIG[cfg.next].label})`}
                    >
                      {cfg.label}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="ghost" size="sm"
            onClick={() => setVisibleCount(prev => prev + 60)}
            className="text-text-muted hover:text-text-primary"
          >
            <ChevronDown size={14} />
            Show more ({filtered.length - visibleCount} remaining)
          </Button>
        </div>
      )}
    </div>
  );
}
