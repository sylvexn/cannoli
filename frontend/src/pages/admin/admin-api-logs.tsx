/**
 * Admin "API Logs" tab — a live view of raw HTTP traffic hitting the backend.
 *
 * Reads the request_logs table (written by the logging middleware in
 * backend/src/index.ts) through /api/admin/request-logs. Server-side filtered
 * + paginated since the table can hold thousands of rows. The stats strip is
 * an overview across the whole table; clicking 4xx/5xx scopes the list.
 *
 * Distinct from the Activity Log tab: that shows business events ("trade
 * approved"); this shows the underlying HTTP calls + their errors/latency —
 * the place to look when a login or API call is misbehaving.
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
import type { ApiRequestLog, ApiRequestLogResponse } from '@/lib/api';
import { useFormatTime, useFormatDate } from '@/lib/format';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';
import {
  Search, Filter, X, ChevronDown, ChevronRight, AlertTriangle, RefreshCw,
} from 'lucide-react';

const PAGE_SIZE = 50;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SOURCE_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'server', label: 'Server (HTTP)' },
  { value: 'client', label: 'Client (browser)' },
];
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'errors', label: 'Errors (4xx + 5xx)' },
  { value: '2xx', label: '2xx Success' },
  { value: '3xx', label: '3xx Redirect' },
  { value: '4xx', label: '4xx Client' },
  { value: '5xx', label: '5xx Server' },
];

/** Tailwind token classes for an HTTP status class. */
function statusClasses(status: number): string {
  if (status >= 500) return 'border-loss/40 text-loss bg-loss/10';
  if (status >= 400) return 'border-draw/40 text-draw bg-draw/10';
  if (status >= 300) return 'border-text-muted/40 text-text-muted bg-text-muted/10';
  return 'border-win/40 text-win bg-win/10';
}

const METHOD_CLASSES: Record<string, string> = {
  GET: 'border-neon/40 text-neon bg-neon/10',
  POST: 'border-win/40 text-win bg-win/10',
  PUT: 'border-draw/40 text-draw bg-draw/10',
  PATCH: 'border-draw/40 text-draw bg-draw/10',
  DELETE: 'border-loss/40 text-loss bg-loss/10',
  CLIENT: 'border-pink/40 text-pink bg-pink/10',
};

/** Color the latency number — slow requests stand out. */
function durationClass(ms: number): string {
  if (ms >= 1000) return 'text-loss';
  if (ms >= 300) return 'text-draw';
  return 'text-text-muted';
}

export function AdminApiLogs() {
  const [data, setData] = useState<ApiRequestLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Debounce the search box so we don't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    api.getRequestLogs({ status: statusFilter, method: methodFilter, source: sourceFilter, search: debouncedSearch, limit })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter, methodFilter, sourceFilter, debouncedSearch, limit]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 10s, but only when the user is at the top of the list
  // (limit === PAGE_SIZE) so paging-back isn't yanked out from under them.
  const atTop = limit === PAGE_SIZE;
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!atTop) return;
    const id = setInterval(() => loadRef.current(), 10_000);
    return () => clearInterval(id);
  }, [atTop]);

  const logs = data?.logs ?? [];
  const stats = data?.stats;
  const total = data?.total ?? 0;
  const hasMore = logs.length < total;

  const activeFilters = (statusFilter !== 'all' ? 1 : 0) +
    (methodFilter !== 'all' ? 1 : 0) + (sourceFilter !== 'all' ? 1 : 0) + (search.trim() ? 1 : 0);

  function clearFilters() {
    setSearch('');
    setStatusFilter('all');
    setMethodFilter('all');
    setSourceFilter('all');
    setLimit(PAGE_SIZE);
  }

  function resetPaging() { setLimit(PAGE_SIZE); }

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Total:</span>
          <span className="font-mono font-medium text-text-primary tabular-nums">{stats?.total ?? '—'}</span>
        </div>
        <button
          onClick={() => { setStatusFilter(statusFilter === '4xx' ? 'all' : '4xx'); resetPaging(); }}
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <Badge variant="outline" className={cn('border-draw/40 text-draw bg-draw/10', statusFilter === '4xx' && 'ring-1 ring-current')}>
            4xx {stats?.errors4xx ?? 0}
          </Badge>
        </button>
        <button
          onClick={() => { setStatusFilter(statusFilter === '5xx' ? 'all' : '5xx'); resetPaging(); }}
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <Badge variant="outline" className={cn('border-loss/40 text-loss bg-loss/10', statusFilter === '5xx' && 'ring-1 ring-current')}>
            5xx {stats?.errors5xx ?? 0}
          </Badge>
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Avg:</span>
          <span className="font-mono text-text-secondary tabular-nums">{stats?.avgMs ?? 0}ms</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">p95:</span>
          <span className="font-mono text-text-secondary tabular-nums">{stats?.p95Ms ?? 0}ms</span>
        </div>
        <Button
          variant="ghost" size="sm" onClick={load}
          className="h-7 ml-auto text-text-muted hover:text-text-primary"
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); resetPaging(); }}
            placeholder="Search path, user, error..."
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={sourceFilter} onValueChange={v => { setSourceFilter(v ?? 'all'); resetPaging(); }}>
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <Filter size={12} className="mr-1 text-text-muted" />
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_FILTERS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={methodFilter} onValueChange={v => { setMethodFilter(v ?? 'all'); resetPaging(); }}>
          <SelectTrigger className="w-[110px] h-8 text-sm">
            <Filter size={12} className="mr-1 text-text-muted" />
            <SelectValue placeholder="Method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            {METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v ?? 'all'); resetPaging(); }}>
          <SelectTrigger className="w-[170px] h-8 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {activeFilters > 0 && (
          <Button size="sm" variant="ghost" onClick={clearFilters} className="h-8 text-text-muted hover:text-text-primary">
            <X size={12} />
            Clear ({activeFilters})
          </Button>
        )}
      </div>

      {/* Log list */}
      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {logs.length === 0 ? (
            <EmptyState
              variant="nothing-here"
              title={loading ? 'Loading…' : 'No requests match your filters.'}
              spriteSize="md"
              padding="sm"
            />
          ) : (
            logs.map((log, i) => (
              <div key={log.id} className="stagger-item" style={{ ['--i' as never]: Math.min(i, 20) }}>
                <LogRow log={log} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="ghost" size="sm"
            onClick={() => setLimit(prev => prev + PAGE_SIZE)}
            className="text-text-muted hover:text-text-primary"
          >
            <ChevronDown size={14} />
            Show more ({total - logs.length} remaining)
          </Button>
        </div>
      )}

      {activeFilters > 0 && total > 0 && (
        <p className="text-xs text-text-muted text-center">
          Showing {logs.length} of {total} matching requests
        </p>
      )}
    </div>
  );
}

