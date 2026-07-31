import { useState, useEffect, type MouseEvent } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingSprite } from '@/components/loading-sprite';
import { EmptyState } from '@/components/empty-state';
import { api, type ApiFeedbackItem, type FeedbackCategory } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useFormatTime, useFormatDate, useUserTimezone, parseTimestamp } from '@/lib/format';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ExternalLink, ChevronDown, ChevronUp, RefreshCw,
  CircleDot, CircleCheck, Bell, Image as ImageIcon,
  Copy, Check,
} from 'lucide-react';

// Filter types

type CategoryFilter = FeedbackCategory | 'all';
type StatusFilter = 'open' | 'resolved' | 'all';

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: 'All',
  bug: 'Bug',
  feature: 'Feature',
  league: 'League',
  general: 'General',
};

const CATEGORY_FILTERS: CategoryFilter[] = ['all', 'bug', 'feature', 'league', 'general'];
const STATUS_FILTERS: StatusFilter[] = ['open', 'resolved', 'all'];

// Category accent styles

function categoryClass(cat: FeedbackCategory): string {
  switch (cat) {
    case 'bug':     return 'border-loss/40 text-loss bg-loss/10';
    case 'feature': return 'border-neon/40 text-neon bg-neon/10';
    case 'league':  return 'border-cyan-500/40 text-cyan-400 bg-cyan-500/10';
    case 'general': return 'border-border-default text-text-muted bg-surface-overlay/50';
  }
}

// Main component

