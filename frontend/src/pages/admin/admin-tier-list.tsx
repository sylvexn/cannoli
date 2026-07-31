import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api, type ApiCostFormat } from '@/lib/api';
import { PokemonSprite } from '@/components/pokemon-sprite';
import {
  Search, X, ChevronDown, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage, isApiError } from '@/lib/errors';
import { DEFAULT_FORMAT } from '@/data/tier-list';

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

interface ActiveLeague { id: string; name: string; phase: string }

export function AdminTierList() {
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [, setLoading] = useState(true);
  /**
   * Leagues currently in regular/playoffs phase. When non-empty the backend
   * rejects unforced PUT /api/tier-list/:name calls with 409 tier_list_locked,
   * so we surface a warning banner and prompt for a typed league-name confirm
   * before re-attempting with { force: true, confirmLeague }.
   */
  const [activeLeagues, setActiveLeagues] = useState<ActiveLeague[]>([]);

  // Cost format selector
  const [costFormats, setCostFormats] = useState<ApiCostFormat[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<string>(DEFAULT_FORMAT);

  useEffect(() => {
    api.getCostFormats()
      .then(formats => setCostFormats(formats))
      .catch(() => {
        // Fall back to static defaults if endpoint not yet live
        setCostFormats([
          { id: 'natdexplus', label: 'NatDex+', leagueIds: [] },
          { id: 'natdex', label: 'NatDex', leagueIds: [] },
        ]);
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    api.getTierList(selectedFormat)
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
  }, [selectedFormat]);

  useEffect(() => {
    api.getLeagues()
      .then(leagues => {
        setActiveLeagues(
          leagues
            .filter(l => l.season?.phase === 'regular' || l.season?.phase === 'playoffs')
            .map(l => ({ id: l.id, name: l.name, phase: l.season!.phase })),
        );
      })
      .catch(() => {});
  }, []);

  /**
   * Wrap api.updateTierListEntry with an interactive force/confirm path. When
   * the backend rejects with code tier_list_locked / tier_list_confirm_required,
   * we prompt the admin to type an active league name before retrying.
   *
   * Always passes `format` so the backend knows which price sheet to edit.
   */
  const sendTierUpdate = useCallback(async (
    name: string,
    data: { tier?: number; status?: string },
  ) => {
    const payload = { format: selectedFormat, ...data };
    try {
      await api.updateTierListEntry(name, payload);
    } catch (err: unknown) {
      const apiErr = isApiError(err) ? err : undefined;
      const code = apiErr?.body?.code ?? apiErr?.code;
      if (code === 'tier_list_locked' || code === 'tier_list_confirm_required') {
        const bodyLeagues = apiErr?.body?.activeLeagues as ActiveLeague[] | undefined;
        const names = (bodyLeagues ?? activeLeagues).map((l: ActiveLeague) => l.name).join(' / ');
        const confirmLeague = window.prompt(
          `Tier list edits affect leagues currently in regular/playoffs (${names}).\n\nType the league name to force this edit:`,
        );
        if (!confirmLeague) {
          toast.error('Force edit cancelled');
          throw err;
        }
        await api.updateTierListEntry(name, { ...payload, force: true, confirmLeague });
        toast.warning(`Forced tier-list edit during active league (${confirmLeague})`);
      } else {
        toast.error(getErrorMessage(err, 'Failed to update tier list'));
        throw err;
      }
    }
  }, [activeLeagues, selectedFormat]);

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
    const current = pool.find(e => e.name === name);
    if (!current) return;
    const next = STATUS_CONFIG[current.status].next;
    sendTierUpdate(name, { status: next })
      .then(() => {
        setPool(prev => prev.map(e => e.name === name ? { ...e, status: next, modified: true } : e));
        toast.success(`${name}: ${STATUS_CONFIG[next].label}`);
      })
      .catch(() => {});
  }, [pool, sendTierUpdate]);

  const startEditTier = useCallback((name: string) => {
    const entry = poolMap.get(name);
    if (!entry) return;
    setEditingName(name);
    setEditTierValue(entry.tier);
  }, [poolMap]);

  const saveTier = useCallback(() => {
    if (!editingName) return;
    const target = editingName;
    sendTierUpdate(target, { tier: editTierValue })
      .then(() => {
        setPool(prev => prev.map(e => {
          if (e.name !== target) return e;
          return { ...e, tier: editTierValue, modified: editTierValue !== e.baseTier };
        }));
        toast.success(`${target} → Tier ${editTierValue}`);
        setEditingName(null);
      })
      .catch(() => {});
  }, [editingName, editTierValue, sendTierUpdate]);

  const cancelEdit = useCallback(() => setEditingName(null), []);

  const activeFilters = (tierFilter !== 'all' ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  // Derive which leagues use the currently-selected format (for the format selector hint)
  const formatLeagueHint = useMemo(() => {
    const fmt = costFormats.find(f => f.id === selectedFormat);
    if (!fmt || fmt.leagueIds.length === 0) return null;
    return `${fmt.leagueIds.length} active league${fmt.leagueIds.length === 1 ? '' : 's'}`;
  }, [costFormats, selectedFormat]);

  return (
    <div className="space-y-4">
      {/* Format selector */}
      <div className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-raised px-3 py-2">
        <span className="text-xs font-mono uppercase tracking-wider text-text-muted shrink-0">Format</span>
        <div className="flex items-center gap-1 rounded border border-border-subtle overflow-hidden">
          {costFormats.length > 0
            ? costFormats.map(fmt => (
              <button
                key={fmt.id}
                onClick={() => {
                  if (fmt.id !== selectedFormat) {
                    setSelectedFormat(fmt.id);
                    setSearch('');
                    setTierFilter('all');
                    setStatusFilter('all');
                    setVisibleCount(60);
                    setEditingName(null);
                  }
                }}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  selectedFormat === fmt.id
                    ? 'bg-surface-overlay text-text-primary'
                    : 'text-text-muted hover:bg-surface-overlay/40 hover:text-text-secondary'
                }`}
              >
                {fmt.label}
              </button>
            ))
            : (
              // Skeleton while loading
              ['NatDex+', 'NatDex'].map(label => (
                <span key={label} className="px-3 py-1 text-xs text-text-muted opacity-40">{label}</span>
              ))
            )
          }
        </div>
        {formatLeagueHint && (
          <span className="text-[11px] text-text-muted font-mono">
            used by {formatLeagueHint}
          </span>
        )}
        <span className="ml-auto text-[11px] font-mono text-neon/80 uppercase tracking-wider">
          editing: {costFormats.find(f => f.id === selectedFormat)?.label ?? selectedFormat}
        </span>
      </div>

      {/* Active-league warning — surfaces backend phase gate */}
      {activeLeagues.length > 0 && (
        <div className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-xs text-loss/90 flex items-center gap-2">
          <span className="font-bold uppercase tracking-wider text-[10px]">Locked</span>
          <span>
            {activeLeagues.length === 1 ? 'A league is' : `${activeLeagues.length} leagues are`} past draft —
            tier-list edits will require typing the league name to force.
          </span>
          <span className="ml-auto font-mono text-[10px] text-loss/70">
            {activeLeagues.map(l => `${l.name} [${l.phase}]`).join(' · ')}
          </span>
        </div>
      )}

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
