import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  TIER_LIST, TERA_BANNED, BANNED,
  type TierEntry,
} from '@/mocks/tier-list';
import { PokemonSprite } from '@/components/pokemon-sprite';
import {
  Search, X, Shield, ShieldOff, ChevronDown, Star,
} from 'lucide-react';
import { toast } from 'sonner';

export function AdminTierList() {
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [showFilter, setShowFilter] = useState<string>('all'); // all | tera-banned | available
  const [teraBanned, setTeraBanned] = useState<Set<string>>(() => new Set(TERA_BANNED));
  const [visibleCount, setVisibleCount] = useState(50);

  // Edit tier dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editPokemon, setEditPokemon] = useState<TierEntry | null>(null);
  const [editTier, setEditTier] = useState(0);

  // Track tier overrides
  const [tierOverrides, setTierOverrides] = useState<Map<string, number>>(new Map());

  const filtered = useMemo(() => {
    let list = TIER_LIST.map(entry => ({
      ...entry,
      tier: tierOverrides.get(entry.name) ?? entry.tier,
      teraBanned: teraBanned.has(entry.name),
    }));

    if (tierFilter !== 'all') {
      list = list.filter(e => e.tier === Number(tierFilter));
    }
    if (showFilter === 'tera-banned') {
      list = list.filter(e => teraBanned.has(e.name));
    } else if (showFilter === 'available') {
      list = list.filter(e => !teraBanned.has(e.name));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q));
    }

    return list.sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
  }, [search, tierFilter, showFilter, teraBanned, tierOverrides]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  function toggleTeraBan(name: string) {
    setTeraBanned(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        toast.success(`${name} removed from tera ban list`);
      } else {
        next.add(name);
        toast.success(`${name} added to tera ban list`);
      }
      return next;
    });
  }

  function openEditTier(entry: TierEntry & { tier: number }) {
    setEditPokemon(entry);
    setEditTier(entry.tier);
    setEditOpen(true);
  }

  function saveTier() {
    if (!editPokemon) return;
    setTierOverrides(prev => {
      const next = new Map(prev);
      if (editTier === TIER_LIST.find(e => e.name === editPokemon.name)?.tier) {
        next.delete(editPokemon.name);
      } else {
        next.set(editPokemon.name, editTier);
      }
      return next;
    });
    toast.success(`${editPokemon.name} set to Tier ${editTier}`);
    setEditOpen(false);
  }

  const activeFilters = (tierFilter !== 'all' ? 1 : 0) +
    (showFilter !== 'all' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  // Tier distribution
  const tierCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const e of TIER_LIST) {
      const tier = tierOverrides.get(e.name) ?? e.tier;
      counts[tier] = (counts[tier] || 0) + 1;
    }
    return counts;
  }, [tierOverrides]);

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="flex flex-wrap gap-3 text-sm items-center">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Total:</span>
          <span className="text-text-primary font-medium font-mono">{TIER_LIST.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Banned:</span>
          <span className="text-loss font-medium font-mono">{BANNED.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Tera Banned:</span>
          <span className="text-draw font-medium font-mono">{teraBanned.size}</span>
        </div>
        {tierOverrides.size > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted">Overrides:</span>
            <span className="text-pink font-medium font-mono">{tierOverrides.size}</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setVisibleCount(50); }}
            placeholder="Search Pokemon..."
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={tierFilter} onValueChange={v => { setTierFilter(v ?? 'all'); setVisibleCount(50); }}>
          <SelectTrigger className="w-[120px] h-8 text-sm">
            <SelectValue placeholder="Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            {Array.from({ length: 20 }, (_, i) => 20 - i).map(t => (
              <SelectItem key={t} value={String(t)}>
                Tier {t} ({tierCounts[t] || 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={showFilter} onValueChange={v => { setShowFilter(v ?? 'all'); setVisibleCount(50); }}>
          <SelectTrigger className="w-[150px] h-8 text-sm">
            <SelectValue placeholder="Show" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pokemon</SelectItem>
            <SelectItem value="tera-banned">Tera Banned</SelectItem>
            <SelectItem value="available">Tera Available</SelectItem>
          </SelectContent>
        </Select>
        {activeFilters > 0 && (
          <Button
            size="sm" variant="ghost"
            onClick={() => { setSearch(''); setTierFilter('all'); setShowFilter('all'); setVisibleCount(50); }}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {visible.map(entry => {
                const isOverridden = tierOverrides.has(entry.name);
                const isBanned = teraBanned.has(entry.name);
                return (
                  <div
                    key={entry.name}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-surface-overlay/50 transition-colors group ${
                      isBanned ? 'bg-draw/5' : ''
                    }`}
                  >
                    <PokemonSprite name={entry.name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-text-primary truncate block">{entry.name}</span>
                    </div>
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-[10px] px-1.5 font-mono cursor-pointer hover:bg-surface-overlay ${
                        isOverridden ? 'border-pink/30 text-pink bg-pink/10' : ''
                      }`}
                      onClick={() => openEditTier(entry)}
                    >
                      T{entry.tier}
                    </Badge>
                    {isBanned && (
                      <Star size={12} className="text-draw shrink-0" />
                    )}
                    <button
                      onClick={() => toggleTeraBan(entry.name)}
                      className={`shrink-0 p-1 rounded transition-colors ${
                        isBanned
                          ? 'text-draw hover:text-loss'
                          : 'text-text-muted/30 opacity-0 group-hover:opacity-100 hover:text-draw'
                      }`}
                      title={isBanned ? 'Remove tera ban' : 'Add tera ban'}
                    >
                      {isBanned ? <ShieldOff size={12} /> : <Shield size={12} />}
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
            onClick={() => setVisibleCount(prev => prev + 50)}
            className="text-text-muted hover:text-text-primary"
          >
            <ChevronDown size={14} />
            Show more ({filtered.length - visibleCount} remaining)
          </Button>
        </div>
      )}

      {/* Edit Tier Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editPokemon && <PokemonSprite name={editPokemon.name} size="sm" />}
              Edit Tier — {editPokemon?.name}
            </DialogTitle>
            <DialogDescription>
              Adjust the tier point value for this Pokemon.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Tier (1–20)</label>
              <NumberInput
                value={editTier}
                onChange={setEditTier}
                min={1}
                max={20}
                autoFocus
              />
            </div>
            {editPokemon && editTier !== TIER_LIST.find(e => e.name === editPokemon.name)?.tier && (
              <p className="text-xs text-pink">
                Changed from original tier {TIER_LIST.find(e => e.name === editPokemon.name)?.tier}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveTier} className="bg-neon text-surface-base hover:bg-neon/90">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