export function AdminFeedback() {
  const [items, setItems] = useState<ApiFeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [backfilling, setBackfilling] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    api.getAdminFeedback({
      category: categoryFilter !== 'all' ? categoryFilter : undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
    })
      .then(setItems)
      .catch(e => setError(getErrorMessage(e, 'Failed to load feedback')))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [categoryFilter, statusFilter]);

  async function handleBackfill() {
    setBackfilling(true);
    try {
      const res = await api.backfillFeedbackNotifications();
      if (res.unconfigured) {
        toast.error('GitHub not configured — cannot backfill notifications');
      } else {
        toast.success(`Notified reporters: ${res.inserted} sent, ${res.skipped} already sent, ${res.noUser} no account`);
      }
    } catch (e) {
      toast.error(getErrorMessage(e, 'Backfill failed'));
    } finally {
      setBackfilling(false);
    }
  }

  function handleResolved(id: number) {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, status: 'resolved' } : item,
    ));
  }

  const openCount = items.filter(i => i.status === 'open').length;
  const resolvedCount = items.filter(i => i.status === 'resolved').length;

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Category filter */}
        <div className="flex gap-1 rounded-md border border-border-default p-0.5">
          {CATEGORY_FILTERS.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded transition-colors',
                categoryFilter === cat
                  ? 'bg-surface-overlay text-text-primary'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-1 rounded-md border border-border-default p-0.5">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded capitalize transition-colors',
                statusFilter === s
                  ? 'bg-surface-overlay text-text-primary'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {s === 'all' ? 'All' : s === 'open' ? 'Open' : 'Resolved'}
            </button>
          ))}
        </div>

        {statusFilter === 'all' && (
          <div className="flex gap-2 text-xs text-text-muted">
            <span className="text-win">{openCount} open</span>
            <span>/</span>
            <span className="text-text-muted">{resolvedCount} resolved</span>
          </div>
        )}

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackfill}
          disabled={backfilling}
          className="h-7 text-text-muted"
        >
          {backfilling ? <RefreshCw size={12} className="animate-spin" /> : <Bell size={12} />}
          Notify reporters
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={load}
          className="h-7 text-text-muted"
        >
          <RefreshCw size={12} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-loss/30 bg-loss/5 px-4 py-3 text-sm text-loss">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {loading ? (
            <LoadingSprite />
          ) : items.length === 0 ? (
            <EmptyState
              variant="quiet"
              title={`No ${statusFilter !== 'all' ? statusFilter + ' ' : ''}feedback.`}
              spriteSize="md"
              padding="sm"
            />
          ) : (
            items.map(item => (
              <FeedbackRow key={item.id} item={item} onResolved={handleResolved} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Row

function FeedbackRow({
  item,
  onResolved,
}: {
  item: ApiFeedbackItem;
  onResolved: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [responding, setResponding] = useState(false);
  const [response, setResponse] = useState('');
  const [resolving, setResolving] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const fmtTime = useFormatTime();
  const fmtDate = useFormatDate();
  const tz = useUserTimezone();

  const ts = parseTimestamp(item.createdAt);
  const isToday = new Date().toDateString() === ts.toDateString();
  const timeStr = isToday ? fmtTime(ts) : fmtDate(ts, { year: 'hide' });
  // Full, unambiguous instant for the hover tooltip — date + seconds + zone.
  const exactTs = ts.toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'long', timeZone: tz,
  });
  const isOpen = item.status === 'open';

  function copyId(e: MouseEvent) {
    e.stopPropagation();
    navigator.clipboard?.writeText(`#${item.id}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => toast.error('Copy failed'));
  }

  async function handleResolve() {
    setResolving(true);
    try {
      await api.resolveFeedback(item.id, response.trim() || undefined);
      toast.success('Marked as resolved');
      onResolved(item.id);
      setResponding(false);
      setResponse('');
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to resolve'));
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="group">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-overlay/50 transition-colors text-left"
      >
        {/* Status icon */}
        {isOpen ? (
          <CircleDot size={16} className="shrink-0 text-win" />
        ) : (
          <CircleCheck size={16} className="shrink-0 text-text-muted" />
        )}

        {/* Category badge */}
        <span className={cn(
          'shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
          categoryClass(item.category),
        )}>
          {CATEGORY_LABELS[item.category]}
        </span>

        {/* Title + reporter */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">{item.title}</span>
          </div>
          <span className="text-xs text-text-muted">{item.reporter}</span>
        </div>

        {/* Page chip */}
        {item.page && (
          <Badge variant="outline" className="shrink-0 text-[10px] border-border-default text-text-muted">
            {item.page}
          </Badge>
        )}

        {/* Copyable lookup ID */}
        <span
          role="button"
          tabIndex={-1}
          onClick={copyId}
          title={copied ? 'Copied!' : 'Click to copy ID'}
          className="shrink-0 inline-flex items-center gap-1 font-mono text-[11px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer tabular-nums"
        >
          {copied
            ? <Check size={11} className="text-win" />
            : <Copy size={11} className="opacity-50 group-hover:opacity-100 transition-opacity" />
          }
          #{item.id}
        </span>

        {/* Timestamp */}
        <span
          title={exactTs}
          className="shrink-0 w-16 text-right text-xs text-text-muted font-mono tabular-nums cursor-default"
        >
          {timeStr}
        </span>

        {expanded
          ? <ChevronUp size={14} className="shrink-0 text-text-muted" />
          : <ChevronDown size={14} className="shrink-0 text-text-muted" />
        }
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-3 pt-0 pl-12 space-y-3">
          {/* Body */}
          <div className="rounded-md bg-surface-overlay/50 border border-border-default p-3 text-sm text-text-secondary whitespace-pre-wrap">
            {item.body || 'No description'}
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Error ref */}
            {item.errorRef && (
              <span className="font-mono text-[11px] text-text-muted bg-surface-overlay/50 border border-border-default px-1.5 py-0.5 rounded">
                ref: {item.errorRef}
              </span>
            )}

            {/* Screenshot */}
            {item.screenshotUrl && (
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="inline-flex items-center gap-1 text-xs text-neon hover:underline"
              >
                <ImageIcon size={12} />
                View screenshot
              </button>
            )}

            {/* GitHub link */}
            {item.githubIssueUrl && (
              <a
                href={item.githubIssueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-neon hover:underline"
              >
                <ExternalLink size={12} />
                View on GitHub {item.githubIssueNumber ? `#${item.githubIssueNumber}` : ''}
              </a>
            )}

            {/* Resolved info */}
            {!isOpen && item.resolvedAt && (
              <span
                title={parseTimestamp(item.resolvedAt).toLocaleString(undefined, {
                  dateStyle: 'medium', timeStyle: 'long', timeZone: tz,
                })}
                className="text-xs text-text-muted cursor-default"
              >
                Resolved {fmtDate(item.resolvedAt, { year: 'hide' })}
              </span>
            )}
          </div>

          {/* Admin response (if resolved with one) */}
          {!isOpen && item.adminResponse && (
            <div className="rounded-md border border-neon/20 bg-neon/5 px-3 py-2 text-xs text-text-secondary">
              <span className="text-neon font-medium text-[10px] uppercase tracking-wide">Staff response</span>
              <p className="mt-1 whitespace-pre-wrap">{item.adminResponse}</p>
            </div>
          )}

          {/* Resolve action (only for open items) */}
          {isOpen && (
            <div className="space-y-2">
              {responding ? (
                <>
                  <Textarea
                    value={response}
                    onChange={e => setResponse(e.target.value)}
                    placeholder="Optional response to the reporter..."
                    rows={3}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleResolve}
                      disabled={resolving}
                      className="h-7 text-xs"
                    >
                      {resolving && <RefreshCw size={11} className="animate-spin mr-1" />}
                      Mark resolved
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setResponding(false); setResponse(''); }}
                      disabled={resolving}
                      className="h-7 text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setResponding(true)}
                  className="h-7 text-xs text-text-muted"
                >
                  <CircleCheck size={12} />
                  Resolve
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Screenshot lightbox */}
      {item.screenshotUrl && (
        <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-sm font-medium">Screenshot — {item.title}</DialogTitle>
            </DialogHeader>
            <img
              src={item.screenshotUrl}
              alt="Feedback screenshot"
              className="max-h-[70dvh] w-auto max-w-full object-contain mx-auto rounded-md border border-border-default"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