function LogRow({ log }: { log: ApiRequestLog }) {
  const fmtTime = useFormatTime();
  const fmtDate = useFormatDate();
  const [open, setOpen] = useState(false);

  const ts = new Date(log.timestamp ?? Date.now());
  const isToday = new Date().toDateString() === ts.toDateString();
  const timeStr = isToday ? fmtTime(ts) : fmtDate(ts, { year: 'hide' });

  const hasError = !!(log.errorName || log.errorMessage || log.errorStack);
  const expandable = hasError || !!log.ip;

  return (
    <div className={cn('group transition-colors', open && 'bg-surface-overlay/30')}>
      <button
        onClick={() => expandable && setOpen(o => !o)}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-surface-overlay/50 transition-colors',
          !expandable && 'cursor-default',
        )}
      >
        {/* Expand chevron */}
        <span className="shrink-0 w-3 text-text-muted">
          {expandable && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        </span>

        {/* Method */}
        <Badge variant="outline" className={cn('shrink-0 w-14 justify-center text-[10px] font-mono', METHOD_CLASSES[log.method] ?? 'border-text-muted/40 text-text-muted')}>
          {log.method}
        </Badge>

        {/* Status */}
        <Badge variant="outline" className={cn('shrink-0 w-10 justify-center text-[10px] font-mono tabular-nums', statusClasses(log.status))}>
          {log.status}
        </Badge>

        {/* Path */}
        <span className="flex-1 min-w-0 truncate font-mono text-[12px] text-text-secondary">
          {log.path}
          {hasError && log.errorMessage && (
            <span className="ml-2 text-loss/80 inline-flex items-center gap-1">
              <AlertTriangle size={10} />
              {log.errorMessage}
            </span>
          )}
        </span>

        {/* User */}
        <span className="shrink-0 w-24 text-right truncate font-mono text-[11px] text-text-muted">
          {log.username ?? '—'}
        </span>

        {/* Duration */}
        <span className={cn('shrink-0 w-14 text-right font-mono text-[11px] tabular-nums', durationClass(log.durationMs))}>
          {log.durationMs}ms
        </span>

        {/* Timestamp */}
        <span className="shrink-0 w-16 text-right font-mono text-[11px] text-text-muted tabular-nums">
          {timeStr}
        </span>
      </button>

      {/* Expanded detail */}
      {open && expandable && (
        <div className="px-4 pb-3 pl-10 space-y-2 text-[11px]">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-text-muted font-mono">
            <span>source: <span className="text-text-secondary">{log.source}</span></span>
            {log.errorId && <span>ref: <span className="text-text-secondary">{log.errorId}</span></span>}
            {log.ip && <span>ip: <span className="text-text-secondary">{log.ip}</span></span>}
            {log.userId && <span>user_id: <span className="text-text-secondary">{log.userId}</span></span>}
            <span>at: <span className="text-text-secondary">{ts.toISOString()}</span></span>
          </div>
          {log.errorName && (
            <div className="font-mono text-loss">
              {log.errorName}{log.errorMessage ? `: ${log.errorMessage}` : ''}
            </div>
          )}
          {log.errorStack && (
            <pre className="max-h-64 overflow-auto rounded bg-surface-base/60 border border-border-default p-2 font-mono text-[10px] leading-relaxed text-text-muted whitespace-pre-wrap">
              {log.errorStack}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
