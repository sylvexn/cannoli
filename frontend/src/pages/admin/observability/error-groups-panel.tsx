/**
 * ErrorGroupsPanel — triage queue for grouped error fingerprints.
 *
 * Features:
 * - Filter by status (open/resolved/muted/all), kind, debounced search
 * - Stats strip with clickable open/resolved/muted/newToday counts
 * - Expandable rows: spark, counts, action buttons, sampleStack, occurrences
 * - Auto-refresh every 10s when at top (unfiltered, first page)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import type {
  ApiErrorGroup, ApiErrorGroupDetail, ApiObservabilityOverview, ErrorGroupStatus,
} from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { getErrorMessage } from '@/lib/errors';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Search, X, ChevronDown, ChevronRight, RefreshCw, Users,
  CheckCircle2, VolumeX, AlertTriangle, Filter,
} from 'lucide-react';
import { MiniSpark } from './mini-spark';

const PAGE_SIZE = 50;

type StatusFilter = 'open' | 'resolved' | 'muted' | 'all';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'muted', label: 'Muted' },
  { value: 'all', label: 'All statuses' },
];

function kindClasses(kind: string): string {
  if (kind === 'server') return 'border-loss/40 text-loss bg-loss/10';
  if (kind === 'client') return 'border-pink/40 text-pink bg-pink/10';
  return 'border-draw/40 text-draw bg-draw/10';
}

function statusBadgeClasses(status: ErrorGroupStatus): string {
  if (status === 'resolved') return 'border-win/40 text-win bg-win/10';
  if (status === 'muted') return 'border-text-muted/40 text-text-muted bg-text-muted/10';
  return 'border-loss/40 text-loss bg-loss/10';
}

// ─── Expanded detail ──────────────────────────────────────────────────────────

interface GroupDetailProps {
  group: ApiErrorGroup;
  onStatusChange: () => void;
}

function GroupDetail({ group, onStatusChange }: GroupDetailProps) {
  const [detail, setDetail] = useState<ApiErrorGroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getErrorGroup(group.id)
      .then(setDetail)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [group.id]);

  async function setStatus(status: ErrorGroupStatus) {
    setActing(true);
    try {
      await api.setErrorGroupStatus(group.id, status);
      toast.success(`Error group marked as ${status}.`);
      onStatusChange();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update status'));
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="px-4 pb-4 pl-10 space-y-3 text-[11px]">
      {/* Meta */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-text-muted font-mono">
        <span>fingerprint: <span className="text-text-secondary">{group.fingerprint}</span></span>
        {group.firstSeen && (
          <span>first seen: <span className="text-text-secondary">{formatRelativeTime(group.firstSeen)}</span></span>
        )}
        {group.lastSeen && (
          <span>last seen: <span className="text-text-secondary">{formatRelativeTime(group.lastSeen)}</span></span>
        )}
        {group.firstVersion && (
          <span>first ver: <span className="text-text-secondary">{group.firstVersion}</span></span>
        )}
        {group.lastVersion && (
          <span>last ver: <span className="text-text-secondary">{group.lastVersion}</span></span>
        )}
        {detail?.resolvedAt && (
          <span>resolved: <span className="text-text-secondary">{formatRelativeTime(detail.resolvedAt)}</span></span>
        )}
        {detail?.resolvedVersion && (
          <span>resolved ver: <span className="text-text-secondary">{detail.resolvedVersion}</span></span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        {group.status !== 'resolved' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStatus('resolved')}
            disabled={acting}
            className="h-7 text-[11px] border-win/40 text-win hover:bg-win/10"
          >
            <CheckCircle2 size={11} className="mr-1" />
            Resolve
          </Button>
        )}
        {group.status !== 'muted' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStatus('muted')}
            disabled={acting}
            className="h-7 text-[11px] border-text-muted/40 text-text-muted hover:bg-text-muted/10"
          >
            <VolumeX size={11} className="mr-1" />
            Mute
          </Button>
        )}
        {group.status !== 'open' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStatus('open')}
            disabled={acting}
            className="h-7 text-[11px] border-loss/40 text-loss hover:bg-loss/10"
          >
            <AlertTriangle size={11} className="mr-1" />
            Reopen
          </Button>
        )}
      </div>

      {/* Stack trace */}
      {loading && (
        <p className="text-text-muted">Loading details…</p>
      )}
      {detail?.sampleStack && (
        <pre className="max-h-56 overflow-auto rounded bg-surface-base/60 border border-border-default p-2 font-mono text-[10px] leading-relaxed text-text-muted whitespace-pre-wrap">
          {detail.sampleStack}
        </pre>
      )}

      {/* Recent occurrences */}
      {detail && detail.occurrences.length > 0 && (
        <div>
          <p className="text-text-muted mb-1 font-mono uppercase text-[10px] tracking-wide">
            Recent occurrences ({detail.occurrences.length})
          </p>
          <div className="rounded border border-border-default divide-y divide-border-default overflow-hidden">
            {detail.occurrences.map(occ => (
              <div key={occ.id} className="flex items-center gap-3 px-3 py-1.5 text-[10px] font-mono">
                <span className="text-text-muted tabular-nums shrink-0">
                  {occ.timestamp ? formatRelativeTime(occ.timestamp) : '—'}
                </span>
                <span className="text-text-secondary truncate flex-1">{occ.path}</span>
                {occ.status && (
                  <Badge variant="outline" className={cn('text-[9px] h-4 px-1 font-mono',
                    occ.status >= 500 ? 'border-loss/40 text-loss bg-loss/10' :
                    occ.status >= 400 ? 'border-draw/40 text-draw bg-draw/10' :
                    'border-win/40 text-win bg-win/10',
                  )}>
                    {occ.status}
                  </Badge>
                )}
                {occ.username && (
                  <span className="text-text-muted shrink-0">{occ.username}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Group row ────────────────────────────────────────────────────────────────

interface GroupRowProps {
  group: ApiErrorGroup;
  index: number;
  onStatusChange: () => void;
}

function GroupRow({ group, index, onStatusChange }: GroupRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn('group transition-colors', open && 'bg-surface-overlay/30')}
      style={{ ['--i' as never]: Math.min(index, 20) }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-overlay/50 transition-colors"
      >
        {/* Expand chevron */}
        <span className="shrink-0 w-3 text-text-muted">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>

        {/* Kind badge */}
        <Badge variant="outline" className={cn('shrink-0 text-[10px] font-mono', kindClasses(group.kind))}>
          {group.kind}
        </Badge>

        {/* Error name + message */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[12px] text-text-primary truncate">
              {group.errorName ?? group.kind}
            </span>
            {group.isNew && (
              <Badge variant="outline" className="border-neon/40 text-neon bg-neon/10 text-[9px] h-4 px-1.5 shrink-0">
                NEW
              </Badge>
            )}
          </div>
          {group.sampleMessage && (
            <p className="text-[11px] text-text-muted truncate">{group.sampleMessage}</p>
          )}
          {group.samplePath && (
            <p className="font-mono text-[10px] text-text-muted/70 truncate">{group.samplePath}</p>
          )}
        </div>

        {/* Sparkline */}
        <MiniSpark
          values={group.spark}
          colorClass={group.status === 'open' ? 'bg-loss/50' : 'bg-text-muted/30'}
          height={20}
          className="shrink-0"
        />

        {/* Count */}
        <span className="shrink-0 font-mono tabular-nums text-[12px] text-text-secondary w-10 text-right">
          {group.count.toLocaleString()}
        </span>

        {/* Affected users */}
        {group.affectedUsers > 0 && (
          <span className="shrink-0 flex items-center gap-1 text-[11px] text-text-muted font-mono tabular-nums w-12 justify-end">
            <Users size={10} />
            {group.affectedUsers}
          </span>
        )}

        {/* Status badge */}
        <Badge variant="outline" className={cn('shrink-0 text-[10px] font-mono', statusBadgeClasses(group.status))}>
          {group.status}
        </Badge>

        {/* Last seen */}
        <span className="shrink-0 w-16 text-right font-mono text-[10px] text-text-muted tabular-nums">
          {group.lastSeen ? formatRelativeTime(group.lastSeen) : '—'}
        </span>
      </button>

      {open && (
        <GroupDetail group={group} onStatusChange={() => { setOpen(false); onStatusChange(); }} />
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function ErrorGroupsPanel() {
  const [data, setData] = useState<ApiObservabilityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [kindFilter, setKindFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    api.getErrorGroups({
      status: statusFilter === 'all' ? undefined : statusFilter,
      kind: kindFilter === 'all' ? undefined : kindFilter,
      search: debouncedSearch || undefined,
      limit,
    })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter, kindFilter, debouncedSearch, limit]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 10s when at the top unfiltered page
  const atTop = limit === PAGE_SIZE;
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!atTop) return;
    const id = setInterval(() => loadRef.current(), 10_000);
    return () => clearInterval(id);
  }, [atTop]);

  const groups = data?.groups ?? [];
  const stats = data?.stats;
  const total = data?.total ?? 0;
  const hasMore = groups.length < total;

  const activeFilters =
    (statusFilter !== 'open' ? 1 : 0) +
    (kindFilter !== 'all' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  function clearFilters() {
    setSearch('');
    setStatusFilter('open');
    setKindFilter('all');
    setLimit(PAGE_SIZE);
  }

  function resetPaging() { setLimit(PAGE_SIZE); }

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          onClick={() => { setStatusFilter(statusFilter === 'open' ? 'all' : 'open'); resetPaging(); }}
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <Badge variant="outline" className={cn('border-loss/40 text-loss bg-loss/10', statusFilter === 'open' && 'ring-1 ring-current')}>
            Open {stats?.open ?? 0}
          </Badge>
        </button>
        <button
          onClick={() => { setStatusFilter(statusFilter === 'resolved' ? 'all' : 'resolved'); resetPaging(); }}
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <Badge variant="outline" className={cn('border-win/40 text-win bg-win/10', statusFilter === 'resolved' && 'ring-1 ring-current')}>
            Resolved {stats?.resolved ?? 0}
          </Badge>
        </button>
        <button
          onClick={() => { setStatusFilter(statusFilter === 'muted' ? 'all' : 'muted'); resetPaging(); }}
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <Badge variant="outline" className={cn('border-text-muted/40 text-text-muted bg-text-muted/10', statusFilter === 'muted' && 'ring-1 ring-current')}>
            Muted {stats?.muted ?? 0}
          </Badge>
        </button>
        {(stats?.newToday ?? 0) > 0 && (
          <Badge variant="outline" className="border-neon/40 text-neon bg-neon/10">
            {stats?.newToday} new today
          </Badge>
        )}
        <Button
          variant="ghost" size="sm" onClick={load}
          className="h-7 ml-auto text-text-muted hover:text-text-primary"
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); resetPaging(); }}
            placeholder="Search error, path…"
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v as StatusFilter); resetPaging(); }}>
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <Filter size={12} className="mr-1 text-text-muted" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map(s => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kindFilter} onValueChange={v => { setKindFilter(v ?? 'all'); resetPaging(); }}>
          <SelectTrigger className="w-[120px] h-8 text-sm">
            <Filter size={12} className="mr-1 text-text-muted" />
            <SelectValue placeholder="Kind" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="server">Server</SelectItem>
            <SelectItem value="client">Client</SelectItem>
            <SelectItem value="unhandled">Unhandled</SelectItem>
          </SelectContent>
        </Select>
        {activeFilters > 0 && (
          <Button size="sm" variant="ghost" onClick={clearFilters} className="h-8 text-text-muted hover:text-text-primary">
            <X size={12} />
            Clear ({activeFilters})
          </Button>
        )}
      </div>

      {/* Group list */}
      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {groups.length === 0 ? (
            <EmptyState
              variant="nothing-here"
              title={loading ? 'Loading…' : 'No error groups match your filters.'}
              spriteSize="md"
              padding="sm"
            />
          ) : (
            groups.map((group, i) => (
              <div key={group.id} className="stagger-item">
                <GroupRow group={group} index={i} onStatusChange={load} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="ghost" size="sm"
            onClick={() => setLimit(prev => prev + PAGE_SIZE)}
            className="text-text-muted hover:text-text-primary"
          >
            <ChevronDown size={14} />
            Show more ({total - groups.length} remaining)
          </Button>
        </div>
      )}

      {activeFilters > 0 && total > 0 && (
        <p className="text-xs text-text-muted text-center">
          Showing {groups.length} of {total} matching groups
        </p>
      )}
    </div>
  );
}
